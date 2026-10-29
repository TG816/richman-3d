import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * 3D 场景骨架：渲染器、星空都市环境、灯光、Bloom 后期、镜头控制。
 * 棋盘/棋子/骰子等由各自模块挂到 scene 上。
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a17);
  scene.fog = new THREE.FogExp2(0x070b1a, 0.0075);

  // 环境反射（程序化生成，无需外部 HDR）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(24, 26, 30);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 12;
  controls.maxDistance = 85;
  controls.maxPolarAngle = 1.34;
  controls.minPolarAngle = 0.18;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);

  /* ---------- 灯光 ---------- */
  scene.add(new THREE.HemisphereLight(0x36436e, 0x0a0c1a, 0.55));

  const key = new THREE.DirectionalLight(0xffe2b8, 1.0);
  key.position.set(20, 34, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x5a78d8, 0.35);
  fill.position.set(-18, 20, -16);
  scene.add(fill);

  const spot = new THREE.SpotLight(0xfff0d0, 120, 90, 0.62, 0.55, 1.6);
  spot.position.set(0, 30, 0.01);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  scene.add(spot, spot.target);

  /* ---------- 地面 ---------- */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(140, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0f24, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- 远景：星夜都会 ---------- */
  buildSkyline(scene);
  buildStars(scene);

  /* ---------- 后期：Bloom ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- 聚焦目标（平滑跟随当前玩家） ---------- */
  const focus = { target: new THREE.Vector3(0, 0, 0), active: false };
  function focusOn(vec3, immediate = false) {
    focus.target.copy(vec3);
    focus.active = true;
    if (immediate) controls.target.copy(vec3);
  }
  function resetFocus() {
    focus.target.set(0, 0, 0);
    focus.active = true;
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock();
  const tickers = []; // 各模块注册的每帧更新 (dt, t)
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (focus.active) {
      controls.target.lerp(focus.target, 1 - Math.pow(0.0018, dt));
      if (controls.target.distanceTo(focus.target) < 0.01) focus.active = false;
    }
    for (const fn of tickers) fn(dt, t);
    controls.update();
    composer.render();
  });

  return {
    renderer, scene, camera, controls, composer,
    tickers, focusOn, resetFocus, bloom,
    setAutoRotate(on) { controls.autoRotate = on; controls.autoRotateSpeed = 0.7; },
  };
}

/* ============ 远景楼群 ============ */
function buildSkyline(scene) {
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 64; winCanvas.height = 128;
  const g = winCanvas.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 9) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.42) {
        g.fillStyle = Math.random() < 0.85 ? '#ffd98a' : '#9fd4ff';
        g.globalAlpha = 0.35 + Math.random() * 0.65;
        g.fillRect(x, y, 4, 5);
      }
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x131a38, roughness: 0.8, metalness: 0.25,
    emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.85,
  });
  const box = new THREE.BoxGeometry(1, 1, 1);

  const group = new THREE.Group();
  const N = 110;
  for (let i = 0; i < N; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 36 + Math.random() * 66;
    const w = 2.2 + Math.random() * 4;
    const h = 5 + Math.random() * (r > 60 ? 30 : 20);
    const m = new THREE.Mesh(box, mat);
    m.position.set(Math.cos(ang) * r, h / 2, Math.sin(ang) * r);
    m.scale.set(w, h, w * (0.7 + Math.random() * 0.6));
    m.rotation.y = Math.random() * Math.PI;
    group.add(m);
  }
  // 金色尖顶地标
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0x2a2412, roughness: 0.4, metalness: 0.8,
    emissive: 0xf0c96a, emissiveIntensity: 0.5,
  });
  for (const [x, z, h] of [[-48, -30, 42], [52, 20, 36], [18, -58, 30]]) {
    const m = new THREE.Mesh(box, goldMat);
    m.position.set(x, h / 2, z);
    m.scale.set(3.4, h, 3.4);
    group.add(m);
  }
  scene.add(group);
}

function buildStars(scene) {
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const el = Math.random() * Math.PI * 0.48 + 0.08;
    const r = 120 + Math.random() * 60;
    pos[i * 3] = Math.cos(ang) * Math.cos(el) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.sin(ang) * Math.cos(el) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 0.55, sizeAttenuation: true,
    transparent: true, opacity: 0.75,
  }));
  scene.add(stars);
}
