import * as THREE from 'three';
import { tileWorldPos, cellDirs } from './board.js';
import { sfx } from '../audio/sfx.js';

/**
 * 玩家角色 v2 —— 参考《大富翁4》：Q 版小人走在街上，有头有脚，
 * 走路时手脚摆动、身体轻晃；买楼盖楼在街边肉眼可见地长高。
 */

const STEP_TIME = 0.34; // 每格步行时长（秒）

export class Tokens {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();     // playerId -> token record
  }

  /* ---------- 构建 ---------- */

  addPlayer(p) {
    if (this.map.has(p.id)) return this.map.get(p.id);
    const group = buildChibi(p.color);
    const plate = makeNameplate(p.name, p.color);
    plate.position.y = 1.5;
    group.add(plate);
    this.scene.add(group);
    const rec = {
      id: p.id, name: p.name, color: p.color,
      group, plate, tile: 0,
      baseY: 0,
      walk: null,          // {segs, seg, t, dur}
      jump: null,
      celebrateT: -1,
      fallen: false,
      phase: Math.random() * Math.PI * 2,
      slotOffset: new THREE.Vector2(0, 0), // 沿切线方向的错位
    };
    group.position.copy(this.tilePoint(0, rec));
    this.map.set(p.id, rec);
    this.layoutTile(0);
    return rec;
  }

  /** 格上的站位：路中心 + 沿切线错位 */
  tilePoint(tile, rec) {
    const base = tileWorldPos(tile, 0);
    const { t } = cellDirs(tile);
    return new THREE.Vector3(
      base.x + t.x * rec.slotOffset.x,
      base.y,
      base.z + t.z * rec.slotOffset.x
    );
  }

  removePlayer(id) {
    const rec = this.map.get(id);
    if (!rec) return;
    this.scene.remove(rec.group);
    rec.group.traverse((o) => { o.geometry?.dispose?.(); });
    this.map.delete(id);
  }

  syncPlayers(players) {
    const ids = new Set(players.map((p) => p.id));
    for (const id of [...this.map.keys()]) if (!ids.has(id)) this.removePlayer(id);
    for (const p of players) {
      const rec = this.addPlayer(p);
      rec.name = p.name;
    }
  }

  updateMoney(player) {
    const rec = this.map.get(player.id);
    if (!rec) return;
    rec.plate.userData.update(`${player.name}`, player.money, player.bankrupt);
  }

  /* ---------- 移动 ---------- */

  /** 沿路径逐格步行（事件驱动） */
  async walk(id, path) {
    const rec = this.map.get(id);
    if (!rec) return;
    for (let k = 0; k < path.length; k++) {
      const tile = path[k];
      await this.stepTo(rec, tile);
      sfx.hop();
      if (tile === 0 && path.length > 1) sfx.coin();
    }
    rec.tile = path[path.length - 1];
    this.layoutTile(rec.tile);
  }

  stepTo(rec, tile) {
    return new Promise((resolve) => {
      const from = rec.group.position.clone();
      const to = this.tilePoint(tile, rec);
      rec.walk = { from, to, t: 0, dur: STEP_TIME, done: resolve, dir: to.clone().sub(from) };
    });
  }

  /** 大弧线跳（入狱等） */
  async jumpTo(id, tile, height = 3.2) {
    const rec = this.map.get(id);
    if (!rec) return;
    await new Promise((resolve) => {
      rec.jump = { from: rec.group.position.clone(), to: this.tilePoint(tile, rec), t: 0, dur: 0.9, height, done: resolve };
      sfx.whoosh();
    });
    rec.tile = tile;
    this.layoutTile(tile);
  }

  snapTo(id, tile) {
    const rec = this.map.get(id);
    if (!rec) return;
    rec.tile = tile;
    rec.walk = null;
    rec.jump = null;
    rec.group.position.copy(this.tilePoint(tile, rec));
    this.layoutTile(tile);
  }

  celebrate(id) {
    const rec = this.map.get(id);
    if (rec) rec.celebrateT = 0;
  }

  fall(id) {
    const rec = this.map.get(id);
    if (!rec) return;
    rec.fallen = true;
    rec.plate.userData.update(rec.name, 0, true);
  }

  /** 同格多玩家沿街道错开 */
  layoutTile(tile) {
    const recs = [...this.map.values()].filter((r) => r.tile === tile && !r.fallen);
    const n = recs.length;
    const { t } = cellDirs(tile);
    recs.forEach((r, i) => {
      const off = n <= 1 ? 0 : (i - (n - 1) / 2) * 0.62; // 沿切线排开
      r.slotOffset.set(off, 0);
      void t;
    });
  }

  /* ---------- 每帧 ---------- */

  update(dt, t) {
    for (const rec of this.map.values()) {
      const g = rec.group;

      if (rec.walk) {
        const w = rec.walk;
        w.t += dt;
        const u = Math.min(w.t / w.dur, 1);
        g.position.lerpVectors(w.from, w.to, u);
        g.position.y = 0;
        // 步伐
        rec.stepPhase = (rec.stepPhase || 0) + dt * 13;
        const s = Math.sin(rec.stepPhase);
        g.userData.legL.rotation.x = s * 0.7;
        g.userData.legR.rotation.x = -s * 0.7;
        g.userData.armL.rotation.x = -s * 0.5;
        g.userData.armR.rotation.x = s * 0.5;
        g.userData.body.position.y = 0.62 + Math.abs(Math.cos(rec.stepPhase)) * 0.045;
        g.userData.head.rotation.z = s * 0.04;
        if (w.dir.lengthSq() > 0.0001) {
          const target = Math.atan2(w.dir.x, w.dir.z);
          g.rotation.y = dampAngle(g.rotation.y, target, 12, dt);
        }
        if (u >= 1) {
          g.position.copy(w.to);
          g.position.y = 0;
          rec.walk = null;
          resetPose(g);
          w.done?.();
        }
      } else if (rec.jump) {
        const j = rec.jump;
        j.t += dt;
        const u = Math.min(j.t / j.dur, 1);
        g.position.lerpVectors(j.from, j.to, u);
        g.position.y = Math.sin(u * Math.PI) * j.height;
        g.rotation.y += dt * 7;
        g.userData.legL.rotation.x = -0.5;
        g.userData.legR.rotation.x = -0.5;
        g.userData.armL.rotation.x = -2.4;
        g.userData.armR.rotation.x = -2.4;
        if (u >= 1) {
          g.position.copy(j.to);
          g.position.y = 0;
          g.rotation.y = 0;
          rec.jump = null;
          resetPose(g);
          j.done?.();
        }
      } else if (rec.fallen) {
        g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, Math.PI / 2, 1 - Math.pow(0.001, dt));
        g.position.y = THREE.MathUtils.lerp(g.position.y, 0.15, 1 - Math.pow(0.001, dt));
      } else {
        // 待机：轻微呼吸 + 张望
        const targetX = this.tilePoint(rec.tile, rec).x;
        const targetZ = this.tilePoint(rec.tile, rec).z;
        g.position.x = THREE.MathUtils.lerp(g.position.x, targetX, 1 - Math.pow(0.002, dt));
        g.position.z = THREE.MathUtils.lerp(g.position.z, targetZ, 1 - Math.pow(0.002, dt));
        g.position.y = 0;
        if (rec.celebrateT >= 0) {
          rec.celebrateT += dt;
          const u = rec.celebrateT % 0.9;
          g.position.y = Math.abs(Math.sin((u / 0.9) * Math.PI * 2)) * 0.45;
          g.rotation.y += dt * 9;
          g.userData.armL.rotation.x = -2.6;
          g.userData.armR.rotation.x = -2.6;
          if (rec.celebrateT > 2.2) {
            rec.celebrateT = -1;
            g.rotation.y = 0;
            resetPose(g);
          }
        } else {
          g.userData.body.position.y = 0.62 + Math.sin(t * 2.1 + rec.phase) * 0.018;
          g.userData.armL.rotation.x = Math.sin(t * 1.6 + rec.phase) * 0.08;
          g.userData.armR.rotation.x = -Math.sin(t * 1.6 + rec.phase) * 0.08;
          g.userData.head.rotation.y = Math.sin(t * 0.6 + rec.phase) * 0.35;
          g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, 0, 1 - Math.pow(0.002, dt));
        }
      }
    }
  }
}

