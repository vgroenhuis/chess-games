// A chessboard: shows a position and lets the user move pieces by clicking
// (piece, then square) or dragging, with mouse or touch. Legal moves come from
// chess.js; what a move means is up to the page (onMove).
//
// Pieces: "cburnett" set by Colin M.L. Burnett, CC BY-SA 3.0 (see pieces/).

import { Chess } from "./vendor/chess.js";

const FILES = "abcdefgh";
const PROMOTION_PIECES = ["q", "r", "b", "n"];

function pieceSrc(color, type) {
	return `pieces/${color}${type.toUpperCase()}.svg`;
}

export class Board {
	// onMove({from, to, promotion}) is called for a legal move; canMove() says
	// whether the user may move at all right now.
	constructor(container, { onMove, canMove = () => true } = {}) {
		this.onMove = onMove;
		this.canMove = canMove;
		this.flipped = false;
		this.chess = new Chess();
		this.lastMove = null;
		this.selected = null;
		this.drag = null;

		this.el = document.createElement("div");
		this.el.className = "board";
		this.el.setAttribute("role", "grid");
		this.squares = {};
		for (let i = 0; i < 64; i++) {
			const sq = document.createElement("div");
			sq.className = "sq";
			this.el.append(sq);
		}
		container.append(this.el);
		this.layout();

		this.el.addEventListener("pointerdown", (e) => this.pointerDown(e));
		window.addEventListener("pointermove", (e) => this.pointerMove(e));
		window.addEventListener("pointerup", (e) => this.pointerUp(e));
		window.addEventListener("pointercancel", () => this.cancelDrag());
	}

	// Assigns square names to the grid cells for the current orientation.
	layout() {
		this.squares = {};
		const cells = this.el.children;
		for (let row = 0; row < 8; row++) {
			for (let col = 0; col < 8; col++) {
				const file = this.flipped ? 7 - col : col;
				const rank = this.flipped ? row + 1 : 8 - row;
				const name = FILES[file] + rank;
				const cell = cells[row * 8 + col];
				cell.dataset.square = name;
				cell.classList.toggle("light", (file + rank) % 2 === 1);
				cell.classList.toggle("dark", (file + rank) % 2 === 0);
				// Coordinates along the bottom row and left column.
				cell.dataset.rankLabel = col === 0 ? String(rank) : "";
				cell.dataset.fileLabel = row === 7 ? FILES[file] : "";
				this.squares[name] = cell;
			}
		}
	}

	setPosition(fen, lastMove = null) {
		this.chess = new Chess(fen);
		this.lastMove = lastMove;
		this.selected = null;
		this.render();
	}

	flip() {
		this.flipped = !this.flipped;
		this.layout();
		this.render();
	}

