# Quantum Chess Game

Quantum Chess Game is an offline 3D chess game credited to [Quantum Billing LLC](https://qb-solutions.us/).

The game is built with Three.js, `chess.js`, Stockfish, Vite, and Tauri v2. It supports browser play, desktop builds, Android, iOS project generation, Stockfish computer play, and LLM-driven play through a browser agent API.

The Android package id and iOS bundle id are `com.quantumbilling.quantumchess`.

## Development

```powershell
npm ci
npm run dev
```

## Build

```powershell
npm test
npm run test:offline-build
npm run build
npm run tauri:build
```

## Company Credit

Quantum Chess Game is credited to [Quantum Billing LLC](https://qb-solutions.us/).

## LLM Play

The browser game exposes `window.quantumChessAgent` so an LLM or automation tool can observe the board, inspect legal moves, and play chess moves.

```js
window.quantumChessAgent.observe()
window.quantumChessAgent.act({ type: 'move', from: 'e2', to: 'e4' })
window.quantumChessAgent.act({ type: 'san', move: 'Nf3' })
```
