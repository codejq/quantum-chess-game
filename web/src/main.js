import { Chess } from 'chess.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QuantumChessAgent } from './input/llm-agent.js';
import { initInstallPrompt } from './install-prompt.js';
import './styles/main.css';

const canvas = document.querySelector('#game-canvas');
const statusEl = document.querySelector('#game-status');
const engineStatusEl = document.querySelector('#engine-status');
const turnBadge = document.querySelector('#turn-badge');
const moveList = document.querySelector('#move-list');
const resetBtn = document.querySelector('#reset-btn');
const undoBtn = document.querySelector('#undo-btn');
const cameraBtn = document.querySelector('#camera-btn');
const soundBtn = document.querySelector('#sound-btn');
const piecesBtn = document.querySelector('#pieces-btn');
const modeBtn = document.querySelector('#mode-btn');
const zoomInBtn = document.querySelector('#zoom-in-btn');
const zoomOutBtn = document.querySelector('#zoom-out-btn');
const zoomLevelEl = document.querySelector('#zoom-level');

const BOARD_SIZE = 8;
const TILE_SIZE = 1.15;
const BOARD_OFFSET = ((BOARD_SIZE - 1) * TILE_SIZE) / 2;
const HUMAN_COLOR = 'w';
const ENGINE_COLOR = 'b';
const ENGINE_DEPTH = 10;
const ENGINE_MOVE_TIME = 900;
const ENGINE_START_DELAY = 160;
const COMPUTER_ANIMATION_MS = 620;
const STOCKFISH_WORKER_URL = './stockfish/stockfish-18-lite-single.js';
const ZOOM_STORAGE_KEY = 'quantum-chess-zoom-distance';
const PIECE_STYLE_STORAGE_KEY = 'quantum-chess-piece-style';
// Sculpted Staunton set: "Chess Set" by Riley Queen, Poly Haven (CC0).
const PIECE_MODEL_URL = './models/staunton-pieces.glb';
const PIECE_MODEL_SQUARE_SIZE = 0.0578881;
const PIECE_TEXTURE_DIR = './models/marble/';
const PIECE_STYLES = ['ebony', 'wood', 'marble', 'classic'];
const PIECE_STYLE_LABELS = { wood: 'Wood', ebony: 'Ebony', marble: 'Marble', classic: 'Classic' };
const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 20000,
};
const pieceTemplates = new Map();
const pieceModels = new Map();
const pieceMeshes = new Map();
const markerMeshes = [];
let selectedSquare = null;
let highlightedMoves = [];
let flipped = false;
let engineThinking = false;
let stockfishWorker = null;
let stockfishReady = false;
let stockfishRequest = null;
let lastMoveSquares = [];
let soundEnabled = true;
let audioContext = null;
let audioUnlocked = false;
let llmAgent = null;
let playMode = 'computer';

const game = new Chess();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111312);
scene.fog = new THREE.Fog(0x111312, 22, 46);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const initialZoomDistance = loadZoomDistance();
camera.position.set(4.9, 6.9, 7.4).setLength(initialZoomDistance);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 4.2;
controls.maxDistance = 22;
controls.target.set(0, 0, 0);
controls.addEventListener('end', () => {
  saveZoomDistance();
  updateZoomLevel();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const boardGroup = new THREE.Group();
const piecesGroup = new THREE.Group();
const markersGroup = new THREE.Group();
scene.add(boardGroup, piecesGroup, markersGroup);

const tileMaterialLight = new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.72 });
const tileMaterialDark = new THREE.MeshStandardMaterial({ color: 0x365f58, roughness: 0.78 });
const tileMaterialSelected = new THREE.MeshStandardMaterial({
  color: 0xe8bf67,
  emissive: 0x3d2805,
  roughness: 0.55,
});
const tileMaterialLastMove = new THREE.MeshStandardMaterial({
  color: 0x5f816f,
  emissive: 0x122318,
  roughness: 0.62,
});
const tileMaterialCheck = new THREE.MeshStandardMaterial({
  color: 0xe8bf67,
  emissive: 0x704300,
  roughness: 0.48,
});
const tileMaterialCheckmate = new THREE.MeshStandardMaterial({
  color: 0xb3262e,
  emissive: 0x7a060b,
  roughness: 0.45,
});
const pieceMaterials = {
  // Polished boxwood for White and ebony for Black, like a turned tournament set.
  wood: {
    w: createWoodMaterial({ light: 0xefd2a0, dark: 0xd2a56b, roughness: 0.36 }),
    b: createWoodMaterial({ light: 0x2c1d15, dark: 0x0f0906, roughness: 0.28 }),
  },
  // Tournament set: pale, fine-grained boxwood and glossy ebony, played on a maple and mahogany board.
  ebony: {
    w: createWoodMaterial({
      light: 0xf2cf86,
      dark: 0xd9a95c,
      roughness: 0.3,
      grain: { ring: 0.12, fibre: 0.22, tone: 0.3, ringScale: 40 },
      clearcoat: true,
    }),
    b: createWoodMaterial({
      light: 0x13100e,
      dark: 0x050404,
      roughness: 0.22,
      grain: { ring: 0.1, fibre: 0.2, tone: 0.3, ringScale: 40 },
      clearcoat: true,
    }),
  },
  classic: {
    w: new THREE.MeshStandardMaterial({ color: 0xf6eee0, metalness: 0.08, roughness: 0.42, side: THREE.DoubleSide }),
    b: new THREE.MeshStandardMaterial({ color: 0x202321, metalness: 0.16, roughness: 0.35, side: THREE.DoubleSide }),
  },
  // The model's own marble-like finish; its textures load the first time this style is picked.
  marble: null,
};
const boardWoodMaterials = {
  light: createWoodMaterial({
    light: 0xefdcb6,
    dark: 0xdcc296,
    roughness: 0.5,
    grain: { ring: 0.35, fibre: 0.3, tone: 0.3, ringScale: 9 },
    board: true,
  }),
  dark: createWoodMaterial({
    light: 0x8f5433,
    dark: 0x5e321c,
    roughness: 0.45,
    grain: { ring: 0.45, fibre: 0.3, tone: 0.3, ringScale: 9 },
    board: true,
  }),
};
let pieceDetailMaterial = null;
let pieceStyle = loadPieceStyle();
const markerMaterial = new THREE.MeshBasicMaterial({
  color: 0xe8bf67,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});

