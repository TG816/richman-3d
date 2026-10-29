import * as THREE from 'three';
import { BOARD, GROUPS } from '@board';

/**
 * 3D 棋盘：40 格中国城市棋盘 + 中央 LOGO + 房屋/酒店 + 所属标记 + 拾取。
 * 格位坐标体系（俯视，+X 右，+Z 下）：
 *   0 起点在右下角 (10,10)，逆时针（1~9 沿底边向左，10~19 沿左边向上…）
 */
export const TILE = 2;      // 每格边长
export const HALF = 10;     // 最外格中心到棋盘中心

const cornerRot = { 0: Math.PI / 4, 10: -Math.PI / 4, 20: -Math.PI * 0.75, 30: Math.PI * 0.75 };

export function tileSlot(i) {
  if (i === 0 || i === 10 || i === 20 || i === 30) {
    const c = { 0: [HALF, HALF], 10: [-HALF, HALF], 20: [-HALF, -HALF], 30: [HALF, -HALF] }[i];
    return { x: c[0], z: c[1], rot: cornerRot[i], side: 'corner' };
  }
  if (i < 10) return { x: HALF - TILE * i, z: HALF, rot: 0, side: 'S' };
  if (i < 20) return { x: -HALF, z: HALF - TILE * (i - 10), rot: -Math.PI / 2, side: 'W' };
  if (i < 30) return { x: -HALF + TILE * (i - 20), z: -HALF, rot: Math.PI, side: 'N' };
  return { x: HALF, z: -HALF + TILE * (i - 30), rot: Math.PI / 2, side: 'E' };
}

export function tileWorldPos(i, y = 0) {
  const s = tileSlot(i);
  return new THREE.Vector3(s.x, y, s.z);
}

/* ================= 棋盘搭建 ================= */

export function buildBoard(scene) {
  const api = {
    tiles: [],            // mesh per tile
    ownerFrames: {},      // tileIdx -> frame mesh
    houseGroups: {},      // tileIdx -> group
    highlight: null,
    highlightTile: -1,
  };

  /* 底座 */
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x111a3c, roughness: 0.42, metalness: 0.55 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(TILE * 11 + 1.3, 1.1, TILE * 11 + 1.3), baseMat);
  base.position.y = -0.56;
  base.receiveShadow = true;
  scene.add(base);

  // 金色描边
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x6b5320, roughness: 0.3, metalness: 0.9,
    emissive: 0xf0c96a, emissiveIntensity: 0.55,
  });
  const outer = TILE * 11 + 1.3;
  for (const [w, d, x, z] of [
    [outer + 0.14, 0.14, 0, outer / 2], [outer + 0.14, 0.14, 0, -outer / 2],
    [0.14, outer + 0.14, outer / 2, 0], [0.14, outer + 0.14, -outer / 2, 0],
  ]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), trimMat);
    trim.position.set(x, 0.02, z);
    scene.add(trim);
  }

  /* 40 格 */
  for (let i = 0; i < 40; i++) {
    const s = tileSlot(i);
    const tex = makeTileTexture(i);
    const isCorner = s.side === 'corner';
    const geo = new THREE.BoxGeometry(isCorner ? TILE : TILE * 0.985, 0.42, isCorner ? TILE : TILE * 0.985);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.5, metalness: 0.08,
      color: 0xffffff,
      emissive: 0x22222a, emissiveIntensity: 0.25,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.x, 0.21, s.z);
    m.rotation.y = s.rot;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.tileIndex = i;
    scene.add(m);
    api.tiles[i] = m;

    // 房屋容器（随格子旋转）
    const hg = new THREE.Group();
    hg.position.copy(m.position);
    hg.rotation.y = s.rot;
    scene.add(hg);
    api.houseGroups[i] = hg;
  }

  /* 中央 LOGO 平台 */
  const logo = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 9 + 0.4, 0.3, TILE * 9 + 0.4),
    new THREE.MeshStandardMaterial({ map: makeCenterTexture(), roughness: 0.42, metalness: 0.35 })
  );
  logo.position.y = 0.15;
  logo.receiveShadow = true;
  scene.add(logo);

  // 骰盘
  const tray = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.9, 0.18, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a2350, roughness: 0.35, metalness: 0.6 })
  );
  tray.position.set(0, 0.38, 0);
  tray.receiveShadow = true;
  scene.add(tray);
  const trayRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.75, 0.045, 12, 64),
    new THREE.MeshStandardMaterial({ color: 0x6b5320, emissive: 0xf0c96a, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.3 })
  );
  trayRing.rotation.x = -Math.PI / 2;
  trayRing.position.set(0, 0.47, 0);
  scene.add(trayRing);

  /* 当前格高亮 */
  const hlTex = makeGlowTexture();
  api.highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE * 1.25, TILE * 1.25),
    new THREE.MeshBasicMaterial({ map: hlTex, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  api.highlight.rotation.x = -Math.PI / 2;
  api.highlight.visible = false;
  scene.add(api.highlight);

  /* 拾取 */
  return api;
}

/** 绑定点击拾取（拖动不触发），返回 tileIndex 或 null */
export function attachPicking(camera, dom, boardApi, onClick) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 6) return; // 视为拖拽
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(boardApi.tiles.filter(Boolean), false);
    if (hits.length) onClick(hits[0].object.userData.tileIndex);
  });
}

