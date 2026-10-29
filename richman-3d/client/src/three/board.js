import * as THREE from 'three';
import { BOARD, GROUPS } from '@board';

/**
 * 世界地图 v2 —— 参考《大富翁4》：不再是方形跑道俯瞰全场，
 * 而是一张大地图上的蜿蜒闭合街道 + 镜头局部跟随。
 *
 * - 11x7 网格上的 40 格正交闭合环路（带内院下沉与两处街block起伏）
 * - 每格是一块"地块"：路边是木牌（街名/价格），买地后地上盖房子，加盖逐层长高
 * - 空地/街区散布树木、灌木、石凳、路灯，内院有水池，天上有云（见 scene.js）
 */

export const CELL = 4;                       // 每格 4x4 米
const GRID = [
  [0, 6], [1, 6], [2, 6], [3, 6], [3, 5], [3, 4], [4, 4], [5, 4], [5, 5], [5, 6], // 0-9
  [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [10, 5], [10, 4], [10, 3], [10, 2], [10, 1], // 10-19
  [10, 0], [9, 0], [8, 0], [8, 1], [7, 1], [7, 0], [6, 0], [5, 0], [4, 0], [4, 1], // 20-29
  [3, 1], [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], // 30-39
];

export function cellWorld(cx, cz) {
  return { x: (cx - 5) * CELL, z: (cz - 3) * CELL };
}

export function tileWorldPos(i, y = 0) {
  const [cx, cz] = GRID[i];
  const p = cellWorld(cx, cz);
  return new THREE.Vector3(p.x, y, p.z);
}

/** 单元朝向：切线与"朝外"法向（环路为逆时针） */
export function cellDirs(i) {
  const a = tileWorldPos((i + 39) % 40);
  const b = tileWorldPos((i + 1) % 40);
  const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const out = new THREE.Vector3(-t.z, 0, t.x); // 逆时针环的外侧
  return { t, out };
}

/* ================= 程序化贴图 ================= */

function canvasTex(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 街道木牌：街名 + 价格 + 地段色条 */
function makeSignTexture(t, groupColor) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#f8f2e2';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#8a6a45'; g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 120);
  if (groupColor) {
    g.fillStyle = groupColor;
    g.fillRect(8, 8, 240, 22);
  }
  g.fillStyle = '#3a3428';
  g.textAlign = 'center';
  g.font = 'bold 34px "Microsoft YaHei"';
  const name = t.name;
  if (name.length > 5) {
    g.font = 'bold 28px "Microsoft YaHei"';
    g.fillText(name.slice(0, 3), 128, 72);
    g.fillText(name.slice(3), 128, 104);
  } else {
    g.fillText(name, 128, 78);
  }
  if (t.price) {
    g.fillStyle = '#8a6a45';
    g.font = 'bold 22px "Microsoft YaHei"';
    g.textAlign = 'right';
    g.fillText(`¥${t.price.toLocaleString('en-US')}`, 244, 122);
  }
  return canvasTex(cv);
}

/** 楼体墙面：窗户网格 + 门（楼层越多越高级） */
function makeWallTexture(floors, accent) {
  const W = 128, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4ead6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 10);           // 顶部色带
  const rows = Math.max(1, floors);
  const margin = 16, gap = 10;
  const wh = (H - 28 - margin * (rows - 1) - 18) / rows;
  const ww = (W - 32 - 18) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      const x = 16 + c * (ww + 18);
      const y = 14 + r * (wh + margin);
      g.fillStyle = '#bfe0f2';
      g.fillRect(x, y, ww, wh);
      g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.strokeRect(x, y, ww, wh);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.moveTo(x, y + wh); g.lineTo(x + ww * 0.5, y); g.lineTo(x + ww, y); g.lineTo(x, y + wh);
      g.fill();
    }
  }
  // 门
  g.fillStyle = accent;
  g.fillRect(W / 2 - 11, H - 24, 22, 24);
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.beginPath(); g.arc(W / 2 + 5, H - 12, 2.2, 0, 7); g.fill();
  return canvasTex(cv);
}

/** 特殊格招牌：机会？/命运！/车站/税 */
function makeBoardTexture(bg, glyph, label) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '900 64px sans-serif';
  g.fillText(glyph, 64, 72);
  if (label) {
    g.font = 'bold 20px "Microsoft YaHei"';
    g.fillText(label, 64, 108);
  }
  return canvasTex(cv);
}

/* ================= 小建筑工厂 ================= */

function boxMesh(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.75, metalness: opts.metal ?? 0.05, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 0 })
  );
  m.castShadow = true;
  return m;
}