const tileMeshes = new Map();

initLights();
createBoard();
initStockfish();
initLlmAgent();
initInstallPrompt();
syncPieces();
loadPieceModels();
updateHud();
resize();
animate();
updateZoomLevel();

resetBtn.addEventListener('click', () => {
  game.reset();
  engineThinking = false;
  lastMoveSquares = [];
  clearSelection();
  syncPieces();
  playSound('move');
  updateHud();
});

undoBtn.addEventListener('click', () => {
  game.undo();
  if (playMode === 'computer' && game.turn() === ENGINE_COLOR) game.undo();
  engineThinking = false;
  lastMoveSquares = [];
  clearSelection();
  syncPieces();
  playSound('move');
  updateHud();
});

cameraBtn.addEventListener('click', () => {
  flipped = !flipped;
  cameraBtn.setAttribute('aria-pressed', String(flipped));
  const z = flipped ? -7.4 : 7.4;
  camera.position.set(4.9, 6.9, z);
  controls.target.set(0, 0, 0);
});

zoomInBtn.addEventListener('click', () => {
  zoomCamera(-1.25);
});

zoomOutBtn.addEventListener('click', () => {
  zoomCamera(1.25);
});

modeBtn.addEventListener('click', () => {
  playMode = playMode === 'computer' ? 'local' : 'computer';
  engineThinking = false;
  clearSelection();
  updateHud();
  if (playMode === 'computer' && game.turn() === ENGINE_COLOR) queueEngineMove();
});

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? 'Sound On' : 'Sound Off';
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));
  if (soundEnabled) {
    unlockAudio();
    playSound('move');
  }
});

piecesBtn.addEventListener('click', () => {
  const next = PIECE_STYLES[(PIECE_STYLES.indexOf(pieceStyle) + 1) % PIECE_STYLES.length];
  setPieceStyle(next);
});
piecesBtn.textContent = `Pieces: ${PIECE_STYLE_LABELS[pieceStyle]}`;

window.addEventListener('resize', resize);
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
canvas.addEventListener('pointerdown', onPointerDown);

function initLights() {
  scene.add(new THREE.HemisphereLight(0xf7f3ea, 0x1f2b27, 2.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(4.5, 8, 5);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.6, 128),
    new THREE.MeshStandardMaterial({ color: 0x1a211f, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);
}

function createBoard() {
  const tileGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.12, TILE_SIZE);
  for (let rank = 1; rank <= BOARD_SIZE; rank += 1) {
    for (let fileIndex = 0; fileIndex < BOARD_SIZE; fileIndex += 1) {
      const square = `${String.fromCharCode(97 + fileIndex)}${rank}`;
      const mesh = new THREE.Mesh(
        tileGeometry,
        baseTileMaterial(rank, fileIndex),
      );
      mesh.position.copy(squareToPosition(square));
      mesh.receiveShadow = true;
      mesh.userData.square = square;
      boardGroup.add(mesh);
      tileMeshes.set(square, mesh);
    }
  }
}

function syncPieces() {
  piecesGroup.clear();
  pieceMeshes.clear();
  const board = game.board();

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];
      if (!piece) continue;
      const square = `${String.fromCharCode(97 + col)}${8 - row}`;
      const mesh = createPiece(piece);
      mesh.position.copy(squareToPosition(square));
      mesh.position.y = 0.12;
      mesh.userData.square = square;
      mesh.userData.piece = piece;
      piecesGroup.add(mesh);
      pieceMeshes.set(square, mesh);
    }
  }
}

function getPieceMaterials() {
  if (pieceStyle === 'marble' && !pieceMaterials.marble) {
    pieceMaterials.marble = {
      w: createModelTextureMaterial('white', pieceDetailMaterial),
      b: createModelTextureMaterial('black'),
    };
  }
  return pieceMaterials[pieceStyle];
}

