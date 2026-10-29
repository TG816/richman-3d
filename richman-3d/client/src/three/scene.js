import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * 3D 场景 v2 —— 参考《大富翁4》明快观感：
 * 晴日天空（渐变天穹 + 白云）、暖阳、开阔草地街区。
 * 对局中镜头"局部跟随"当前角色（大富翁4式的卷动视角），可随时自由旋转/缩放。
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
  scene.fog = new THREE.Fog(0xd8ecff, 80, 210);
  scene.add(buildSkyDome());

  // 环境反射（程序化生成）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 420);
  camera.position.set(30, 26, 34);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 7;
  controls.maxDistance = 95;
  controls.maxPolarAngle = 1.38;
  controls.minPolarAngle = 0.15;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);

  /* ---------- 灯光：暖阳 ---------- */
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8fbb7d, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 1.45);
  sun.position.set(26, 40, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xbfd8ff, 0.3);
  fill.position.set(-20, 24, -18);
  scene.add(fill);

  /* ---------- 后期 ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- 聚焦目标（平滑跟随当前角色） ---------- */
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
  /** 对局开始：把镜头拉近到角色身边（大富翁4式局部视角），保持当前方位角 */
  function frameOn(vec3, distance = 17) {
    controls.target.copy(vec3);
    const dir = new THREE.Vector3(1, 1.02, 1).normalize(); // 固定舒适俯角（东南 45°）
    camera.position.copy(vec3).add(dir.multiplyScalar(distance));
    controls.update();
    focus.active = false;
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock();
  const tickers = [];
  const clouds = buildClouds(scene);
  tickers.push((dt, t) => updateClouds(clouds, dt, t));
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (focus.active) {
      const prev = controls.target.clone();
      controls.target.lerp(focus.target, 1 - Math.pow(0.0012, dt));
      const delta = controls.target.clone().sub(prev);
      camera.position.add(delta); // 刚性跟随：镜头随目标平移，保持大富翁4式局部视角
      if (controls.target.distanceTo(focus.target) < 0.02) focus.active = false;
    }
    for (const fn of tickers) fn(dt, t);
    controls.update();
    composer.render();
  });

  return {
    renderer, scene, camera, controls, composer,
    tickers, focusOn, resetFocus, frameOn, bloom,
    setAutoRotate(on) { controls.autoRotate = on; controls.autoRotateSpeed = 0.55; },
  };
}

/* ============ 天穹 ============ */
function buildSkyDome() {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4f8fd4');
  grad.addColorStop(0.45, '#8ec1ec');
  grad.addColorStop(0.78, '#cfe8f8');
  grad.addColorStop(1, '#f6ecd8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(200, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  return dome;
}

/* ============ 白云 ============ */
function buildClouds(scene) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, flatShading: false });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.3 + Math.random() * 1.3, 10, 8), mat);
      puff.position.set((k - n / 2) * 2.2 + Math.random(), Math.random() * 0.8, (Math.random() - 0.5) * 2);
      puff.scale.y = 0.62;
      c.add(puff);
    }
    const ang = Math.random() * Math.PI * 2;
    const r = 36 + Math.random() * 26;
    c.position.set(Math.cos(ang) * r, 26 + Math.random() * 10, Math.sin(ang) * r);
    c.userData.speed = 0.35 + Math.random() * 0.5;
    clouds.push(c);
    group.add(c);
  }
  scene.add(group);
  return clouds;
}

function updateClouds(clouds, dt, t) {
  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 66) c.position.x = -66;
    c.position.y += Math.sin(t * 0.4 + c.position.z) * 0.002;
  }
}
