import * as THREE from 'three';
import { tileWorldPos } from './board.js';

/** 轻量特效：飘字（收支/租金）、彩带（胜利） */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.floaters = [];
    this.confetti = null;
  }

  /** 世界坐标飘字（+¥500 金色 / -¥300 红色） */
  floatText(text, color = '#f0c96a', pos, opts = {}) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 80;
    const g = cv.getContext('2d');
    g.font = 'bold 52px "Microsoft YaHei"';
    g.textAlign = 'center';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.strokeText(text, 128, 56);
    g.fillStyle = color;
    g.fillText(text, 128, 56);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.1, 0.66, 1);
    sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.9, (Math.random() - 0.5) * 0.6));
    this.scene.add(sprite);
    this.floaters.push({ sprite, t: 0, dur: opts.dur ?? 1.5, rise: opts.rise ?? 1.5 });
  }

  floatAtTile(text, color, tile) {
    this.floatText(text, color, tileWorldPos(tile, 0.4));
  }

  /** 胜利彩带 */
  burstConfetti(colors = ['#f0c96a', '#e2504a', '#46c078', '#5a8df0', '#e46fae']) {
    const N = 260;
    const geo = new THREE.PlaneGeometry(0.14, 0.2);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const parts = [];
    for (let i = 0; i < N; i++) {
      const c = new THREE.Color(colors[i % colors.length]);
      mesh.setColorAt(i, c);
      parts.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 3, 14 + Math.random() * 4, (Math.random() - 0.5) * 3),
        vel: new THREE.Vector3((Math.random() - 0.5) * 7, -1 - Math.random() * 2, (Math.random() - 0.5) * 7),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        rotV: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
      });
    }
    mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.confetti = { mesh, parts, t: 0 };
  }

  update(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const u = f.t / f.dur;
      if (u >= 1) {
        this.scene.remove(f.sprite);
        f.sprite.material.map.dispose();
        f.sprite.material.dispose();
        this.floaters.splice(i, 1);
        continue;
      }
      f.sprite.position.y += dt * f.rise;
      f.sprite.material.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
    }

    if (this.confetti) {
      const c = this.confetti;
      c.t += dt;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1);
      let alive = 0;
      c.parts.forEach((p, i) => {
        p.vel.y -= 9.8 * dt * 0.6;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.1) { p.pos.y = 0.1; p.vel.set(p.vel.x * 0.6, 0, p.vel.z * 0.6); p.rotV.multiplyScalar(0.7); }
        if (p.pos.y > 0.15 || p.vel.lengthSq() > 0.01) alive++;
        p.rot.x += p.rotV.x * dt; p.rot.y += p.rotV.y * dt; p.rot.z += p.rotV.z * dt;
        q.setFromEuler(p.rot);
        m.compose(p.pos, q, s);
        c.mesh.setMatrixAt(i, m);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
      if (c.t > 7 || alive === 0) {
        this.scene.remove(c.mesh);
        c.mesh.dispose();
        this.confetti = null;
      }
    }
  }
}
