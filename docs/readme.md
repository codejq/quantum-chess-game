# Quantum Chess Game

Quantum Chess Game is a browser-based 3D chess project credited to [Quantum Billing LLC](https://qb-solutions.us/). The game uses Three.js for the board, pieces, camera, lighting, animation, and player interaction.

The Android package id and iOS bundle id are `com.quantumbilling.quantumchess`.

The game supports LLM-driven play through `window.quantumChessAgent`, which lets an LLM observe the board, inspect legal moves, and submit moves using coordinate or SAN notation.

## Goal

Build a polished 3D chess experience that runs in the browser and feels like a complete playable game rather than a static scene.

The first version should include:

- A full 8x8 chessboard rendered in Three.js.
- Distinct 3D chess pieces for both sides.
- Mouse or touch interaction for selecting and moving pieces.
- Legal move validation using a reliable chess rules engine.
- LLM play support through a browser agent API.
- Turn tracking, captures, check, checkmate, stalemate, and game reset.
- Camera controls that let the player inspect the board without losing orientation.
- Clear visual feedback for selected pieces, valid moves, captures, and game state.

## Expected Location

Place the web application in:

```text
web/
```

Suggested structure:

```text
web/
  index.html
  package.json
  src/
    main.js
    game/
    scene/
    styles/
```

## Recommended Stack

- Three.js for 3D rendering.
- A chess rules library such as `chess.js` for legal move handling.
- Vite for local development and bundling.
- CSS for layout, HUD, menus, and responsive browser UI.

## Experience Notes

The game should open directly into the playable board. Avoid building a marketing-style landing page first. The first screen should make the chessboard, controls, and game state immediately usable.

The visual style should be clean and readable:

- Use stable board dimensions so the game does not shift during interaction.
- Keep the board and pieces easy to distinguish from the background.
- Use lighting and shadows to make the scene feel dimensional.
- Include concise UI controls for reset, undo if supported, camera mode, and game status.
- Make the layout work on desktop and mobile viewports.

## Development Notes

When implementation begins, start a local development server from the `web` directory and verify the scene in the browser. Confirm that the Three.js canvas renders correctly, the board is visible, pieces are selectable, and moves update both the 3D scene and the chess engine state.
