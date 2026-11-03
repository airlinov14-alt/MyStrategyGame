import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ============================================================================
// 1. ИНИЦИАЛИЗАЦИЯ СЦЕНЫ, КАМЕРЫ И ОСВЕЩЕНИЯ
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e242b);
scene.fog = new THREE.FogExp2(0x1e242b, 0.014);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.025, 260);
camera.position.set(0, 1.70, 0);
scene.add(camera);

const scopeRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
});
const scopeCamera = new THREE.PerspectiveCamera(14.5, 1.0, 0.15, 260);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xe2ecf5, 0x3d403a, 1.1);
hemiLight.position.set(0, 30, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff6e8, 2.25);
sunLight.position.set(14, 24, 16);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048;
scene.add(sunLight);

const backLight = new THREE.DirectionalLight(0xd0e2f5, 1.45);
backLight.position.set(-14, 16, -18);
scene.add(backLight);

const viewmodelFillLight = new THREE.PointLight(0xdbe8f4, 0.55, 2.5);
viewmodelFillLight.position.set(0.15, 0.25, 0.1);
camera.add(viewmodelFillLight);

// ============================================================================
// 2. АУДИО-СИНТЕЗАТОР (WEB AUDIO API)
// ============================================================================
class WeaponSoundEngine {
  constructor() { this.ctx = null; }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  playShot(profile) {
    this.init();
    const now = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.26), this.ctx.sampleRate);
    const out = buf.getChannelData(0);
    for (let i = 0; i < buf.length; i++) out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * profile.decay));
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.setValueAtTime(profile.cutoff, now);
    const gain = this.ctx.createGain(); gain.gain.setValueAtTime(profile.volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    src.connect(filt); filt.connect(gain); gain.connect(this.ctx.destination); src.start(now);
  }
  playExplosion() {
    this.init();
    const now = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 1.8), this.ctx.sampleRate);
    const out = buf.getChannelData(0);
    for (let i = 0; i < buf.length; i++) out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.45));
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.setValueAtTime(650, now);
    const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.95, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 1.7);
    src.connect(filt); filt.connect(gain); gain.connect(this.ctx.destination); src.start(now);
  }
  playMetallicClick(freq = 900, duration = 0.045, vol = 0.18) {
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(vol, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + duration);
  }
  playHitSound(isHeadshot = false) {
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.type = isHeadshot ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isHeadshot ? 1450 : 320, now);
    gain.gain.setValueAtTime(0.28, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + 0.075);
  }
}
const soundEngine = new WeaponSoundEngine();

// ============================================================================
// 3. ПРОЦЕДУРНЫЕ ТЕКСТУРЫ И СЕТКИ ПРИЦЕЛОВ
// ============================================================================
function createReticleTexture(type) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d'); const cx = 256; const cy = 256;
  ctx.clearRect(0, 0, 512, 512);
  if (type === 'RED_DOT') {
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 28);
    glow.addColorStop(0, 'rgba(255, 60, 40, 1.0)'); glow.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff5f2'; ctx.beginPath(); ctx.arc(cx, cy, 4.2, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'HOLO_EOTECH') {
    ctx.strokeStyle = '#ff3824'; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.arc(cx, cy, 68, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffece8'; ctx.beginPath(); ctx.arc(cx, cy, 3.8, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'SCOPE_MILDOT') {
    const edgeGrad = ctx.createRadialGradient(cx, cy, 205, cx, cy, 255);
    edgeGrad.addColorStop(0, 'rgba(0,0,0,0)'); edgeGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = edgeGrad; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#ff2a1c'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(cx - 10, cy + 8); ctx.lineTo(cx, cy - 2); ctx.lineTo(cx + 10, cy + 8); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const reticleTextures = {
  redDot: createReticleTexture('RED_DOT'),
  holo: createReticleTexture('HOLO_EOTECH'),
  scopeMilDot: createReticleTexture('SCOPE_MILDOT')
};

// ============================================================================
// 4. КОНСТРУКТОР ПЕРСОНАЖЕЙ (ИГРОК И ИИ-БОТЫ)
// ============================================================================
function createSculptedLimbGeometry(profilePoints, segments = 20, scaleX = 1.0, scaleZ = 1.0) {
  const lathePts = profilePoints.map(([r, y]) => new THREE.Vector2(r, y));
  const geom = new THREE.LatheGeometry(lathePts, segments);
  geom.scale(scaleX, 1, scaleZ); geom.computeVertexNormals();
  return geom;
}

