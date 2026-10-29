import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sfx } from '../audio/sfx.js';

/**
 * 3D 骰子：一对圆角骰子，掷出时抛掷+翻滚+落定到目标点数。
 * 面贴图：Canvas 画点数（1 对 6，2 对 5，3 对 4）。
 */
const FACE_NORMALS = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
};
const UP = new THREE.Vector3(0, 1, 0);

export class Dice {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0.5, 0);
    this.group.visible = false;
    scene.add(this.group);
    this.dice = [makeDie(), makeDie()];
    this.dice[0].mesh.position.x = -0.75;
    this.dice[1].mesh.position.x = 0.75;
    this.dice.forEach((d) => this.group.add(d.mesh));
    this.anim = null;
    this.settleQuat = null;
    this.settleT = 0;
  }

  /** 掷骰动画：结果 values=[a,b]，返回 Promise */
  roll(values) {
    return new Promise((resolve) => {
      this.group.visible = true;
      sfx.dice();
      const targets = values.map((v, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[v], UP);
        const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        return { value: v, quat: yaw.multiply(q), slotX: i === 0 ? -0.75 : 0.75, slotZ: (Math.random() - 0.5) * 1.2 };
      });
      const spins = this.dice.map(() => new THREE.Vector3(
        (Math.random() * 2 - 1) * 14, (Math.random() * 2 - 1) * 14, (Math.random() * 2 - 1) * 14
      ));
      this.anim = { t: 0, dur: 1.25, targets, spins, resolve, bounced: [false, false] };
      this.dice.forEach((d, i) => {
        d.mesh.position.set(i === 0 ? -1.6 : 1.6, 1.2, (Math.random() - 0.5) * 1.5);
        d.mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      });
    });
  }

  hide() { this.group.visible = false; }

  update(dt) {
    if (!this.anim) return;
    const a = this.anim;
    a.t += dt;
    const u = Math.min(a.t / a.dur, 1);

    this.dice.forEach((d, i) => {
      const m = d.mesh;
      const tgt = a.targets[i];
      if (u < 0.78) {
        // 翻滚阶段：抛物线 + 自旋
        const p = u / 0.78;
        const bx = THREE.MathUtils.lerp(m.position.x, tgt.slotX, p * 0.25);
        const bz = THREE.MathUtils.lerp(m.position.z, tgt.slotZ, p * 0.3);
        const bounce = Math.abs(Math.sin(p * Math.PI * 2.2)) * (1 - p) * 2.2 + 0.45;
        m.position.set(bx, 0.45 + bounce, bz);
        m.rotation.x += a.spins[i].x * dt * (1 - p);
        m.rotation.y += a.spins[i].y * dt * (1 - p);
        m.rotation.z += a.spins[i].z * dt * (1 - p);
        const k = Math.floor(p * 7);
        if (k > d.lastClack) { d.lastClack = k; sfx.clack(); }
      } else {
        // 落定阶段：球面插值到目标姿态
        if (!this.settleFrom) this.settleFrom = this.dice.map((dd) => dd.mesh.quaternion.clone());
        const s = (u - 0.78) / 0.22;
        m.quaternion.slerpQuaternions(this.settleFrom[i], tgt.quat, Math.min(s * 1.4, 1));
        m.position.x = THREE.MathUtils.lerp(m.position.x, tgt.slotX, 0.35);
        m.position.z = THREE.MathUtils.lerp(m.position.z, tgt.slotZ, 0.35);
        m.position.y = THREE.MathUtils.lerp(m.position.y, 0.45, 0.4);
      }
    });
    if (u >= 1) {
      this.settleFrom = null;
      const resolve = a.resolve;
      this.anim = null;
      sfx.diceLand();
      resolve();
    }
  }
}

let pipTextures = null;
function makeDie() {
  if (!pipTextures) pipTextures = makePipTextures();
  const geo = new RoundedBoxGeometry(0.9, 0.9, 0.9, 4, 0.16);
  // BoxGeometry 材质顺序：+x,-x,+y,-y,+z,-z → 3,4,1,6,2,5
  const order = [3, 4, 1, 6, 2, 5];
  const mats = order.map((v) => new THREE.MeshStandardMaterial({
    color: 0xf7f3e8, roughness: 0.25, metalness: 0.05, map: pipTextures[v],
  }));
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  return { mesh, lastClack: 0 };
}

function makePipTextures() {
  const tex = {};
  const positions = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.3, 0.24], [0.7, 0.24], [0.3, 0.5], [0.7, 0.5], [0.3, 0.76], [0.7, 0.76]],
  };
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#faf6ea');
    grad.addColorStop(1, '#e8e0cc');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    for (const [x, y] of positions[v]) {
      const rg = g.createRadialGradient(x * 128 - 3, y * 128 - 3, 1, x * 128, y * 128, 13);
      rg.addColorStop(0, '#3a3a44');
      rg.addColorStop(1, '#14141c');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x * 128, y * 128, 12, 0, Math.PI * 2);
      g.fill();
    }
    tex[v] = new THREE.CanvasTexture(cv);
    tex[v].colorSpace = THREE.SRGBColorSpace;
  }
  return tex;
}