function resetPose(g) {
  g.userData.legL.rotation.set(0, 0, 0);
  g.userData.legR.rotation.set(0, 0, 0);
  g.userData.armL.rotation.set(0, 0, 0);
  g.userData.armR.rotation.set(0, 0, 0);
  g.userData.head.rotation.set(0, 0, 0);
}

function dampAngle(cur, target, lambda, dt) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.pow(0.5, dt * lambda));
}

/* ============ Q 版小人 ============ */

function buildChibi(colorHex) {
  const color = new THREE.Color(colorHex);
  const skin = new THREE.MeshStandardMaterial({ color: 0xffd9b8, roughness: 0.65 });
  const outfit = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const outfitDark = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.72), roughness: 0.6 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0x2a2118), 0.55), roughness: 0.75 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x22242e, roughness: 0.4 });

  const g = new THREE.Group();

  // 腿（髋部为轴）
  const legGeo = new THREE.BoxGeometry(0.11, 0.32, 0.11);
  legGeo.translate(0, -0.16, 0);
  const legL = new THREE.Group();
  legL.position.set(0.09, 0.32, 0);
  const legLMesh = new THREE.Mesh(legGeo, outfitDark);
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.2), shoe);
  shoeL.position.set(0, -0.31, 0.03);
  legL.add(shoeL);
  g.add(legL);

  const legR = new THREE.Group();
  legR.position.set(-0.09, 0.32, 0);
  const legRMesh = new THREE.Mesh(legGeo, outfitDark);
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.2), shoe);
  shoeR.position.set(0, -0.31, 0.03);
  legR.add(shoeR);
  g.add(legR);

  // 身体
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 5, 14), outfit);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.035, 8, 18), outfitDark);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.47;
  g.add(belt);

  // 手臂（肩部为轴）
  const armGeo = new THREE.CapsuleGeometry(0.052, 0.2, 4, 8);
  armGeo.translate(0, -0.13, 0);
  const armL = new THREE.Group();
  armL.position.set(0.24, 0.74, 0);
  const armLMesh = new THREE.Mesh(armGeo, outfit);
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 7), skin);
  handL.position.y = -0.27;
  armL.add(handL);
  g.add(armL);

  const armR = new THREE.Group();
  armR.position.set(-0.24, 0.74, 0);
  const armRMesh = new THREE.Mesh(armGeo, outfit);
  armRMesh.castShadow = true;
  armR.add(armRMesh);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 7), skin);
  handR.position.y = -0.27;
  armR.add(handR);
  g.add(armR);

  // 头（大圆头 + 头发 + 眼睛）
  const head = new THREE.Group();
  head.position.y = 1.04;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), skin);
  skull.castShadow = true;
  head.add(skull);
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.225, 20, 14), hair);
  hairMesh.scale.set(1, 0.78, 1);
  hairMesh.position.y = 0.07;
  head.add(hairMesh);
  for (const x of [0.075, -0.075]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), eyeMat);
    eye.position.set(x, 0.0, 0.185);
    head.add(eye);
  }
  g.add(head);

  g.userData = { legL, legR, armL, armR, body, head };
  g.scale.setScalar(1.12);
  return g;
}

function makeNameplate(name, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (name, money, dead) => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(255,255,255,.92)';
    roundRect(g, 8, 8, 240, 80, 22);
    g.fill();
    g.strokeStyle = dead ? '#999' : colorHex;
    g.lineWidth = 4;
    roundRect(g, 8, 8, 240, 80, 22);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#2c3042';
    g.font = 'bold 34px "Microsoft YaHei"';
    g.fillText(name.slice(0, 6), 128, 44);
    g.font = 'bold 30px "Microsoft YaHei"';
    g.fillStyle = dead ? '#8a8fa8' : '#b8862a';
    g.fillText(dead ? '💀 出局' : `¥ ${(money ?? 0).toLocaleString('en-US')}`, 128, 78);
    tex.needsUpdate = true;
  };
  draw(name, 0, false);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.6, 0.6, 1);
  sprite.userData.update = draw;
  return sprite;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