function createArmorPlateGeometry(width, height, depth, topBevel = 0.05) {
  const shape = new THREE.Shape();
  const hw = width / 2; const hh = height / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh - topBevel); shape.lineTo(hw - topBevel * 0.85, hh);
  shape.lineTo(-hw + topBevel * 0.85, hh); shape.lineTo(-hw, hh - topBevel);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { steps: 1, depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012 });
  geom.center(); return geom;
}

const sharedGeometries = {
  calf: createSculptedLimbGeometry([[0.058, 0.0], [0.068, 0.05], [0.082, 0.24], [0.074, 0.42]], 20, 0.96, 1.05),
  thigh: createSculptedLimbGeometry([[0.075, 0.0], [0.088, 0.10], [0.102, 0.24], [0.104, 0.44]], 20, 0.98, 1.06),
  pelvis: createSculptedLimbGeometry([[0.155, 0.0], [0.188, 0.06], [0.178, 0.22]], 24, 1.12, 0.82),
  torso: createSculptedLimbGeometry([[0.172, 0.0], [0.205, 0.28], [0.218, 0.40], [0.110, 0.53]], 24, 1.18, 0.82),
  upperArm: createSculptedLimbGeometry([[0.058, 0.0], [0.072, 0.17], [0.082, 0.26]], 18, 0.96, 1.04),
  forearm: createSculptedLimbGeometry([[0.044, 0.0], [0.060, 0.18], [0.062, 0.26]], 18, 0.95, 1.02),
  headCranium: createSculptedLimbGeometry([[0.066, 0.0], [0.086, 0.16], [0.088, 0.23], [0.001, 0.345]], 24, 0.96, 0.92)
};

function buildSoldierCharacter(config) {
  const { faction, roleTitle, description } = config;
  const soldierRoot = new THREE.Group();

  const uniformMat = new THREE.MeshStandardMaterial({ color: faction === 'RU' ? 0x4e543c : 0x6c684f, roughness: 0.86 });
  const vestMat = new THREE.MeshStandardMaterial({ color: faction === 'RU' ? 0x3b4229 : 0x51533c, roughness: 0.82 });

  const leftLegGroup = new THREE.Group(); leftLegGroup.position.set(-0.125, 0, 0);
  const rightLegGroup = new THREE.Group(); rightLegGroup.position.set(0.125, 0, 0);

  leftLegGroup.add(new THREE.Mesh(sharedGeometries.thigh, uniformMat));
  rightLegGroup.add(new THREE.Mesh(sharedGeometries.thigh, uniformMat));
  soldierRoot.add(leftLegGroup, rightLegGroup);

  const upperBodyGroup = new THREE.Group();
  upperBodyGroup.position.set(0, 1.06, -0.008);
  upperBodyGroup.add(new THREE.Mesh(sharedGeometries.torso, uniformMat));

  const frontPlate = new THREE.Mesh(createArmorPlateGeometry(0.29, 0.35, 0.036), vestMat);
  frontPlate.position.set(0, 0.255, 0.162);
  upperBodyGroup.add(frontPlate);

  const leftArmGroup = new THREE.Group(); leftArmGroup.position.set(-0.255, 0.43, 0);
  const rightArmGroup = new THREE.Group(); rightArmGroup.position.set(0.255, 0.43, 0);
  upperBodyGroup.add(leftArmGroup, rightArmGroup);

  const head = new THREE.Mesh(sharedGeometries.headCranium, new THREE.MeshStandardMaterial({ color: 0x2f3726 }));
  head.position.set(0, 0.48, 0);
  upperBodyGroup.add(head);

  soldierRoot.add(upperBodyGroup);

  const soldierState = {
    isSoldier: true,
    faction: faction,
    title: roleTitle,
    details: description,
    hp: 100,
    maxHp: 100,
    isDown: false,
    root: soldierRoot,
    upperBody: upperBodyGroup,
    leftLeg: leftLegGroup,
    rightLeg: rightLegGroup,
    animTime: Math.random() * 10,
    // ИИ-параметры (Этап 7)
    aiState: 'PATROL', // PATROL, CHASE, ATTACK
    targetPos: new THREE.Vector3(),
    patrolTimer: 0,
    shootCooldown: 0
  };
  soldierRoot.userData = soldierState;

  const headHitBox = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  headHitBox.position.set(0, 1.54, 0); headHitBox.userData = { soldierState, hitZone: 'head' };
  soldierRoot.add(headHitBox);

  const chestHitBox = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.55, 8), new THREE.MeshBasicMaterial({ visible: false }));
  chestHitBox.position.set(0, 1.25, 0); chestHitBox.userData = { soldierState, hitZone: 'torso' };
  soldierRoot.add(chestHitBox);

  const limbsHitBox = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8), new THREE.MeshBasicMaterial({ visible: false }));
  limbsHitBox.position.set(0, 0.55, 0); limbsHitBox.userData = { soldierState, hitZone: 'limbs' };
  soldierRoot.add(limbsHitBox);

  return { root: soldierRoot, hitBoxes: [headHitBox, chestHitBox, limbsHitBox], state: soldierState };
}