/* ================= 动态外观 ================= */

export function setTileOwner(api, i, colorHex) {
  const old = api.ownerFrames[i];
  if (old) { old.parent?.remove(old); api.ownerFrames[i] = null; }
  if (!colorHex) return;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 1.02, 0.1, TILE * 1.02),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex), transparent: true, opacity: 0.95 })
  );
  const pos = tileWorldPos(i, 0);
  frame.position.set(pos.x, 0.44, pos.z);
  frame.rotation.y = tileSlot(i).rot;
  api.tiles[i].parent.add(frame);
  api.ownerFrames[i] = frame;
}

export function setTileHouses(api, i, n) {
  const g = api.houseGroups[i];
  while (g.children.length) {
    const c = g.children.pop();
    c.geometry?.dispose(); c.material?.dispose();
  }
  if (!n) return;
  const t = BOARD[i];
  const houseMat = new THREE.MeshStandardMaterial({ color: 0x35b478, roughness: 0.4, emissive: 0x0f5c38, emissiveIntensity: 0.4 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xd8d8e2, roughness: 0.5 });
  const hotelMat = new THREE.MeshStandardMaterial({ color: 0xe2504a, roughness: 0.4, emissive: 0x6b1a16, emissiveIntensity: 0.5 });
  const z = -TILE / 2 + 0.32; // 朝棋盘中心一侧
  if (n >= 5) {
    const hotel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.4), hotelMat);
    hotel.position.set(0, 0.56, z);
    hotel.castShadow = true;
    g.add(hotel);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.26, 4), roofMat);
    roof.position.set(0, 0.86, z);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
  } else {
    const xs = [-0.66, -0.22, 0.22, 0.66].slice(0, n);
    for (const x of xs) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.3), houseMat);
      h.position.set(x, 0.54, z);
      h.castShadow = true;
      g.add(h);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 4), roofMat);
      roof.position.set(x, 0.76, z);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
    }
  }
}

export function moveHighlight(api, i) {
  api.highlightTile = i;
  if (i < 0) { api.highlight.visible = false; return; }
  const pos = tileWorldPos(i, 0.46);
  api.highlight.position.set(pos.x, pos.y, pos.z);
  api.highlight.visible = true;
}

/** 格位脉冲（事件反馈） */
export function pulseTile(scene, i, colorHex = 0xf0c96a) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.5, TILE * 0.62, 40),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  const pos = tileWorldPos(i, 0.47);
  ring.position.set(pos.x, pos.y, pos.z);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const t0 = performance.now();
  const anim = () => {
    const u = (performance.now() - t0) / 650;
    if (u >= 1) { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return; }
    const s = 1 + u * 1.1;
    ring.scale.set(s, s, 1);
    ring.material.opacity = 0.9 * (1 - u);
    requestAnimationFrame(anim);
  };
  anim();
}

/* ================= 程序化贴图 ================= */

