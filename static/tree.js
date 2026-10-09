// The game as a tree of moves (see app/pgn.py for the JSON format). Each node
// knows its position (FEN) and move, so the board can show any point of the
// game or of a variation. Nodes added by a visitor are marked `local` and are
// never sent to the server.

import { Chess } from "./vendor/chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const NAG_SYMBOLS = {
	1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!",
	// 14/15 as "+=" / "=+": their own symbols (⩲ ⩱) are missing from many fonts.
	10: "=", 13: "∞", 14: "+=", 15: "=+", 16: "±", 17: "∓", 18: "+−", 19: "−+",
};
export const MOVE_NAGS = [1, 2, 3, 4, 5, 6];
export const POSITION_NAGS = [10, 13, 14, 15, 16, 17, 18, 19];

let nextId = 1;

function makeNode(parent, fields) {
	return { id: nextId++, parent, children: [], comment: "", pre: "", nags: [], local: false, ...fields };
}

export class GameTree {
	constructor(data = {}) {
		const fen = data.fen || START_FEN;
		new Chess(fen); // throws on an invalid start position
		this.root = makeNode(null, { fen, comment: data.comment || "" });
		this.nodes = new Map([[this.root.id, this.root]]);
		// Iterative, so long games don't nest the call stack deeply.
		const stack = [[this.root, data.children || []]];
		while (stack.length) {
			const [parent, children] = stack.pop();
			for (const child of children) {
				const node = this.addMove(parent, child.san, { comment: child.comment || "", pre: child.pre || "", nags: child.nags || [] });
				stack.push([node, child.children || []]);
			}
		}
	}

	// Plays `move` (SAN, or {from, to, promotion}) after `parent`. An existing
	// continuation with the same move is reused instead of duplicated.
	addMove(parent, move, extra = {}) {
		const chess = new Chess(parent.fen);
		const played = chess.move(move); // throws on an illegal move
		const existing = parent.children.find((c) => c.san === played.san);
		if (existing) return existing;
		const node = makeNode(parent, {
			san: played.san,
			from: played.from,
			to: played.to,
			color: played.color,
			moveNumber: Number(parent.fen.split(" ")[5]) || 1,
			fen: chess.fen(),
			...extra,
		});
		parent.children.push(node);
		this.nodes.set(node.id, node);
		return node;
	}

	// root -> node, both included.
	path(node) {
		const nodes = [];
		for (let n = node; n; n = n.parent) nodes.unshift(n);
		return nodes;
	}

	isMainline(node) {
		for (let n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false;
		return true;
	}

	lastOfLine(node) {
		let n = node;
		while (n.children.length) n = n.children[0];
		return n;
	}

	remove(node) {
		if (!node.parent) return;
		node.parent.children.splice(node.parent.children.indexOf(node), 1);
		const stack = [node];
		while (stack.length) {
			const n = stack.pop();
			this.nodes.delete(n.id);
			stack.push(...n.children);
		}
	}

	// Moves the variation `node` is in one place up among its alternatives
	// (to the main line when it was the first alternative).
	promote(node) {
		let n = node;
		while (n.parent && n.parent.children[0] === n) n = n.parent;
		if (!n.parent) return false;
		const siblings = n.parent.children;
		const i = siblings.indexOf(n);
		[siblings[i - 1], siblings[i]] = [siblings[i], siblings[i - 1]];
		return true;
	}

	// Makes the line through `node` the main line, at every branch on the way.
	makeMainline(node) {
		let changed = false;
		for (let n = node; n.parent; n = n.parent) {
			const siblings = n.parent.children;
			const i = siblings.indexOf(n);
			if (i > 0) {
				siblings.splice(i, 1);
				siblings.unshift(n);
				changed = true;
			}
		}
		return changed;
	}

	hasLocal() {
		for (const n of this.nodes.values()) if (n.local) return true;
		return false;
	}

	removeLocal() {
		for (const n of [...this.nodes.values()]) if (n.local && this.nodes.has(n.id) && !(n.parent && n.parent.local)) this.remove(n);
	}

	// For saving: the JSON format, without visitors' moves.
	toJSON() {
		const out = (n) => ({
			san: n.san,
			comment: n.comment,
			pre: n.pre,
			nags: n.nags,
			children: n.children.filter((c) => !c.local).map(out),
		});
		return {
			fen: this.root.fen === START_FEN ? null : this.root.fen,
			comment: this.root.comment,
			children: this.root.children.filter((c) => !c.local).map(out),
		};
	}
}

export function moveLabel(node, withNumber) {
	const nags = node.nags.map((n) => NAG_SYMBOLS[n] || `$${n}`).join("");
	const number = node.color === "w" ? `${node.moveNumber}. ` : withNumber ? `${node.moveNumber}… ` : "";
	return { number, text: node.san + nags };
}
