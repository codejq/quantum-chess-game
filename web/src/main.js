import { Chess } from 'chess.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { QuantumChessAgent } from './input/llm-agent.js';
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
const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 20000,
};
const PIECE_SPECS = {
  p: { baseTop: 0.3, baseBottom: 0.38, baseHeight: 0.14, stemTop: 0.14, stemBottom: 0.22, stemHeight: 0.36, topY: 0.59 },
  n: { baseTop: 0.36, baseBottom: 0.45, baseHeight: 0.18, stemTop: 0.2, stemBottom: 0.29, stemHeight: 0.55, topY: 0.87 },
  b: { baseTop: 0.36, baseBottom: 0.45, baseHeight: 0.18, stemTop: 0.19, stemBottom: 0.29, stemHeight: 0.62, topY: 0.93 },
  r: { baseTop: 0.38, baseBottom: 0.48, baseHeight: 0.2, stemTop: 0.22, stemBottom: 0.32, stemHeight: 0.62, topY: 0.94 },
  q: { baseTop: 0.42, baseBottom: 0.52, baseHeight: 0.22, stemTop: 0.24, stemBottom: 0.36, stemHeight: 0.72, topY: 1.08 },
  k: { baseTop: 0.43, baseBottom: 0.54, baseHeight: 0.22, stemTop: 0.25, stemBottom: 0.37, stemHeight: 0.76, topY: 1.12 },
};
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
const whitePieceMaterial = new THREE.MeshStandardMaterial({
  color: 0xf6eee0,
  metalness: 0.08,
  roughness: 0.42,
});
const blackPieceMaterial = new THREE.MeshStandardMaterial({
  color: 0x202321,
  metalness: 0.16,
  roughness: 0.35,
});
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
syncPieces();
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
  if (game.turn() === ENGINE_COLOR) game.undo();
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

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? 'Sound On' : 'Sound Off';
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));
  if (soundEnabled) {
    unlockAudio();
    playSound('move');
  }
});

window.addEventListener('resize', resize);
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
canvas.addEventListener('pointerdown', onPointerDown);

function initLights() {
  scene.add(new THREE.HemisphereLight(0xf7f3ea, 0x1f2b27, 2.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(4.5, 8, 5);
  key.castShadow = true;
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
        (rank + fileIndex) % 2 === 0 ? tileMaterialDark : tileMaterialLight,
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

function createPiece(piece) {
  const material = piece.color === 'w' ? whitePieceMaterial : blackPieceMaterial;
  const spec = PIECE_SPECS[piece.type];
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.baseTop, spec.baseBottom, spec.baseHeight, 36),
    material,
  );
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.baseTop * 0.82, spec.baseTop, 0.08, 36),
    material,
  );
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.stemTop, spec.stemBottom, spec.stemHeight, 32),
    material,
  );
  base.position.y = spec.baseHeight / 2;
  collar.position.y = spec.baseHeight + 0.04;
  stem.position.y = spec.baseHeight + 0.08 + spec.stemHeight / 2;
  group.add(base, collar, stem);

  const top = createPieceTop(piece.type, material);
  top.position.y = spec.topY;
  group.add(top);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.square = group.userData.square;
    }
  });
  return group;
}

function createPieceTop(type, material) {
  if (type === 'p') return new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 20), material);
  if (type === 'r') {
    const rook = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.52), material);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), material);
    cap.position.y = 0.23;
    rook.add(tower, cap);
    return rook;
  }
  if (type === 'n') {
    const group = new THREE.Group();
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.58, 24), material);
    neck.scale.x = 0.78;
    neck.rotation.z = -0.42;
    neck.position.set(-0.06, -0.02, 0);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 28, 18), material);
    head.scale.set(1.06, 1.32, 0.72);
    head.position.set(0.18, 0.28, 0);
    head.rotation.z = -0.34;

    const muzzle = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.2, 8, 18), material);
    muzzle.rotation.z = Math.PI / 2;
    muzzle.position.set(0.36, 0.2, 0);

    const earA = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 14), material);
    const earB = earA.clone();
    earA.position.set(0.11, 0.52, -0.08);
    earB.position.set(0.11, 0.52, 0.08);

    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), material);
    mane.position.set(-0.03, 0.2, 0);
    mane.rotation.z = -0.36;

    group.add(neck, head, muzzle, earA, earB, mane);
    return group;
  }
  if (type === 'b') {
    const bishop = new THREE.Group();
    const mitre = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.62, 36), material);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), material);
    bead.position.y = 0.37;
    bishop.add(mitre, bead);
    return bishop;
  }
  if (type === 'q') {
    const queen = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.31, 32, 18), material);
    bowl.scale.y = 0.68;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.035, 10, 40), material);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.14;
    queen.add(bowl, rim);
    for (let i = 0; i < 8; i += 1) {
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 18), material);
      const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), material);
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 0.27;
      const z = Math.sin(angle) * 0.27;
      point.position.set(x, 0.3, z);
      jewel.position.set(x, 0.43, z);
      queen.add(point);
      queen.add(jewel);
    }
    return queen;
  }
  const crown = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 8), material);
  const highDome = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.32, 32), material);
  const topOrb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), material);
  highDome.position.y = 0.25;
  topOrb.position.y = 0.5;
  crown.add(band, highDome, topOrb);
  for (let i = 0; i < 4; i += 1) {
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 18), material);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    point.position.set(Math.cos(angle) * 0.26, 0.36, Math.sin(angle) * 0.26);
    crown.add(point);
  }
  return crown;
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
  if (engineThinking || game.turn() !== HUMAN_COLOR || game.isGameOver()) return;
  const piece = game.get(square);
  if (!selectedSquare) {
    if (piece?.color === HUMAN_COLOR) selectSquare(square);
    return;
  }

  if (square === selectedSquare) {
    clearSelection();
    return;
  }

  if (piece?.color === HUMAN_COLOR) {
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
    queueEngineMove();
  }
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
    mesh.material = (rank + fileIndex) % 2 === 0 ? tileMaterialDark : tileMaterialLight;
  }

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
  engineStatusEl.textContent = engineThinking
    ? 'Stockfish is thinking'
    : stockfishReady
      ? 'You play white. Stockfish 18 plays black'
      : 'You play white. Loading Stockfish';
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
  if (game.isGameOver()) return;
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