function pyramidRoof(w, h, color) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.78, h, 4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  m.rotation.y = Math.PI / 4;
  m.castShadow = true;
  return m;
}

/** 依等级盖楼：0=小屋，1-4=2~5 层楼房，5=酒店塔楼 */
function buildBuilding(level, accentHex) {
  const accent = new THREE.Color(accentHex);
  const g = new THREE.Group();
  const addWindows = (floors, w, d) => {
    // 四面窗（用同一个贴图材质的盒子近似：这里用少量真窗更立体）
    const winMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f6, roughness: 0.15, metalness: 0.35, emissive: 0x6f96b8, emissiveIntensity: 0.12 });
    const winGeo = new THREE.BoxGeometry(0.34, 0.4, 0.06);
    for (let f = 0; f < floors; f++) {
      const y = 0.62 + f * 0.78;
      for (const [dx, dz, ry] of [[w / 2 - 0.02, 0.3, 0], [w / 2 - 0.02, -0.3, 0], [-w / 2 + 0.02, 0.3, Math.PI], [-w / 2 + 0.02, -0.3, Math.PI]]) {
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(dx, y, dz);
        win.rotation.y = ry;
        g.add(win);
      }
    }
  };

  if (level === 0) {
    // 爱心小屋：单层 + 三角屋顶
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.95, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xf7efdd, roughness: 0.75 })
    );
    body.position.y = 0.48;
    body.castShadow = true;
    g.add(body);
    const roof = pyramidRoof(1.75, 0.62, accent.getHex());
    roof.position.y = 1.26;
    g.add(roof);
    const door = boxMesh(0.34, 0.52, 0.06, accent.getHex());
    door.position.set(0, 0.26, 0.78);
    g.add(door);
    return g;
  }

  const floors = level + 1;            // 2~5 层
  const w = 1.5 + level * 0.18;
  const h = 0.95 + level * 0.78;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, w),
    new THREE.MeshStandardMaterial({ map: makeWallTexture(floors, '#' + accent.getHexString()), roughness: 0.7 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  // 楼顶压边 + 屋顶色块
  const cap = boxMesh(w + 0.12, 0.1, w + 0.12, accent.getHex());
  cap.position.y = h + 0.05;
  g.add(cap);
  if (level < 5) {
    const roof = pyramidRoof(w * 1.15, 0.5, accent.getHex());
    roof.position.y = h + 0.38;
    g.add(roof);
  } else {
    // 酒店：屋顶招牌
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2b2b3a, emissive: 0xf0c96a, emissiveIntensity: 0.85, roughness: 0.4 })
    );
    sign.position.y = h + 0.42;
    g.add(sign);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5), new THREE.MeshStandardMaterial({ color: 0x666a7a }));
    pole.position.y = h + 0.75;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.3),
      new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide })
    );
    flag.position.set(0.27, h + 0.92, 0);
    g.add(flag);
  }
  addWindows(Math.min(floors, 5), w, w);
  return g;
}

/* ================= 特殊地标 ================= */