// ============================================================================
// 5. ОРУЖИЕ ИГРОКА
// ============================================================================
const gunMaterials = {
  bluedSteel: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.30, metalness: 0.88 }),
  darkAnodized: new THREE.MeshStandardMaterial({ color: 0x181b1f, roughness: 0.36, metalness: 0.82 })
};

function buildAK74MModel() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.056, 0.255), gunMaterials.bluedSteel));
  return { root, muzzlePos: new THREE.Vector3(0, 0.004, -0.60), hipOffset: new THREE.Vector3(0.18, -0.19, -0.36), adsOffset: new THREE.Vector3(0.0, -0.048, -0.20) };
}

function buildAK12Model() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.056, 0.258), gunMaterials.darkAnodized));
  return { root, muzzlePos: new THREE.Vector3(0, 0.004, -0.60), hipOffset: new THREE.Vector3(0.18, -0.19, -0.36), adsOffset: new THREE.Vector3(0.0, -0.066, -0.19) };
}

function buildM4A1Model() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.046, 0.205), gunMaterials.darkAnodized));
  return { root, muzzlePos: new THREE.Vector3(0, 0.016, -0.54), hipOffset: new THREE.Vector3(0.18, -0.19, -0.35), adsOffset: new THREE.Vector3(0.0, -0.068, -0.19) };
}

function buildHK416Model() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.054, 0.215), gunMaterials.darkAnodized));
  return { root, muzzlePos: new THREE.Vector3(0, 0.018, -0.61), hipOffset: new THREE.Vector3(0.18, -0.19, -0.35), adsOffset: new THREE.Vector3(0.0, -0.076, -0.175) };
}

function buildPistolModel() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.020, 0.182), gunMaterials.darkAnodized));
  return { root, muzzlePos: new THREE.Vector3(0, 0.018, -0.125), hipOffset: new THREE.Vector3(0.15, -0.18, -0.33), adsOffset: new THREE.Vector3(0.0, -0.039, -0.25) };
}

