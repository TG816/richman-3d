import * as THREE from 'three';
import { tileWorldPos } from './board.js';
import { sfx } from '../audio/sfx.js';

/**
 * 玩家棋子：程序化建模的 Q 版小机器人（身体胶囊 + 圆头 + 发光面罩 + 天线）。
 * 动画：待机浮动 / 逐格跳跃 / 大跳（入狱）/ 庆祝 / 倒下（破产）。
 */

const HOP_TIME = 0.24; // 每格跳跃时长（秒）

export class Tokens {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();     // playerId -> token record
  }

  /* ---------- 构建 ---------- */

  addPlayer(p) {
    if (this.map.has(p.id)) return this.map.get(p.id);
    const group = buildRobot(p.color);
    const plate = makeNameplate(p.name, p.color);
    plate.position.y = 1.42;
    group.add(plate);
    this.scene.add(group);
    const rec = {
      id: p.id, name: p.name, color: p.color,
      group, plate, tile: 0,
      baseY: 0.42,
      hop: null,          // {from, to, t, dur, height}
      bigJump: null,
      celebrateT: -1,
      fallen: false,
      phase: Math.random() * Math.PI * 2,
      slotOffset: new THREE.Vector2(0, 0),
    };
    const pos = tileWorldPos(0, rec.baseY);
    group.position.copy(pos);
    this.map.set(p.id, rec);
    this.layoutTile(0);
    return rec;
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

  /** 逐格跳跃路径（事件驱动） */
  async walk(id, path, colorPulse = true) {
    const rec = this.map.get(id);
    if (!rec) return;
    for (const tile of path) {
      await this.hopTo(rec, tile);
      sfx.hop();
      if (tile === 0 && path.length > 1) sfx.coin();
    }
    rec.tile = path[path.length - 1];
    this.layoutTile(rec.tile);
  }

  hopTo(rec, tile) {
    return new Promise((resolve) => {
      const from = rec.group.position.clone();
      const to = tileWorldPos(tile, rec.baseY);
      rec.hop = { from, to, t: 0, dur: HOP_TIME, height: 0.55, done: resolve };
    });
  }

  /** 大弧线跳（入狱等） */
  async jumpTo(id, tile, height = 3.2) {
    const rec = this.map.get(id);
    if (!rec) return;
    await new Promise((resolve) => {
      rec.bigJump = { from: rec.group.position.clone(), to: tileWorldPos(tile, rec.baseY), t: 0, dur: 0.9, height, done: resolve };
      sfx.whoosh();
    });
    rec.tile = tile;
    this.layoutTile(tile);
  }

  snapTo(id, tile) {
    const rec = this.map.get(id);
    if (!rec) return;
    rec.tile = tile;
    rec.hop = null;
    rec.bigJump = null;
    rec.group.position.copy(tileWorldPos(tile, rec.baseY));
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

  /** 同格多玩家错位摆放 */
  layoutTile(tile) {
    const recs = [...this.map.values()].filter((r) => r.tile === tile && !r.fallen);
    const n = recs.length;
    recs.forEach((r, i) => {
      if (n === 1) r.slotOffset.set(0, 0);
      else if (n === 2) r.slotOffset.set(i === 0 ? -0.42 : 0.42, 0);
      else if (n === 3) r.slotOffset.set([0, -0.48, 0.48][i], i === 0 ? -0.3 : 0.3);
      else {
        const ang = (i / n) * Math.PI * 2 + Math.PI / 4;
        r.slotOffset.set(Math.cos(ang) * 0.52, Math.sin(ang) * 0.52);
      }
    });
  }

  /* ---------- 每帧 ---------- */

  update(dt, t) {
    for (const rec of this.map.values()) {
      const g = rec.group;
      if (rec.hop) {
        const h = rec.hop;
        h.t += dt;
        const u = Math.min(h.t / h.dur, 1);
        g.position.lerpVectors(h.from, h.to, u);
        g.position.y = h.from.y + (h.to.y - h.from.y) * u + Math.sin(u * Math.PI) * h.height;
        const squash = 1 + Math.sin(u * Math.PI) * 0.12;
        g.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const dir = h.to.clone().sub(h.from);
        if (dir.lengthSq() > 0.001) {
          g.rotation.y = Math.atan2(dir.x, dir.z);
        }
        if (u >= 1) {
          g.position.copy(h.to);
          g.scale.set(1, 1, 1);
          rec.hop = null;
          h.done?.();
        }
      } else if (rec.bigJump) {
        const j = rec.bigJump;
        j.t += dt;
        const u = Math.min(j.t / j.dur, 1);
        g.position.lerpVectors(j.from, j.to, u);
        g.position.y = j.from.y + (j.to.y - j.from.y) * u + Math.sin(u * Math.PI) * j.height;
        g.rotation.y += dt * 7;
        if (u >= 1) {
          g.position.copy(j.to);
          g.rotation.y = 0;
          rec.bigJump = null;
          j.done?.();
        }
      } else if (rec.fallen) {
        g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, Math.PI / 2, 1 - Math.pow(0.001, dt));
        g.position.y = THREE.MathUtils.lerp(g.position.y, 0.16, 1 - Math.pow(0.001, dt));
      } else {
        // 待机浮动
        const targetX = tileWorldPos(rec.tile, 0).x + rec.slotOffset.x;
        const targetZ = tileWorldPos(rec.tile, 0).z + rec.slotOffset.y;
        g.position.x = THREE.MathUtils.lerp(g.position.x, targetX, 1 - Math.pow(0.002, dt));
        g.position.z = THREE.MathUtils.lerp(g.position.z, targetZ, 1 - Math.pow(0.002, dt));
        if (rec.celebrateT >= 0) {
          rec.celebrateT += dt;
          const u = rec.celebrateT % 0.9;
          g.position.y = rec.baseY + Math.abs(Math.sin(u / 0.9 * Math.PI * 2)) * 0.5;
          g.rotation.y += dt * 9;
          if (rec.celebrateT > 2.2) { rec.celebrateT = -1; g.rotation.y = 0; }
        } else {
          g.position.y = rec.baseY + Math.abs(Math.sin(t * 2.1 + rec.phase)) * 0.045;
          g.rotation.y = Math.sin(t * 0.8 + rec.phase) * 0.12;
          // 面罩呼吸
          const visor = g.userData.visor;
          if (visor) visor.material.emissiveIntensity = 1.6 + Math.sin(t * 3 + rec.phase) * 0.5;
        }
        g.scale.set(1, 1, 1);
      }
    }
  }
}