function specialStructure(t, i) {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b356, roughness: 0.35, metalness: 0.75, emissive: 0xf0c96a, emissiveIntensity: 0.18 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.9 });

  const poleWith = (tex, color) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), wood);
    pole.position.y = 0.75; pole.castShadow = true;
    g.add(pole);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.15, 0.08),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
    );
    board.position.y = 1.7;
    board.castShadow = true;
    g.add(board);
    void color;
  };

  switch (t.type) {
    case 'go': {
      // 金色拱门
      for (const x of [-1.2, 1.2]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 10), gold);
        pillar.position.set(x, 1.1, 0);
        pillar.castShadow = true;
        g.add(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.36, 0.4), gold);
      beam.position.y = 2.3;
      beam.castShadow = true;
      g.add(beam);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: 0xe2504a, side: THREE.DoubleSide }));
      flag.position.set(0, 2.72, 0);
      g.add(flag);
      break;
    }
    case 'jail': {
      const base = boxMesh(2.4, 0.9, 2.4, 0xb9bcc9);
      base.position.y = 0.45;
      g.add(base);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x5a6070, metalness: 0.8, roughness: 0.35 }));
        bar.position.set(x * 0.95, 1.35, z * 0.95);
        g.add(bar);
      }
      const roof = pyramidRoof(2.6, 0.55, 0x6f7688);
      roof.position.y = 2.05;
      g.add(roof);
      break;
    }
    case 'park': {
      // 喷泉
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.4, 20), stone);
      basin.position.y = 0.2;
      basin.castShadow = true;
      g.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x6fc3e8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }));
      water.position.y = 0.42;
      g.add(water);
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0xbfe6f7, roughness: 0.1, transparent: true, opacity: 0.85 }));
      jet.position.y = 0.8;
      g.add(jet);
      break;
    }
    case 'gotojail': {
      // 警察岗亭
      const box = boxMesh(1.4, 1.7, 1.4, 0x3f5aa8);
      box.position.y = 0.85;
      g.add(box);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff3b3b, emissiveIntensity: 1.6 }));
      light.position.y = 1.95;
      g.add(light);
      break;
    }
    case 'chance':
      poleWith(makeBoardTexture('#e8923d', '?', '机会'));
      break;
    case 'fate': {
      // 礼物盒
      const bx = boxMesh(1.1, 1.0, 1.1, 0x5a8df0);
      bx.position.y = 0.5;
      g.add(bx);
      const ribbon1 = boxMesh(0.22, 1.04, 1.14, 0xfff2c8);
      ribbon1.position.y = 0.5;
      g.add(ribbon1);
      const ribbon2 = boxMesh(1.14, 1.04, 0.22, 0xfff2c8);
      ribbon2.position.y = 0.5;
      g.add(ribbon2);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 16), new THREE.MeshStandardMaterial({ color: 0xfff2c8 }));
      bow.position.y = 1.12;
      bow.rotation.x = Math.PI / 2;
      g.add(bow);
      break;
    }
    case 'tax':
      poleWith(makeBoardTexture('#8a5a3a', '¥', '缴税'));
      break;
    case 'station': {
      const plat = boxMesh(3.2, 0.3, 2.0, 0xd8d2c0);
      plat.position.y = 0.15;
      g.add(plat);
      for (const x of [-1.1, 1.1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), wood);
        post.position.set(x, 0.95, 0);
        g.add(post);
      }
      const canopy = boxMesh(3.0, 0.12, 1.9, 0xe2504a);
      canopy.position.y = 1.7;
      canopy.castShadow = true;
      g.add(canopy);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.08), new THREE.MeshStandardMaterial({ map: makeBoardTexture('#3c4664', '🚄'), roughness: 0.5 }));
      board.position.set(0, 2.2, 0.6);
      g.add(board);
      break;
    }
    case 'utility': {
      if (t.name.includes('水')) {
        // 水塔
        for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), wood);
          leg.position.set(x, 0.6, z);
          g.add(leg);
        }
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.0, 14), new THREE.MeshStandardMaterial({ color: 0x8fb6cf, roughness: 0.5 }));
        tank.position.y = 1.7;
        tank.castShadow = true;
        g.add(tank);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.4, 14), new THREE.MeshStandardMaterial({ color: 0x6f94ab }));
        cap.position.y = 2.4;
        g.add(cap);
      } else {
        // 变电站
        const cab = boxMesh(1.3, 1.1, 1.0, 0x9aa2b5);
        cab.position.y = 0.55;
        g.add(cab);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.0, 8), wood);
        pole.position.set(0, 1.0, -0.7);
        g.add(pole);
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 8, 18), new THREE.MeshStandardMaterial({ color: 0xd9b356, metalness: 0.7, roughness: 0.3 }));
        coil.position.set(0, 1.8, -0.7);
        g.add(coil);
      }
      break;
    }
    default:
      void stone;
      break;
  }
  return g;
}

/* ================= 景观装饰 ================= */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTree(rng) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 0.9, 7),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })
  );
  trunk.position.y = 0.45;
  trunk.castShadow = true;
  g.add(trunk);
  const green = [0x4f9e4f, 0x63b35a, 0x3f8f5f][Math.floor(rng() * 3)];
  if (rng() < 0.5) {
    const s = 0.8 + rng() * 0.5;
    const c1 = new THREE.Mesh(new THREE.SphereGeometry(0.75 * s, 10, 8), new THREE.MeshStandardMaterial({ color: green, roughness: 0.9 }));
    c1.position.y = 1.25;
    c1.castShadow = true;
    g.add(c1);
    const c2 = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 9, 7), new THREE.MeshStandardMaterial({ color: green, roughness: 0.9 }));
    c2.position.set(0.35 * s, 1.6 * s, 0.2);
    g.add(c2);
  } else {
    const s = 0.8 + rng() * 0.6;
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry((0.85 - k * 0.2) * s, 0.8 * s, 8),
        new THREE.MeshStandardMaterial({ color: green, roughness: 0.9 })
      );
      cone.position.y = 0.95 + k * 0.5 * s;
      cone.castShadow = true;
      g.add(cone);
    }
  }
  const sc = 0.8 + rng() * 0.7;
  g.scale.set(sc, sc, sc);
  return g;
}