const weaponsData = [
  { id: 'ak74m', name: 'АК-74М', fireModeText: '5.45×39 ММ', opticLabel: 'МЕХАНИЧЕСКИЙ', opticType: 'iron', damage: 34, headshotMult: 3.0, magSize: 30, magAmmo: 30, reserveAmmo: 120, reloadTime: 2.15, adsCameraFov: 52, soundProfile: { cutoff: 1850, decay: 0.065, volume: 0.42 }, builder: buildAK74MModel },
  { id: 'ak12', name: 'АК-12', fireModeText: '5.45×39 ММ', opticLabel: 'КОЛЛИМАТОР', opticType: 'collimator', damage: 35, headshotMult: 3.0, magSize: 30, magAmmo: 30, reserveAmmo: 120, reloadTime: 2.0, adsCameraFov: 48, soundProfile: { cutoff: 2100, decay: 0.058, volume: 0.40 }, builder: buildAK12Model },
  { id: 'm4a1', name: 'M4A1', fireModeText: '5.56×45 НАТО', opticLabel: 'ГОЛОГРАФ', opticType: 'holographic', damage: 31, headshotMult: 3.0, magSize: 30, magAmmo: 30, reserveAmmo: 120, reloadTime: 1.95, adsCameraFov: 48, soundProfile: { cutoff: 2450, decay: 0.052, volume: 0.38 }, builder: buildM4A1Model },
  { id: 'hk416', name: 'HK416', fireModeText: '5.56×45 НАТО', opticLabel: 'ОПТИКА 4.5×', opticType: 'magnified_scope', damage: 34, headshotMult: 3.0, magSize: 30, magAmmo: 30, reserveAmmo: 120, reloadTime: 1.90, adsCameraFov: 56, soundProfile: { cutoff: 980, decay: 0.038, volume: 0.28 }, builder: buildHK416Model },
  { id: 'pistol', name: 'ГРАЧ', fireModeText: '9×19 ММ', opticLabel: 'МЕХАНИКА', opticType: 'iron', damage: 28, headshotMult: 3.5, magSize: 18, magAmmo: 18, reserveAmmo: 72, reloadTime: 1.55, adsCameraFov: 56, soundProfile: { cutoff: 2700, decay: 0.042, volume: 0.36 }, builder: buildPistolModel }
];

const weaponRig = new THREE.Group(); camera.add(weaponRig);
weaponsData.forEach((w) => {
  w.model = w.builder(); w.model.root.visible = false; weaponRig.add(w.model.root);
});

let playerGrenadesCount = 3;
const activeGrenades = [];
const grenadeGeom = new THREE.SphereGeometry(0.042, 12, 12);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3d4735, roughness: 0.65 });

function throwGrenade() {
  if (playerGrenadesCount <= 0 || isPlayerDead) return;
  playerGrenadesCount--;
  document.getElementById('hud-grenade-count').textContent = playerGrenadesCount;
  soundEngine.playMetallicClick(500, 0.05, 0.2);

  const grenadeMesh = new THREE.Mesh(grenadeGeom, grenadeMat);
  grenadeMesh.position.copy(camera.position).add(new THREE.Vector3(0, -0.15, 0));
  const vel = new THREE.Vector3(0, 0.25, -1).applyQuaternion(camera.quaternion).normalize().multiplyScalar(14.5);
  scene.add(grenadeMesh);
  activeGrenades.push({ mesh: grenadeMesh, vel, timer: 3.0 });
}

const activeEffects = [];
function triggerExplosion(pos) {
  soundEngine.playExplosion();
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.95 }));
  flash.position.copy(pos);
  scene.add(flash);
  activeEffects.push({ mesh: flash, isExplosion: true, life: 0.35, maxLife: 0.35 });

  const dist = pos.distanceTo(camera.position);
  if (dist < 10.0) {
    playerHp = Math.max(0, playerHp - Math.round(85 * (1.0 - dist / 10.0)));
    updatePlayerHPUI();
    if (playerHp <= 0) triggerPlayerDeath();
  }

  allSoldiersStates.forEach((st) => {
    if (st.isDown) return;
    const d = pos.distanceTo(st.root.position);
    if (d < 10.0) {
      st.hp = Math.max(0, st.hp - Math.round(95 * (1.0 - d / 10.0)));
      if (st.hp <= 0) { st.isDown = true; }
    }
  });
}

// ============================================================================
// 6. СОЗДАНИЕ КАРТЫ И СПАВН БОТОВ (ЭТАП 7)
// ============================================================================
function createGroundArena() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x25292e, roughness: 0.85 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
}
createGroundArena();

const soldierHitBoxes = [];
const allSoldiersStates = [];

// Спавним отряды ИИ (ВС РФ и ВСУ)
const botsConfigs = [
  { faction: 'RU', roleTitle: 'Боец ВС РФ #1', description: 'Стрелок', x: -5, z: -15 },
  { faction: 'RU', roleTitle: 'Боец ВС РФ #2', description: 'Штурмовик', x: 5, z: -18 },
  { faction: 'UA', roleTitle: 'Боец ВСУ #1', description: 'Стрелок', x: -4, z: 15 },
  { faction: 'UA', roleTitle: 'Боец ВСУ #2', description: 'Штурмовик', x: 6, z: 18 }
];

