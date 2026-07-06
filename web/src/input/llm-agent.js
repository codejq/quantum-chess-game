import { Chess } from 'chess.js';

function compactMove(move) {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    capture: Boolean(move.captured),
    check: move.san.includes('+'),
    checkmate: move.san.includes('#'),
  };
}

export class QuantumChessAgent {
  constructor({ chess = new Chess(), onMove = null, onReset = null } = {}) {
    this.chess = chess;
    this.onMove = onMove;
    this.onReset = onReset;
    this.lastAction = null;
  }

  observe() {
    const legalMoves = this.chess.moves({ verbose: true }).map(compactMove);
    return {
      fen: this.chess.fen(),
      turn: this.chess.turn() === 'w' ? 'white' : 'black',
      status: this.status(),
      check: this.chess.isCheck(),
      checkmate: this.chess.isCheckmate(),
      draw: this.chess.isDraw(),
      gameOver: this.chess.isGameOver(),
      legalMoves,
      legalMoveCount: legalMoves.length,
      history: this.chess.history(),
      board: this.board(),
      lastAction: this.lastAction,
      actions: {
        move: {
          shape: { type: 'move', from: 'e2', to: 'e4', promotion: 'q' },
          note: 'Use from/to coordinates. Promotion is optional and defaults to queen.',
        },
        san: {
          shape: { type: 'san', move: 'Nf3' },
          note: 'Use standard algebraic notation if preferred.',
        },
        reset: { shape: { type: 'reset' } },
        undo: { shape: { type: 'undo' } },
      },
    };
  }

  act(action = {}) {
    this.lastAction = action;

    if (action.type === 'reset') {
      this.chess.reset();
      this.onReset?.();
      return this.observe();
    }

    if (action.type === 'undo') {
      this.chess.undo();
      this.onReset?.();
      return this.observe();
    }

    const move = this.parseMove(action);
    if (!move) {
      return {
        ...this.observe(),
        error: 'Invalid action. Use { type: "move", from, to, promotion? } or { type: "san", move }.',
      };
    }

    const played = this.chess.move(move);
    if (!played) {
      return {
        ...this.observe(),
        error: 'Illegal move.',
      };
    }

    this.onMove?.(played);
    return this.observe();
  }

  play(move) {
    if (typeof move === 'string') return this.act({ type: 'san', move });
    return this.act({ type: 'move', ...move });
  }

  reset() {
    return this.act({ type: 'reset' });
  }

  status() {
    if (this.chess.isCheckmate()) return 'checkmate';
    if (this.chess.isDraw()) return 'draw';
    if (this.chess.isCheck()) return 'check';
    return 'playing';
  }

  board() {
    return this.chess.board().map((rank, row) =>
      rank.map((piece, col) => {
        if (!piece) return null;
        return {
          square: `${String.fromCharCode(97 + col)}${8 - row}`,
          type: piece.type,
          color: piece.color === 'w' ? 'white' : 'black',
        };
      }),
    );
  }

  parseMove(action) {
    if (action.type === 'san' && action.move) return action.move;
    if (action.type !== 'move' || !action.from || !action.to) return null;
    return {
      from: action.from,
      to: action.to,
      promotion: action.promotion || 'q',
    };
  }
}