function makeBush(rng) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.32 + rng() * 0.2, 8, 6),
    new THREE.MeshStandardMaterial({ color: [0x5fae58, 0x74c069][Math.floor(rng() * 2)], roughness: 0.95 })
  );
  m.position.y = 0.22;
  m.scale.y = 0.75;
  m.castShadow = true;
  return m;
}

function makeFlowers(rng) {
  const g = new THREE.Group();
  const colors = [0xef6a8a, 0xf2d43d, 0xffffff, 0xef9a5a];
  for (let k = 0; k < 5; k++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshStandardMaterial({ color: colors[Math.floor(rng() * 4)], roughness: 0.8 }));
    f.position.set((rng() - 0.5) * 1.6, 0.1, (rng() - 0.5) * 1.6);
    g.add(f);
  }
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.7, 8), new THREE.MeshStandardMaterial({ color: 0x4a505e, roughness: 0.6, metalness: 0.4 }));
  pole.position.y = 0.85;
  pole.castShadow = true;
  g.add(pole);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffedb8, emissiveIntensity: 0.55 })
  );
  bulb.position.y = 1.78;
  g.add(bulb);
  return g;
}

function makePond() {
  const g = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 24),
    new THREE.MeshStandardMaterial({ color: 0x7fc9ea, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.05;
  g.add(water);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.14, 8, 24), new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.9 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.08;
  g.add(rim);
  return g;
}

/* ================= 棋盘搭建 ================= */

export function buildBoard(scene) {
  const api = {
    hitboxes: [],
    owners: {},          // tileIdx -> colorHex | null
    houseLevel: {},      // tileIdx -> houses n
    buildingGroups: {},
    frames: {},
    signs: {},
    highlight: null,
    highlightTile: -1,
  };

  // 草地
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(95, 48),
    new THREE.MeshStandardMaterial({ color: 0x74bd64, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // 街道（沿切向穿过每个格子）+ 内侧地块
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xdfc49c, roughness: 0.95 });
  for (let i = 0; i < 40; i++) {
    const p = tileWorldPos(i);
    const { t, out } = cellDirs(i);
    const rotY = Math.atan2(t.x, t.z);
    const road = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, CELL + 0.55), roadMat);
    road.position.set(p.x, 0.03, p.z);
    road.rotation.y = rotY;
    road.receiveShadow = true;
    scene.add(road);
  }

  // 内侧地块 + 拾取盒 + 街名木牌（外侧）+ 特殊地标
  for (let i = 0; i < 40; i++) {
    const t = BOARD[i];
    const p = tileWorldPos(i);
    const { out } = cellDirs(i);

    const plot = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.14, 2.7),
      new THREE.MeshStandardMaterial({ color: 0x8cc97a, roughness: 0.95 })
    );
    plot.position.set(p.x - out.x * 0.62, 0.09, p.z - out.z * 0.62);
    plot.receiveShadow = true;
    scene.add(plot);

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 2.6, 3.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(p.x, 1.3, p.z);
    hit.userData.tileIndex = i;
    scene.add(hit);
    api.hitboxes.push(hit);

    // 街名木牌（面向街外侧）
    const signG = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 }));
    post.position.y = 0.5;
    post.castShadow = true;
    signG.add(post);
    const groupColor = t.type === 'prop' ? '#' + GROUPS[t.group].color.toString(16).padStart(6, '0') : null;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.78, 0.07),
      new THREE.MeshStandardMaterial({ map: makeSignTexture(t, groupColor), roughness: 0.6 })
    );
    board.position.y = 1.12;
    board.castShadow = true;
    signG.add(board);
    const sx = p.x + out.x * 1.5, sz = p.z + out.z * 1.5;
    signG.position.set(sx, 0.14, sz);
    signG.rotation.y = Math.atan2(out.x, out.z);
    scene.add(signG);
    api.signs[i] = signG;

    // 特殊地标或建筑位（在内侧地块上）
    const bg = new THREE.Group();
    if (['go', 'jail', 'park', 'gotojail', 'chance', 'fate', 'tax', 'station', 'utility'].includes(t.type)) {
      const sp = specialStructure(t, i);
      bg.add(sp);
    }
    bg.position.set(plot.position.x, 0.16, plot.position.z);
    scene.add(bg);
    api.buildingGroups[i] = bg;

    // 地块边框（所属色）
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.85, 0.1, 2.85),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    frame.position.set(plot.position.x, 0.2, plot.position.z);
    scene.add(frame);
    api.frames[i] = frame;
  }

  // 内院水池（3,4-5,4 一带的院子中心）
  const pond = makePond();
  const pc = cellWorld(4, 5);
  pond.position.set(pc.x, 0.1, pc.z);
  scene.add(pond);

  // 空地景观
  const rng = mulberry32(20261030);
  const onPath = new Set(GRID.map(([x, z]) => `${x},${z}`));
  for (let cx = 0; cx <= 10; cx++) {
    for (let cz = 0; cz <= 6; cz++) {
      const key = `${cx},${cz}`;
      if (onPath.has(key)) continue;
      const p = cellWorld(cx, cz);
      const r = rng();
      let deco = null;
      if (cx === 4 && cz === 5) continue; // 水池
      if (r < 0.42) deco = makeTree(rng);
      else if (r < 0.68) deco = makeBush(rng);
      else if (r < 0.8) deco = makeFlowers(rng);
      else if (r < 0.88) deco = makeLamp();
      else continue;
      deco.position.set(p.x + (rng() - 0.5) * 1.6, 0.02, p.z + (rng() - 0.5) * 1.6);
      deco.rotation.y = rng() * Math.PI * 2;
      scene.add(deco);
    }
  }
  // 图外散树（远景林带）
  for (let k = 0; k < 30; k++) {
    const ang = rng() * Math.PI * 2;
    const r = 34 + rng() * 16;
    const tree = makeTree(rng);
    tree.position.set(Math.cos(ang) * r, -0.02, Math.sin(ang) * r * 0.82);
    tree.rotation.y = rng() * Math.PI * 2;
    scene.add(tree);
  }

  // 当前格高亮
  const hl = new THREE.Mesh(
    new THREE.RingGeometry(CELL * 0.42, CELL * 0.52, 36),
    new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  hl.rotation.x = -Math.PI / 2;
  hl.visible = false;
  scene.add(hl);
  api.highlight = hl;

  return api;
}