botsConfigs.forEach((cfg) => {
  const { root, hitBoxes, state } = buildSoldierCharacter(cfg);
  root.position.set(cfg.x, 0, cfg.z);
  scene.add(root);
  soldierHitBoxes.push(...hitBoxes);
  allSoldiersStates.push(state);
});

// ============================================================================
// 7. ИГРОВОЙ ЦИКЛ, ИИ И УПРАВЛЕНИЕ
// ============================================================================
const controls = new PointerLockControls(camera, document.body);
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const deathScreen = document.getElementById('death-screen');
const scopeVignetteEl = document.getElementById('scope-vignette');
const damageVignetteEl = document.getElementById('damage-vignette');
const opticStatusEl = document.getElementById('optic-status');
const stanceDisplayEl = document.getElementById('stance-display');

let playerHp = 100;
let isPlayerDead = false;
let playerStance = 'stand';
let targetCameraHeight = 1.70;

function updatePlayerHPUI() {
  document.getElementById('player-hp-val').textContent = `${playerHp} / 100`;
  document.getElementById('player-hp-fill').style.width = `${playerHp}%`;
  damageVignetteEl.style.opacity = playerHp < 30 ? ((30 - playerHp) / 30 * 0.75).toFixed(2) : '0';
}

function triggerPlayerDeath() {
  if (isPlayerDead) return;
  isPlayerDead = true; controls.unlock(); deathScreen.classList.remove('hidden');
}

function restartGame() {
  playerHp = 100; isPlayerDead = false; playerGrenadesCount = 3;
  document.getElementById('hud-grenade-count').textContent = playerGrenadesCount;
  updatePlayerHPUI(); deathScreen.classList.add('hidden');
  camera.position.set(0, 1.70, 0); controls.lock();

  allSoldiersStates.forEach((st, idx) => {
    st.hp = st.maxHp; st.isDown = false; st.root.rotation.x = 0; st.root.position.y = 0;
    st.root.position.set(botsConfigs[idx].x, 0, botsConfigs[idx].z);
  });
}

startBtn.addEventListener('click', () => { soundEngine.init(); controls.lock(); });
restartBtn.addEventListener('click', () => restartGame());
controls.addEventListener('lock', () => { if (!isPlayerDead) overlay.classList.add('hidden'); });
controls.addEventListener('unlock', () => { if (!isPlayerDead) overlay.classList.remove('hidden'); });

let currentWeaponIdx = 0;
function equipWeaponImmediate(idx) {
  weaponsData.forEach((w, i) => { w.model.root.visible = (i === idx); });
  currentWeaponIdx = idx;
  weaponsData[idx].model.root.position.copy(weaponsData[idx].model.hipOffset);
}
equipWeaponImmediate(0);

const shootRaycaster = new THREE.Raycaster();
function fireSingleShot() {
  const w = weaponsData[currentWeaponIdx];
  if (w.magAmmo <= 0 || isPlayerDead) return;
  w.magAmmo--;
  soundEngine.playShot(w.soundProfile);

  shootRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = shootRaycaster.intersectObjects(soldierHitBoxes, false);
  if (hits.length > 0) {
    const { soldierState, hitZone } = hits[0].object.userData;
    let mult = (hitZone === 'head') ? w.headshotMult : ((hitZone === 'limbs') ? 0.65 : 1.0);
    soldierState.hp = Math.max(0, soldierState.hp - Math.round(w.damage * mult));
    if (soldierState.hp <= 0) soldierState.isDown = true;
    soundEngine.playHitSound(hitZone === 'head');
  }
}