function makeTileTexture(i) {
  const t = BOARD[i];
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const isCorner = i % 10 === 0;

  // 纸面底色
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#f5eeda');
  grad.addColorStop(1, '#e9dfc4');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  if (isCorner) {
    // 金色斜纹边框
    g.strokeStyle = '#b98d3c';
    g.lineWidth = 10;
    g.strokeRect(8, 8, S - 16, S - 16);
    g.fillStyle = '#8a6a2a';
    const icons = { 0: '🎲', 10: '⛓️', 20: '🅿️', 30: '🚔' };
    g.font = '96px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icons[i], S / 2, S / 2 - 18);
    g.font = 'bold 30px "Microsoft YaHei"';
    g.fillStyle = '#5d4a1e';
    g.fillText(t.name, S / 2, S - 48);
    return toTex(cv);
  }

  const grp = t.type === 'prop' ? GROUPS[t.group] : null;

  // 色带（贴图顶端 = 面向棋盘中心的一侧）
  if (grp) {
    g.fillStyle = hex(grp.color);
    g.fillRect(0, 0, S, 44);
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(0, 36, S, 8);
  } else if (t.type === 'station') {
    g.fillStyle = '#3c4664';
    g.fillRect(0, 0, S, 44);
  } else if (t.type === 'utility') {
    g.fillStyle = '#4a6a8a';
    g.fillRect(0, 0, S, 44);
  } else if (t.type === 'chance' || t.type === 'fate') {
    g.fillStyle = t.type === 'chance' ? '#e8923d' : '#5a8df0';
    g.fillRect(0, 0, S, 44);
  }

  g.textAlign = 'center';
  g.fillStyle = '#2c2c38';

  const icons = { chance: '❓', fate: '🎁', tax: '💰', station: '🚄', utility: t.name.includes('水') ? '💧' : '⚡' };
  if (icons[t.type]) {
    g.font = '72px sans-serif';
    g.fillText(icons[t.type], S / 2, 118);
    g.font = 'bold 34px "Microsoft YaHei"';
    g.fillStyle = '#2c2c38';
    g.fillText(t.name, S / 2, 186);
    if (t.price) {
      g.font = 'bold 30px "Microsoft YaHei"';
      g.fillStyle = '#7a6a45';
      g.fillText(`¥${fmt(t.price)}`, S / 2, 226);
    }
    if (t.type === 'tax') {
      g.font = 'bold 30px "Microsoft YaHei"';
      g.fillStyle = '#a05248';
      g.fillText(`缴 ¥${fmt(t.amount)}`, S / 2, 222);
    }
    return toTex(cv);
  }

  // 普通地块：街名（过长两行）+ 价格
  g.font = 'bold 35px "Microsoft YaHei"';
  if (t.name.length > 4) {
    const mid = Math.ceil(t.name.length / 2);
    g.fillText(t.name.slice(0, mid), S / 2, 128);
    g.fillText(t.name.slice(mid), S / 2, 168);
  } else {
    g.fillText(t.name, S / 2, 148);
  }
  g.font = 'bold 30px "Microsoft YaHei"';
  g.fillStyle = '#7a6a45';
  g.fillText(`¥${fmt(t.price)}`, S / 2, 220);
  return toTex(cv);
}

function makeCenterTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 60, S / 2, S / 2, S / 1.5);
  grad.addColorStop(0, '#1b2650');
  grad.addColorStop(0.6, '#101838');
  grad.addColorStop(1, '#0a1028');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // 金环
  g.strokeStyle = 'rgba(240,201,106,.5)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(S / 2, S / 2, 330, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(240,201,106,.22)';
  g.beginPath(); g.arc(S / 2, S / 2, 300, 0, Math.PI * 2); g.stroke();

  // 金币徽章
  const coin = g.createLinearGradient(S / 2 - 110, S / 2 - 240, S / 2 + 110, S / 2 - 20);
  coin.addColorStop(0, '#ffe9ae');
  coin.addColorStop(0.55, '#f0c96a');
  coin.addColorStop(1, '#b98d3c');
  g.fillStyle = coin;
  g.beginPath(); g.arc(S / 2, S / 2 - 130, 108, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(60,44,8,.9)';
  g.font = '900 120px "Microsoft YaHei"';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('¥', S / 2, S / 2 - 122);

  // 标题
  const titleGrad = g.createLinearGradient(0, S / 2 - 10, 0, S / 2 + 130);
  titleGrad.addColorStop(0, '#fff6dd');
  titleGrad.addColorStop(1, '#caa145');
  g.fillStyle = titleGrad;
  g.font = '900 150px "Microsoft YaHei"';
  g.fillText('大富翁', S / 2, S / 2 + 60);
  g.font = 'italic 900 64px Georgia';
  g.fillStyle = 'rgba(240,201,106,.9)';
  g.fillText('RICHMAN · 3D', S / 2, S / 2 + 165);
  g.font = '28px "Microsoft YaHei"';
  g.fillStyle = 'rgba(154,163,199,.8)';
  g.fillText('星 夜 都 会 · 谁 是 最 后 的 大 亨', S / 2, S / 2 + 235);
  return toTex(cv);
}

function makeGlowTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,230,150,.9)');
  grad.addColorStop(0.55, 'rgba(255,205,100,.35)');
  grad.addColorStop(1, 'rgba(255,205,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function toTex(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function fmt(n) { return n.toLocaleString('en-US'); }