/** 绑定点击拾取（拖动不触发） */
export function attachPicking(camera, dom, boardApi, onClick) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 6) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(boardApi.hitboxes, false);
    if (hits.length) onClick(hits[0].object.userData.tileIndex);
  });
}

/* ================= 动态外观 ================= */

export function setTileOwner(api, i, colorHex) {
  api.owners[i] = colorHex || null;
  const frame = api.frames[i];
  if (frame) {
    if (colorHex) {
      frame.material.color = new THREE.Color(colorHex);
      frame.material.opacity = 0.95;
    } else {
      frame.material.opacity = 0;
    }
  }
}

export function setTileHouses(api, i, n) {
  const g = api.buildingGroups[i];
  const t = BOARD[i];
  // 清掉旧楼（保留特殊地标：特殊格不会有房屋）
  for (let k = g.children.length - 1; k >= 0; k--) {
    const c = g.children[k];
    if (c.userData.isBuilding) {
      g.remove(c);
      c.traverse?.((o) => o.geometry?.dispose?.());
    }
  }
  if (t.type !== 'prop' && t.type !== 'station' && t.type !== 'utility') return;
  const owner = api.owners[i];
  if (!owner) return; // 无主：只有木牌
  const level = Math.min(n, 5);
  const b = buildBuilding(level, owner);
  b.userData.isBuilding = true;
  // 楼体朝外（门朝向街道一侧）
  const { out } = cellDirs(i);
  b.rotation.y = Math.atan2(out.x, out.z);
  g.add(b);
}

export function moveHighlight(api, i) {
  api.highlightTile = i;
  if (i < 0) { api.highlight.visible = false; return; }
  const pos = tileWorldPos(i, 0.26);
  api.highlight.position.set(pos.x, pos.y, pos.z);
  api.highlight.visible = true;
}

/** 格位脉冲（事件反馈） */
export function pulseTile(scene, i, colorHex = 0xf0c96a) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CELL * 0.4, CELL * 0.52, 36),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  const pos = tileWorldPos(i, 0.24);
  ring.position.set(pos.x, pos.y, pos.z);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const t0 = performance.now();
  const anim = () => {
    const u = (performance.now() - t0) / 650;
    if (u >= 1) { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return; }
    const s = 1 + u * 0.7;
    ring.scale.set(s, s, 1);
    ring.material.opacity = 0.9 * (1 - u);
    requestAnimationFrame(anim);
  };
  anim();
}