/* ============ 机器人构建 ============ */

function buildRobot(colorHex) {
  const color = new THREE.Color(colorHex);
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.6, metalness: 0.4 });
  const group = new THREE.Group();

  const legGeo = new THREE.CapsuleGeometry(0.075, 0.1, 4, 10);
  for (const x of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(x, 0.1, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.16, 6, 16), body);
  torso.position.y = 0.38;
  torso.castShadow = true;
  group.add(torso);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 20), dark);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.3;
  group.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), body);
  head.position.y = 0.68;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.075, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0a0f1e, emissive: 0x8fe3ff, emissiveIntensity: 1.8, roughness: 0.2 })
  );
  visor.position.set(0, 0.7, 0.135);
  group.add(visor);
  group.userData.visor = visor;

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8), dark);
  antenna.position.y = 0.88;
  group.add(antenna);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 12, 10),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 })
  );
  ball.position.y = 0.95;
  group.add(ball);

  const armGeo = new THREE.CapsuleGeometry(0.05, 0.11, 4, 8);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, body);
    arm.position.set(s * 0.26, 0.4, 0);
    arm.rotation.z = s * 0.5;
    arm.castShadow = true;
    group.add(arm);
  }

  return group;
}

function makeNameplate(name, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (name, money, dead) => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(8,12,28,.88)';
    roundRect(g, 8, 8, 240, 80, 22);
    g.fill();
    g.strokeStyle = dead ? '#666' : colorHex;
    g.lineWidth = 4;
    roundRect(g, 8, 8, 240, 80, 22);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#eef1fb';
    g.font = 'bold 34px "Microsoft YaHei"';
    g.fillText(name.slice(0, 6), 128, 44);
    g.font = 'bold 30px "Microsoft YaHei"';
    g.fillStyle = dead ? '#8a8fa8' : '#f0c96a';
    g.fillText(dead ? '💀 出局' : `¥ ${(money ?? 0).toLocaleString('en-US')}`, 128, 78);
    tex.needsUpdate = true;
  };
  draw(name, 0, false);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.65, 0.62, 1);
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