	render() {
		const board = this.chess.board(); // [rank 8 .. rank 1][file a .. h]
		const checkSquare = this.chess.inCheck() ? this.kingSquare(this.chess.turn()) : null;
		const targets = this.selected ? new Set(this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to)) : new Set();
		for (const [name, cell] of Object.entries(this.squares)) {
			const piece = board[8 - Number(name[1])][FILES.indexOf(name[0])];
			cell.replaceChildren();
			if (cell.dataset.rankLabel) cell.append(Object.assign(document.createElement("span"), { className: "coord rank", textContent: cell.dataset.rankLabel }));
			if (cell.dataset.fileLabel) cell.append(Object.assign(document.createElement("span"), { className: "coord file", textContent: cell.dataset.fileLabel }));
			if (piece && !(this.drag && this.drag.from === name && this.drag.moved)) {
				const img = document.createElement("img");
				img.src = pieceSrc(piece.color, piece.type);
				img.alt = `${piece.color === "w" ? "white" : "black"} ${piece.type}`;
				img.draggable = false;
				cell.append(img);
			}
			cell.classList.toggle("last", !!this.lastMove && (this.lastMove.from === name || this.lastMove.to === name));
			cell.classList.toggle("check", name === checkSquare);
			cell.classList.toggle("selected", name === this.selected);
			cell.classList.toggle("target", targets.has(name));
			cell.classList.toggle("capture", targets.has(name) && !!piece);
		}
	}

	// The position as shown (orientation, last move, check, coordinates) as a
	// PNG image, size x size pixels.
	async toPng(size = 800) {
		const sq = size / 8;
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext("2d");
		const css = getComputedStyle(this.el);
		const light = css.getPropertyValue("--light-sq").trim() || "#f0d9b5";
		const dark = css.getPropertyValue("--dark-sq").trim() || "#b58863";
		const board = this.chess.board();
		const checkSquare = this.chess.inCheck() ? this.kingSquare(this.chess.turn()) : null;

		const images = {};
		await Promise.all(
			board.flat().filter(Boolean).map(async (p) => {
				const key = p.color + p.type;
				if (images[key]) return;
				const img = new Image();
				images[key] = img;
				img.src = pieceSrc(p.color, p.type);
				await img.decode();
			})
		);

		ctx.font = `600 ${Math.round(sq * 0.17)}px system-ui, sans-serif`;
		for (let row = 0; row < 8; row++) {
			for (let col = 0; col < 8; col++) {
				const file = this.flipped ? 7 - col : col;
				const rank = this.flipped ? row + 1 : 8 - row;
				const name = FILES[file] + rank;
				const isLight = (file + rank) % 2 === 1;
				const x = col * sq;
				const y = row * sq;
				ctx.fillStyle = isLight ? light : dark;
				ctx.fillRect(x, y, sq, sq);
				if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) {
					ctx.fillStyle = "rgba(205, 210, 106, 0.55)";
					ctx.fillRect(x, y, sq, sq);
				}
				if (name === checkSquare) {
					const g = ctx.createRadialGradient(x + sq / 2, y + sq / 2, 0, x + sq / 2, y + sq / 2, sq * 0.7);
					g.addColorStop(0, "rgba(255, 0, 0, 0.8)");
					g.addColorStop(0.4, "rgba(231, 0, 0, 0.4)");
					g.addColorStop(1, "rgba(231, 0, 0, 0)");
					ctx.fillStyle = g;
					ctx.fillRect(x, y, sq, sq);
				}
				ctx.fillStyle = isLight ? dark : light;
				if (col === 0) {
					ctx.textAlign = "left";
					ctx.textBaseline = "top";
					ctx.fillText(String(rank), x + sq * 0.05, y + sq * 0.05);
				}
				if (row === 7) {
					ctx.textAlign = "right";
					ctx.textBaseline = "bottom";
					ctx.fillText(FILES[file], x + sq * 0.95, y + sq * 0.97);
				}
				const piece = board[8 - rank][file];
				if (piece) ctx.drawImage(images[piece.color + piece.type], x, y, sq, sq);
			}
		}
		return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
	}

	kingSquare(color) {
		const board = this.chess.board();
		for (let r = 0; r < 8; r++)
			for (let f = 0; f < 8; f++) {
				const p = board[r][f];
				if (p && p.type === "k" && p.color === color) return FILES[f] + (8 - r);
			}
		return null;
	}

	squareAt(x, y) {
		const hit = document.elementFromPoint(x, y);
		const cell = hit && hit.closest && hit.closest(".sq");
		return cell && this.el.contains(cell) ? cell.dataset.square : null;
	}

	movable(square) {
		const piece = this.chess.get(square);
		return !!piece && piece.color === this.chess.turn() && this.canMove() && !this.chess.isGameOver();
	}

	pointerDown(e) {
		if (e.button !== undefined && e.button !== 0) return;
		const square = this.squareAt(e.clientX, e.clientY);
		if (!square) return;
		e.preventDefault();
		// Second click of click-to-move.
		if (this.selected && square !== this.selected && !this.movable(square)) {
			this.tryMove(this.selected, square);
			return;
		}
		if (!this.movable(square)) {
			this.selected = null;
			this.render();
			return;
		}
		const wasSelected = this.selected === square;
		this.selected = square;
		const piece = this.chess.get(square);
		this.drag = { from: square, startX: e.clientX, startY: e.clientY, moved: false, wasSelected, piece, ghost: null, pointerId: e.pointerId };
		this.render();
	}

	pointerMove(e) {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		const d = this.drag;
		if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
		if (!d.moved) {
			d.moved = true;
			const size = this.el.getBoundingClientRect().width / 8;
			d.ghost = document.createElement("img");
			d.ghost.src = pieceSrc(d.piece.color, d.piece.type);
			d.ghost.className = "drag-ghost";
			d.ghost.style.width = d.ghost.style.height = `${size}px`;
			document.body.append(d.ghost);
			this.render();
		}
		d.ghost.style.left = `${e.clientX}px`;
		d.ghost.style.top = `${e.clientY}px`;
	}

	pointerUp(e) {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		const d = this.drag;
		this.cancelDrag();
		if (!d.moved) {
			// A plain click on the selected piece again deselects it.
			if (d.wasSelected) {
				this.selected = null;
				this.render();
			}
			return;
		}
		const to = this.squareAt(e.clientX, e.clientY);
		if (to && to !== d.from) this.tryMove(d.from, to);
		else this.render();
	}

	cancelDrag() {
		if (this.drag && this.drag.ghost) this.drag.ghost.remove();
		const hadGhost = this.drag && this.drag.moved;
		this.drag = null;
		if (hadGhost) this.render();
	}

	tryMove(from, to) {
		const moves = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
		if (!moves.length) {
			this.selected = this.movable(to) ? to : null;
			this.render();
			return;
		}
		this.selected = null;
		if (moves.some((m) => m.promotion)) {
			this.choosePromotion(to, this.chess.turn()).then((piece) => {
				if (piece) this.onMove({ from, to, promotion: piece });
				else this.render();
			});
			return;
		}
		this.onMove({ from, to });
	}

	choosePromotion(square, color) {
		return new Promise((resolve) => {
			const overlay = document.createElement("div");
			overlay.className = "promotion";
			const done = (piece) => {
				overlay.remove();
				resolve(piece);
			};
			for (const type of PROMOTION_PIECES) {
				const button = document.createElement("button");
				button.type = "button";
				button.title = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[type];
				const img = document.createElement("img");
				img.src = pieceSrc(color, type);
				img.alt = button.title;
				button.append(img);
				button.addEventListener("click", () => done(type));
				overlay.append(button);
			}
			overlay.addEventListener("pointerdown", (e) => e.target === overlay && done(null));
			this.el.append(overlay);
			this.render();
		});
	}
}