function createModelTextureMaterial(color, sharedNormals = null) {
  const loader = new THREE.TextureLoader();
  const load = (name, srgb) => {
    const texture = loader.load(`${PIECE_TEXTURE_DIR}${color}_${name}.jpg`);
    // glTF UVs expect textures that are not flipped vertically.
    texture.flipY = false;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const material = new THREE.MeshStandardMaterial({
    map: load('diff', true),
    roughnessMap: load('arm', false),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  if (color === 'black') {
    material.normalMap = load('nor_gl', false);
  } else if (sharedNormals) {
    // White's normal map is the one packed into the piece model.
    material.normalMap = sharedNormals.normalMap;
    material.normalScale.copy(sharedNormals.normalScale);
  }
  return material;
}

function setPieceStyle(style) {
  pieceStyle = style;
  piecesBtn.textContent = `Pieces: ${PIECE_STYLE_LABELS[style]}`;
  try {
    localStorage.setItem(PIECE_STYLE_STORAGE_KEY, style);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this visit.
  }
  syncPieces();
  applyBoardHighlights();
}

function loadPieceStyle() {
  try {
    const stored = localStorage.getItem(PIECE_STYLE_STORAGE_KEY);
    if (PIECE_STYLES.includes(stored)) return stored;
  } catch {
    // Fall back to the default style.
  }
  return 'ebony';
}

// Procedural wood: growth rings around a log axis set beside the surface. On pieces the
// axis is vertical, so the grain runs up the piece like a turned set; on board squares it
// runs across the square like a plank, with each square cut from a different spot.
function createWoodMaterial({
  light,
  dark,
  roughness,
  grain = { ring: 0.32, fibre: 0.28, tone: 0.3, ringScale: 34 },
  clearcoat = false,
  board = false,
}) {
  const options = { roughness, metalness: 0, side: THREE.DoubleSide };
  const material = clearcoat
    ? new THREE.MeshPhysicalMaterial({ ...options, clearcoat: 1, clearcoatRoughness: 0.08 })
    : new THREE.MeshStandardMaterial(options);
  const uniforms = {
    woodLight: { value: new THREE.Color(light) },
    woodDark: { value: new THREE.Color(dark) },
    woodGrain: { value: new THREE.Vector4(grain.ring, grain.fibre, grain.tone, grain.ringScale) },
  };
  const woodPosition = board
    ? 'vWoodPos = (modelMatrix * vec4(position, 1.0)).xyz;'
    : 'vWoodPos = (modelMatrix * vec4(position, 1.0)).xyz - modelMatrix[3].xyz;';
  // Board squares: turn the log axis to run along x and shift the cut per square.
  const woodFrame = board
    ? `vec2 cell = floor((p.xz + ${(BOARD_OFFSET + TILE_SIZE / 2).toFixed(4)}) / ${TILE_SIZE.toFixed(4)});
  vec3 q = vec3(p.y, p.x, p.z) + vec3(woodHash(vec3(cell, 1.0)) * 3.0, 0.0, woodHash(vec3(cell, 7.0)) * 3.0);`
    : 'vec3 q = p;';
  material.customProgramCacheKey = () => `wood-${board ? 'board' : 'piece'}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${woodPosition}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWoodPos;
uniform vec3 woodLight;
uniform vec3 woodDark;
uniform vec4 woodGrain;
float woodHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float woodNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(woodHash(i), woodHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(woodHash(i + vec3(0.0, 1.0, 0.0)), woodHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(woodHash(i + vec3(0.0, 0.0, 1.0)), woodHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(woodHash(i + vec3(0.0, 1.0, 1.0)), woodHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
vec3 woodColor(vec3 p) {
  ${woodFrame}
  float warp = woodNoise(q * vec3(2.6, 0.5, 2.6));
  float rings = length(q.xz + vec2(1.9, 1.1)) * woodGrain.w + warp * 3.0;
  float ring = pow(0.5 + 0.5 * sin(rings * 6.2831853), 6.0);
  float fibre = woodNoise(q * vec3(110.0, 2.0, 110.0));
  float tone = woodNoise(q * 2.4);
  return mix(woodLight, woodDark, clamp(ring * woodGrain.x + fibre * woodGrain.y + tone * woodGrain.z, 0.0, 1.0));
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= woodColor(vWoodPos);');
  };
  return material;
}

function loadPieceModels() {
  new GLTFLoader()
    .loadAsync(PIECE_MODEL_URL)
    .then((gltf) => {
      let detailMaterial = null;
      for (const node of gltf.scene.children) {
        if (!PIECE_VALUES[node.name]) continue;
        node.traverse((child) => {
          if (child.isMesh) detailMaterial ??= child.material;
        });
        pieceModels.set(node.name, node);
      }
      if (detailMaterial?.normalMap) {
        pieceDetailMaterial = detailMaterial;
        const sharedNormalMaterials = [
          ...Object.values(pieceMaterials.wood),
          ...Object.values(pieceMaterials.ebony),
          ...Object.values(pieceMaterials.classic),
          ...(pieceMaterials.marble ? [pieceMaterials.marble.w] : []),
        ];
        for (const material of sharedNormalMaterials) {
          material.normalMap = detailMaterial.normalMap;
          material.normalScale.copy(detailMaterial.normalScale);
          material.needsUpdate = true;
        }
      }
      pieceTemplates.clear();
      syncPieces();
    })
    .catch((error) => {
      // The simpler built-in pieces stay on the board if the model cannot load.
      console.warn('Could not load the sculpted chess pieces.', error);
    });
}

function createPiece(piece) {
  const key = `${pieceStyle}${piece.color}${piece.type}`;
  if (!pieceTemplates.has(key)) {
    const material = getPieceMaterials()[piece.color];
    const model = pieceModels.get(piece.type);
    let template;
    if (model) {
      template = new THREE.Group();
      const shape = model.clone();
      shape.position.set(0, 0, 0);
      shape.scale.setScalar(TILE_SIZE / PIECE_MODEL_SQUARE_SIZE);
      shape.traverse((child) => {
        if (child.isMesh) child.material = material;
      });
      template.add(shape);
      // The set is modelled with white facing black; turn black's pieces around to face white.
      template.rotation.y = piece.color === 'w' ? 0 : Math.PI;
      // Knights look toward the opponent, turned slightly so the horse profile reads from the table view.
      if (piece.type === 'n') template.rotation.y -= Math.PI / 4;
    } else {
      template = buildPieceModel(piece.type, material);
      if (piece.type === 'n') template.rotation.y = piece.color === 'w' ? (-3 * Math.PI) / 4 : Math.PI / 4;
    }
    template.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    pieceTemplates.set(key, template);
  }
  return pieceTemplates.get(key).clone();
}

function buildPieceModel(type, material) {
  const group = new THREE.Group();
  if (type === 'p') {
    const profile = stauntonBase(0.34, 0.2);
    profile.quadraticCurveTo(0.12, 0.3, 0.105, 0.5);
    profile.lineTo(0.18, 0.52);
    profile.lineTo(0.185, 0.55);
    profile.lineTo(0.1, 0.58);
    const start = Math.atan2(0.58 - 0.72, 0.1);
    profile.absarc(0, 0.72, Math.hypot(0.1, 0.14), start, Math.PI / 2, false);
    group.add(latheMesh(profile, material));
    return group;
  }
  if (type === 'r') {
    const profile = stauntonBase(0.4, 0.26);
    profile.quadraticCurveTo(0.2, 0.52, 0.215, 0.76);
    profile.quadraticCurveTo(0.225, 0.82, 0.29, 0.845);
    profile.lineTo(0.295, 0.87);
    profile.lineTo(0.27, 0.885);
    profile.lineTo(0.285, 0.9);
    profile.lineTo(0.285, 0.97);
    profile.lineTo(0.19, 0.97);
    profile.lineTo(0.19, 0.95);
    profile.lineTo(0, 0.95);
    group.add(latheMesh(profile, material));
    const merlons = 6;
    for (let i = 0; i < merlons; i += 1) {
      const span = (Math.PI * 2) / merlons;
      const a0 = i * span + span * 0.2;
      const a1 = (i + 1) * span - span * 0.2;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 0.285, a0, a1, false);
      shape.absarc(0, 0, 0.19, a1, a0, true);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.11,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.01,
        bevelSegments: 2,
        curveSegments: 8,
      });
      geometry.rotateX(-Math.PI / 2);
      const merlon = new THREE.Mesh(geometry, material);
      merlon.position.y = 0.97;
      group.add(merlon);
    }
    return group;
  }
  if (type === 'n') {
    const profile = stauntonBase(0.4, 0.26);
    profile.lineTo(0.25, 0.28);
    profile.lineTo(0.25, 0.3);
    profile.lineTo(0, 0.31);
    group.add(latheMesh(profile, material));
    const head = createKnightHead(material);
    head.position.y = 0.3;
    group.add(head);
    return group;
  }
  if (type === 'b') {
    const profile = stauntonBase(0.38, 0.25);
    profile.quadraticCurveTo(0.12, 0.52, 0.125, 0.84);
    addCollar(profile, 0.84, 0.125, 0.22, 0.12);
    group.add(latheMesh(profile, material));
    group.add(...createMitre(material, 0.93, 0.47));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), material);
    bead.position.y = 1.42;
    group.add(bead);
    return group;
  }
  if (type === 'q') {
    const profile = stauntonBase(0.43, 0.28);
    profile.quadraticCurveTo(0.13, 0.66, 0.14, 1.06);
    addCollar(profile, 1.06, 0.14, 0.25, 0.14);
    profile.quadraticCurveTo(0.16, 1.32, 0.265, 1.43);
    profile.lineTo(0.255, 1.46);
    profile.lineTo(0.2, 1.45);
    profile.quadraticCurveTo(0.19, 1.54, 0.06, 1.575);
    profile.lineTo(0.035, 1.6);
    profile.lineTo(0, 1.6);
    group.add(latheMesh(profile, material));
    const pearls = 9;
    for (let i = 0; i < pearls; i += 1) {
      const angle = (i / pearls) * Math.PI * 2;
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), material);
      pearl.position.set(Math.cos(angle) * 0.245, 1.48, Math.sin(angle) * 0.245);
      group.add(pearl);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), material);
    orb.position.y = 1.655;
    group.add(orb);
    return group;
  }
  const profile = stauntonBase(0.44, 0.29);
  profile.quadraticCurveTo(0.14, 0.7, 0.15, 1.12);
  addCollar(profile, 1.12, 0.15, 0.265, 0.15);
  profile.quadraticCurveTo(0.17, 1.38, 0.255, 1.48);
  profile.lineTo(0.255, 1.51);
  profile.lineTo(0.235, 1.52);
  profile.quadraticCurveTo(0.2, 1.62, 0.07, 1.645);
  profile.lineTo(0.06, 1.66);
  profile.lineTo(0.075, 1.675);
  profile.lineTo(0.07, 1.69);
  profile.lineTo(0, 1.69);
  group.add(latheMesh(profile, material));
  const cross = new THREE.Shape();
  const arm = 0.036;
  const reach = 0.1;
  cross.moveTo(-arm, 0);
  cross.lineTo(arm, 0);
  cross.lineTo(arm, 0.13);
  cross.lineTo(reach, 0.13);
  cross.lineTo(reach, 0.2);
  cross.lineTo(arm, 0.2);
  cross.lineTo(arm, 0.26);
  cross.lineTo(-arm, 0.26);
  cross.lineTo(-arm, 0.2);
  cross.lineTo(-reach, 0.2);
  cross.lineTo(-reach, 0.13);
  cross.lineTo(-arm, 0.13);
  cross.closePath();
  const crossGeometry = new THREE.ExtrudeGeometry(cross, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  crossGeometry.translate(0, 0, -0.025);
  const crossMesh = new THREE.Mesh(crossGeometry, material);
  crossMesh.position.y = 1.68;
  group.add(crossMesh);
  return group;
}

// Classic Staunton foot: flat pad, rounded torus, cove and a fine ring before the stem.
function stauntonBase(radius, stemRadius) {
  const path = new THREE.Path();
  path.moveTo(0, 0);
  path.lineTo(radius - 0.01, 0);
  path.lineTo(radius, 0.012);
  path.lineTo(radius, 0.04);
  path.quadraticCurveTo(radius * 1.02, 0.1, radius * 0.9, 0.14);
  path.quadraticCurveTo(radius * 0.74, 0.16, radius * 0.78, 0.2);
  path.lineTo(radius * 0.8, 0.215);
  path.lineTo(radius * 0.78, 0.23);
  path.quadraticCurveTo(radius * 0.7, 0.25, stemRadius, 0.26);
  return path;
}

function addCollar(path, y, stemRadius, collarRadius, neckRadius) {
  path.lineTo(collarRadius * 0.9, y + 0.02);
  path.quadraticCurveTo(collarRadius * 1.02, y + 0.03, collarRadius, y + 0.05);
  path.lineTo(collarRadius * 0.72, y + 0.07);
  path.lineTo(collarRadius * 0.82, y + 0.085);
  path.lineTo(collarRadius * 0.8, y + 0.1);
  path.lineTo(neckRadius, y + 0.11);
}

function latheMesh(path, material, segments = 48) {
  const geometry = new THREE.LatheGeometry(path.getPoints(10), segments);
  return new THREE.Mesh(geometry, material);
}

// Bishop mitre: an egg-shaped cap with the traditional slit cut into one side.
function createMitre(material, baseY, height) {
  const mitreRadius = (t) => 0.175 * Math.sin(Math.PI * t ** 0.75) ** 0.8;
  const sample = (from, to, steps) => {
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = from + ((to - from) * i) / steps;
      points.push(new THREE.Vector2(mitreRadius(t), baseY + t * height));
    }
    return points;
  };
  const slitFrom = 0.42;
  const slitTo = 0.7;
  const slitWidth = 0.34;
  const slitCenter = Math.PI / 4;

  const lower = sample(0, slitFrom, 16);
  // The short inset step keeps the flat caps from softening the shading of the rim.
  lower.push(new THREE.Vector2(lower[lower.length - 1].x - 0.002, lower[lower.length - 1].y));
  lower.push(new THREE.Vector2(0, baseY + slitFrom * height));
  const upper = sample(slitTo, 1, 14);
  upper.unshift(new THREE.Vector2(upper[0].x - 0.002, upper[0].y));
  upper.unshift(new THREE.Vector2(0, baseY + slitTo * height));
  const middle = sample(slitFrom, slitTo, 12);

  const meshes = [
    new THREE.Mesh(new THREE.LatheGeometry(lower, 48), material),
    new THREE.Mesh(new THREE.LatheGeometry(upper, 48), material),
    new THREE.Mesh(
      new THREE.LatheGeometry(middle, 44, slitCenter + slitWidth / 2, Math.PI * 2 - slitWidth),
      material,
    ),
  ];
  const wall = new THREE.Shape([
    new THREE.Vector2(0, middle[0].y),
    ...middle,
    new THREE.Vector2(0, middle[middle.length - 1].y),
  ]);
  for (const phi of [slitCenter - slitWidth / 2, slitCenter + slitWidth / 2]) {
    const geometry = new THREE.ShapeGeometry(wall);
    geometry.rotateY(phi - Math.PI / 2);
    meshes.push(new THREE.Mesh(geometry, material));
  }
  return meshes;
}

// Knight: a carved horse-head silhouette, extruded and then sculpted so the
// neck is broad at the base and the muzzle narrows toward the nose.
function createKnightHead(material) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.2, -0.02);
  shape.lineTo(0.16, -0.02);
  shape.quadraticCurveTo(0.25, -0.02, 0.26, 0.08);
  shape.quadraticCurveTo(0.27, 0.2, 0.23, 0.3);
  shape.quadraticCurveTo(0.2, 0.43, 0.32, 0.45);
  shape.lineTo(0.43, 0.46);
  shape.quadraticCurveTo(0.475, 0.47, 0.475, 0.52);
  shape.quadraticCurveTo(0.49, 0.6, 0.45, 0.63);
  shape.quadraticCurveTo(0.32, 0.7, 0.2, 0.82);
  shape.lineTo(0.14, 0.94);
  shape.quadraticCurveTo(0.11, 0.99, 0.09, 0.94);
  shape.lineTo(0.04, 0.84);
  shape.quadraticCurveTo(-0.2, 0.74, -0.28, 0.46);
  shape.quadraticCurveTo(-0.32, 0.2, -0.28, 0.08);
  shape.quadraticCurveTo(-0.26, -0.02, -0.2, -0.02);

  const head = new THREE.Group();
  head.add(new THREE.Mesh(sculptKnightGeometry(shape, 0.2, 0.07, 0.05), material));

  const mane = new THREE.Shape();
  mane.moveTo(0.03, 0.87);
  mane.quadraticCurveTo(-0.22, 0.78, -0.305, 0.47);
  mane.quadraticCurveTo(-0.335, 0.28, -0.27, 0.1);
  mane.quadraticCurveTo(-0.25, 0.3, -0.2, 0.46);
  mane.quadraticCurveTo(-0.1, 0.68, 0.03, 0.87);
  head.add(new THREE.Mesh(sculptKnightGeometry(mane, 0.1, 0.03, 0.022), material));

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), material);
    eye.scale.set(1.35, 0.8, 0.6);
    eye.position.set(0.2, 0.72, side * 0.148);
    head.add(eye);
  }
  return head;
}

// Extrudes a knight outline and tapers it: broad neck at the base, slimmer muzzle.
function sculptKnightGeometry(shape, depth, bevelThickness, bevelSize) {
  let geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 6,
    curveSegments: 20,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry, 1e-4);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const neck = THREE.MathUtils.clamp(1.3 - y * 0.55, 0.78, 1.3);
    const muzzle = 1 - 0.32 * THREE.MathUtils.smoothstep(x, 0.12, 0.46);
    position.setZ(i, position.getZ(i) * neck * muzzle);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function onPointerDown(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const pieceHits = raycaster.intersectObjects(piecesGroup.children, true);
  const boardHits = raycaster.intersectObjects([...tileMeshes.values()]);
  const square = findHitSquare(pieceHits) || findHitSquare(boardHits);
  if (!square) return;
  handleSquare(square);
}

function findHitSquare(hits) {
  for (const hit of hits) {
    let object = hit.object;
    while (object) {
      if (object.userData.square) return object.userData.square;
      object = object.parent;
    }
  }
  return null;
}

function handleSquare(square) {
  if (engineThinking || !canHumanMoveCurrentTurn() || game.isGameOver()) return;
  const piece = game.get(square);
  const playableColor = game.turn();
  if (!selectedSquare) {
    if (piece?.color === playableColor) selectSquare(square);
    return;
  }

  if (square === selectedSquare) {
    clearSelection();
    return;
  }

  if (piece?.color === playableColor) {
    selectSquare(square);
    return;
  }

  const legalMove = highlightedMoves.find((candidate) => candidate.to === square);
  if (!legalMove) {
    clearSelection();
    return;
  }

  const move = safeMove(game, {
    from: selectedSquare,
    to: square,
    promotion: legalMove.promotion || 'q',
  });
  if (move) {
    clearSelection();
    syncPieces();
    markLastMove(move.from, move.to);
    playMoveResultSound();
    updateHud();
    if (playMode === 'computer') queueEngineMove();
  }
}

function canHumanMoveCurrentTurn() {
  return playMode === 'local' || game.turn() === HUMAN_COLOR;
}

function selectSquare(square) {
  clearSelection();
  selectedSquare = square;
  highlightedMoves = game.moves({ square, verbose: true });
  tileMeshes.get(square).material = tileMaterialSelected;

  for (const move of highlightedMoves) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 32), markerMaterial);
    marker.position.copy(squareToPosition(move.to));
    marker.position.y = 0.12;
    marker.userData.square = move.to;
    markersGroup.add(marker);
    markerMeshes.push(marker);
  }
}

function clearSelection() {
  selectedSquare = null;
  highlightedMoves = [];
  applyBoardHighlights();
  for (const marker of markerMeshes) marker.removeFromParent();
  markerMeshes.length = 0;
}

function applyBoardHighlights() {
  for (const [square, mesh] of tileMeshes) {
    const fileIndex = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    mesh.material = baseTileMaterial(rank, fileIndex);
  }
  if (selectedSquare) tileMeshes.get(selectedSquare).material = tileMaterialSelected;

  for (const square of lastMoveSquares) {
    tileMeshes.get(square).material = tileMaterialLastMove;
  }

  const kingSquare = findKingSquare(game.turn());
  if (kingSquare && (game.isCheck() || game.isCheckmate())) {
    tileMeshes.get(kingSquare).material = game.isCheckmate()
      ? tileMaterialCheckmate
      : tileMaterialCheck;
  }
}

function baseTileMaterial(rank, fileIndex) {
  const dark = (rank + fileIndex) % 2 === 0;
  if (pieceStyle === 'ebony') return dark ? boardWoodMaterials.dark : boardWoodMaterials.light;
  return dark ? tileMaterialDark : tileMaterialLight;
}

function markLastMove(from, to) {
  lastMoveSquares = [from, to];
  applyBoardHighlights();
}

function updateHud() {
  const turn = game.turn() === 'w' ? 'White' : 'Black';
  let status = `${turn} to move`;
  if (game.isCheckmate()) status = `Checkmate. ${turn} loses`;
  else if (game.isDraw()) status = 'Draw';
  else if (game.isCheck()) status = `${turn} is in check`;

  statusEl.textContent = status;
  turnBadge.textContent = status;
  engineStatusEl.textContent = getModeStatus();
  modeBtn.textContent = playMode === 'computer' ? 'Play Two Players' : 'Play Computer';
  modeBtn.setAttribute('aria-pressed', String(playMode === 'local'));
  undoBtn.disabled = engineThinking;
  resetBtn.disabled = engineThinking;
  moveList.replaceChildren(
    ...game.history().map((move) => {
      const li = document.createElement('li');
      li.textContent = move;
      return li;
    }),
  );
  moveList.scrollTop = moveList.scrollHeight;
}

function queueEngineMove() {
  if (playMode !== 'computer' || game.turn() !== ENGINE_COLOR || game.isGameOver()) return;
  engineThinking = true;
  updateHud();
  window.setTimeout(async () => {
    const move = await requestEngineMove();
    if (move) {
      const played = safeMove(game, move);
      if (played) {
        await animateComputerMove(played);
        syncPieces();
        markLastMove(played.from, played.to);
        playMoveResultSound();
      }
    }
    engineThinking = false;
    clearSelection();
    updateHud();
  }, ENGINE_START_DELAY);
}

function getModeStatus() {
  if (playMode === 'local') return 'Two players can move white and black';
  if (engineThinking) return 'Stockfish is thinking';
  return stockfishReady
    ? 'You play white. Stockfish 18 plays black'
    : 'You play white. Loading Stockfish';
}

function initLlmAgent() {
  llmAgent = new QuantumChessAgent({
    chess: game,
    onMove: (move) => {
      clearSelection();
      syncPieces();
      markLastMove(move.from, move.to);
      playMoveResultSound();
      updateHud();
    },
    onReset: () => {
      engineThinking = false;
      lastMoveSquares = [];
      clearSelection();
      syncPieces();
      updateHud();
    },
  });

  window.quantumChessAgent = llmAgent;
}

function animateComputerMove(move) {
  const movingPiece = pieceMeshes.get(move.from);
  if (!movingPiece) return Promise.resolve();

  removeCapturedPieceForAnimation(move);
  const start = movingPiece.position.clone();
  const end = squareToPosition(move.to);
  end.y = start.y;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    function step(now) {
      const progress = Math.min((now - startedAt) / COMPUTER_ANIMATION_MS, 1);
      const eased = 1 - (1 - progress) ** 3;
      movingPiece.position.lerpVectors(start, end, eased);
      movingPiece.position.y = start.y + Math.sin(progress * Math.PI) * 0.55;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        movingPiece.position.copy(end);
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function removeCapturedPieceForAnimation(move) {
  if (!move.captured) return;
  const capturedSquare = move.flags.includes('e')
    ? `${move.to[0]}${move.from[1]}`
    : move.to;
  const capturedMesh = pieceMeshes.get(capturedSquare);
  if (capturedMesh) {
    capturedMesh.removeFromParent();
    pieceMeshes.delete(capturedSquare);
  }
}

function initStockfish() {
  try {
    stockfishWorker = new Worker(STOCKFISH_WORKER_URL);
    stockfishWorker.onmessage = ({ data }) => handleStockfishMessage(String(data));
    stockfishWorker.onerror = () => {
      stockfishReady = false;
      stockfishWorker = null;
      if (stockfishRequest) {
        stockfishRequest.resolve(null);
        stockfishRequest = null;
      }
      updateHud();
    };
    sendStockfish('uci');
    sendStockfish('setoption name Skill Level value 20');
    sendStockfish('setoption name UCI_LimitStrength value false');
    sendStockfish('isready');
  } catch {
    stockfishWorker = null;
  }
}

function handleStockfishMessage(message) {
  if (message === 'readyok' || message.startsWith('uciok')) {
    stockfishReady = true;
    updateHud();
    return;
  }

  if (!message.startsWith('bestmove') || !stockfishRequest) return;
  const [, bestMove] = message.split(/\s+/);
  const request = stockfishRequest;
  stockfishRequest = null;
  request.resolve(uciToChessMove(bestMove));
}

function sendStockfish(command) {
  stockfishWorker?.postMessage(command);
}

function requestEngineMove() {
  if (!stockfishWorker || !stockfishReady) {
    return Promise.resolve(findBestEngineMove(game, ENGINE_DEPTH));
  }

  const fen = game.fen();
  return new Promise((resolve) => {
    stockfishRequest = { resolve };
    sendStockfish('stop');
    sendStockfish(`position fen ${fen}`);
    sendStockfish(`go depth ${ENGINE_DEPTH} movetime ${ENGINE_MOVE_TIME}`);
    window.setTimeout(() => {
      if (stockfishRequest?.resolve === resolve) {
        stockfishRequest = null;
        resolve(findBestEngineMove(game, 2));
      }
    }, ENGINE_MOVE_TIME + 2500);
  });
}

function uciToChessMove(uciMove) {
  if (!uciMove || uciMove === '(none)') return null;
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
    promotion: uciMove[4] || 'q',
  };
}

function safeMove(chess, move) {
  try {
    return chess.move(move);
  } catch {
    return null;
  }
}

function findBestEngineMove(chess, depth) {
  const moves = chess.moves({ verbose: true });
  let bestMove = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const move of moves) {
    chess.move(move);
    const score = minimax(chess, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    chess.undo();
    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(chess, depth, alpha, beta) {
  if (depth === 0 || chess.isGameOver()) return evaluateBoard(chess);

  const moves = chess.moves({ verbose: true });
  if (chess.turn() === HUMAN_COLOR) {
    let best = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      chess.move(move);
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    chess.move(move);
    best = Math.min(best, minimax(chess, depth - 1, alpha, beta));
    chess.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function evaluateBoard(chess) {
  if (chess.isCheckmate()) return chess.turn() === HUMAN_COLOR ? -999999 : 999999;
  if (chess.isDraw()) return 0;

  let score = 0;
  const board = chess.board();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];
      if (!piece) continue;
      const centerBonus = 14 - Math.abs(3.5 - row) * 3 - Math.abs(3.5 - col) * 3;
      const value = PIECE_VALUES[piece.type] + centerBonus;
      score += piece.color === HUMAN_COLOR ? value : -value;
    }
  }

  if (chess.isCheck()) score += chess.turn() === HUMAN_COLOR ? -35 : 35;
  return score;
}

function findKingSquare(color) {
  const board = game.board();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];
      if (piece?.type === 'k' && piece.color === color) {
        return `${String.fromCharCode(97 + col)}${8 - row}`;
      }
    }
  }
  return null;
}

function playMoveResultSound() {
  if (game.isCheckmate()) playSound('checkmate');
  else if (game.isCheck()) playSound('check');
  else playSound('move');
}

function playSound(type) {
  if (!soundEnabled) return;
  const context = ensureAudioContext();
  if (!context) return;

  const tones = {
    move: [520, 0.14, 0.09],
    check: [820, 0.22, 0.12],
    checkmate: [190, 0.55, 0.16],
  };
  const [frequency, duration, gainValue] = tones[type];
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type === 'checkmate' ? 'sawtooth' : 'sine';
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  gain.gain.setValueAtTime(gainValue, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

function unlockAudio() {
  if (!soundEnabled || audioUnlocked) return;
  const context = ensureAudioContext();
  if (!context) return;

  const buffer = context.createBuffer(1, 1, 22050);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0);
  audioUnlocked = true;
}

function squareToPosition(square) {
  const fileIndex = square.charCodeAt(0) - 97;
  const rankIndex = Number(square[1]) - 1;
  return new THREE.Vector3(
    fileIndex * TILE_SIZE - BOARD_OFFSET,
    0,
    rankIndex * TILE_SIZE - BOARD_OFFSET,
  );
}

function zoomCamera(delta) {
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = camera.position.distanceTo(controls.target);
  const nextDistance = THREE.MathUtils.clamp(
    distance + delta,
    controls.minDistance,
    controls.maxDistance,
  );
  camera.position.copy(controls.target).add(direction.multiplyScalar(nextDistance));
  controls.update();
  saveZoomDistance();
  updateZoomLevel();
}

function loadZoomDistance() {
  const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return Number.isFinite(stored) ? THREE.MathUtils.clamp(stored, 4.2, 22) : 15.57;
}

function saveZoomDistance() {
  localStorage.setItem(
    ZOOM_STORAGE_KEY,
    String(camera.position.distanceTo(controls.target).toFixed(2)),
  );
}

function updateZoomLevel() {
  const distance = camera.position.distanceTo(controls.target);
  const normalized = (controls.maxDistance - distance) / (controls.maxDistance - controls.minDistance);
  const percent = Math.round(20 + normalized * 180);
  zoomLevelEl.textContent = `Zoom ${percent}%`;
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