const moveState = { forward: false, backward: false, left: false, right: false, sprint: false };
window.addEventListener('keydown', (e) => {
  if (!controls.isLocked || isPlayerDead) return;
  if (e.code === 'KeyW') moveState.forward = true;
  if (e.code === 'KeyS') moveState.backward = true;
  if (e.code === 'KeyA') moveState.left = true;
  if (e.code === 'KeyD') moveState.right = true;
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyR') weaponsData[currentWeaponIdx].magAmmo = weaponsData[currentWeaponIdx].magSize;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') moveState.forward = false;
  if (e.code === 'KeyS') moveState.backward = false;
  if (e.code === 'KeyA') moveState.left = false;
  if (e.code === 'KeyD') moveState.right = false;
});
window.addEventListener('mousedown', (e) => { if (controls.isLocked && e.button === 0) fireSingleShot(); });

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCameraHeight, delta * 10);

  if (controls.isLocked && !isPlayerDead) {
    const speed = 3.6;
    const fwd = Number(moveState.forward) - Number(moveState.backward);
    const rt = Number(moveState.right) - Number(moveState.left);
    if (fwd !== 0 || rt !== 0) {
      controls.moveForward(fwd * speed * delta);
      controls.moveRight(rt * speed * delta);
    }
  }

  // ==========================================================================
  // СИСТЕМА ИИ БОТОВ (ЭТАП 7): Конечный автомат (FSM)
  // ==========================================================================
  allSoldiersStates.forEach((st) => {
    if (st.isDown) {
      st.root.rotation.x = -Math.PI / 2;
      st.root.position.y = 0.12;
      return;
    }

    st.animTime += delta;
    const cycle = st.animTime * 4.5;
    st.leftLeg.rotation.x = Math.sin(cycle) * 0.35;
    st.rightLeg.rotation.x = -Math.sin(cycle) * 0.35;

    // Ищем ближайшего врага (игрок или бот противоположной фракции)
    let nearestTarget = null;
    let minDist = 25.0; // дальность обзора ИИ

    // Проверяем игрока как цель (если бот ВСУ или бот ВС РФ атакует игрока)
    const distToPlayer = st.root.position.distanceTo(camera.position);
    if (distToPlayer < minDist) {
      minDist = distToPlayer;
      nearestTarget = camera.position;
    }

    // Проверяем других ботов
    allSoldiersStates.forEach((other) => {
      if (other !== st && other.faction !== st.faction && !other.isDown) {
        const d = st.root.position.distanceTo(other.root.position);
        if (d < minDist) {
          minDist = d;
          nearestTarget = other.root.position;
        }
      }
    });

    if (nearestTarget) {
      st.aiState = 'ATTACK';
      st.root.lookAt(nearestTarget.x, st.root.position.y, nearestTarget.z);

      // Стрельба бота по цели
      st.shootCooldown -= delta;
      if (st.shootCooldown <= 0) {
        st.shootCooldown = 1.2; // темп стрельбы бота
        soundEngine.playShot({ cutoff: 1800, decay: 0.06, volume: 0.25 });
        
        // Если цель — игрок, наносим урон
        if (nearestTarget === camera.position) {
          playerHp = Math.max(0, playerHp - 12);
          updatePlayerHPUI();
          if (playerHp <= 0) triggerPlayerDeath();
        }
      }
    } else {
      st.aiState = 'PATROL';
      // Случайное патрулирование / движение
      st.patrolTimer -= delta;
      if (st.patrolTimer <= 0) {
        st.patrolTimer = 5.0;
        st.targetPos.set(st.root.position.x + (Math.random() - 0.5) * 10, 0, st.root.position.z + (Math.random() - 0.5) * 10);
      }
      st.root.lookAt(st.targetPos);
      st.root.translateZ(1.2 * delta);
    }
  });

  // Гранаты и эффекты
  for (let i = activeGrenades.length - 1; i >= 0; i--) {
    const g = activeGrenades[i]; g.timer -= delta; g.vel.y -= 9.8 * delta;
    g.mesh.position.addScaledVector(g.vel, delta);
    if (g.mesh.position.y <= 0.04) { g.mesh.position.y = 0.04; g.vel.y *= -0.4; }
    if (g.timer <= 0) { triggerExplosion(g.mesh.position); scene.remove(g.mesh); activeGrenades.splice(i, 1); }
  }

  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const ef = activeEffects[i]; ef.life -= delta;
    if (ef.isExplosion) {
      const scale = (1.0 - ef.life / ef.maxLife) * 12.0;
      ef.mesh.scale.set(scale, scale, scale); ef.mesh.material.opacity = ef.life / ef.maxLife;
    }
    if (ef.life <= 0) { scene.remove(ef.mesh); activeEffects.splice(i, 1); }
  }

  renderer.render(scene, camera);
}

animate();