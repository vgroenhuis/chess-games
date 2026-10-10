// Reading and writing PGN in the browser, for the admin editor (visitors get
// games already converted by the build, see build.py). Moves are checked with
// chess.js through GameTree; build.py checks every saved game again with
// python-chess.

import { GameTree, START_FEN } from "./tree.js";

const ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
const SUFFIX_NAGS = { "!": 1, "?": 2, "!!": 3, "??": 4, "!?": 5, "?!": 6 };

export class PgnError extends Error {}

// -- reading ------------------------------------------------------------------

function* tokens(movetext) {
	const re = /\s*(?:(\{[^}]*\})|(;[^\n]*)|(\()|(\))|(\$\d+)|(1-0|0-1|1\/2-1\/2|\*)|(\d+\.(?:\.\.)?)|([^\s{}();$]+))/y;
	let m;
	re.lastIndex = 0;
	while (re.lastIndex < movetext.length && (m = re.exec(movetext))) {
		if (m[1]) yield { type: "comment", value: m[1].slice(1, -1).trim() };
		else if (m[2]) yield { type: "comment", value: m[2].slice(1).trim() };
		else if (m[3]) yield { type: "open" };
		else if (m[4]) yield { type: "close" };
		else if (m[5]) yield { type: "nag", value: Number(m[5].slice(1)) };
		else if (m[6]) yield { type: "result", value: m[6] };
		else if (m[7]) continue; // move number
		else if (m[8]) yield { type: "move", value: m[8] };
		if (!m[0]) break;
	}
}

function parseHeaders(text) {
	const headers = {};
	for (const m of text.matchAll(/\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g)) {
		headers[m[1]] = m[2].replace(/\\(["\\])/g, "$1");
	}
	return headers;
}

function parseMovetext(movetext, fen) {
	const tree = new GameTree({ fen: fen || null });
	// Each level: the position a move is played from (`base`), and the last move
	// played at this level, which a variation is an alternative to.
	let level = { base: tree.root, last: null, pendingPre: "" };
	const stack = [];
	let result = null;
	for (const tok of tokens(movetext)) {
		if (tok.type === "move") {
			let san = tok.value;
			const suffix = san.match(/[!?]{1,2}$/);
			if (suffix) san = san.slice(0, -suffix[0].length);
			let node;
			try {
				node = tree.addMove(level.last || level.base, san);
			} catch {
				const where = level.last ? `after ${level.last.san}` : "at the start";
				throw new PgnError(`Illegal move "${tok.value}" ${where}.`);
			}
			if (level.pendingPre) {
				node.pre = level.pendingPre;
				level.pendingPre = "";
			}
			if (suffix && SUFFIX_NAGS[suffix[0]] && !node.nags.includes(SUFFIX_NAGS[suffix[0]])) node.nags.push(SUFFIX_NAGS[suffix[0]]);
			level.last = node;
		} else if (tok.type === "comment") {
			const join = (a, b) => (a ? `${a} ${b}` : b);
			if (level.last) level.last.comment = join(level.last.comment, tok.value);
			else if (!stack.length) tree.root.comment = join(tree.root.comment, tok.value); // before the first move
			else level.pendingPre = join(level.pendingPre, tok.value); // at the start of a variation
		} else if (tok.type === "nag") {
			if (level.last && !level.last.nags.includes(tok.value)) level.last.nags.push(tok.value);
		} else if (tok.type === "open") {
			if (!level.last) throw new PgnError("A variation starts before any move.");
			stack.push(level);
			// An alternative to the last move: played from the same position.
			level = { base: level.last.parent, last: null, pendingPre: "" };
		} else if (tok.type === "close") {
			if (!stack.length) throw new PgnError('Unbalanced ")".');
			level = stack.pop();
		} else if (tok.type === "result") {
			result = tok.value;
		}
	}
	if (stack.length) throw new PgnError('Unbalanced "(".');
	for (const n of tree.nodes.values()) n.nags.sort((a, b) => a - b);
	return { tree, result };
}

// Every game in a PGN text, as { headers, tree } (tree: a GameTree). A header
// line after some moves starts the next game.
export function parsePgn(text) {
	const games = [];
	let headerLines = [];
	let moveLines = [];
	const flush = () => {
		if (!headerLines.length && !moveLines.join("").trim()) return;
		const headers = parseHeaders(headerLines.join("\n"));
		const fen = headers.FEN || null;
		let parsed;
		try {
			parsed = parseMovetext(moveLines.join("\n"), fen);
		} catch (err) {
			throw new PgnError(`Game ${games.length + 1} (${headers.White || "?"} - ${headers.Black || "?"}): ${err.message}`);
		}
		if (!headers.Result && parsed.result) headers.Result = parsed.result;
		games.push({ headers, tree: parsed.tree });
		headerLines = [];
		moveLines = [];
	};
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("%")) continue; // PGN escape line
		if (trimmed.startsWith("[") && !inComment(moveLines)) {
			if (moveLines.join("").trim()) flush();
			headerLines.push(trimmed);
		} else {
			moveLines.push(line);
		}
	}
	flush();
	if (!games.length) throw new PgnError("No games found in that PGN.");
	return games;
}

// Whether the movetext so far ends inside a { comment } (which may span lines
// and contain "[").
function inComment(lines) {
	const text = lines.join("\n");
	return text.lastIndexOf("{") > text.lastIndexOf("}");
}

// -- writing ------------------------------------------------------------------

function comment(text) {
	return text ? `{ ${text.replace(/}/g, ")")} }` : "";
}

function writeLine(first, out) {
	let node = first;
	let needNumber = true;
	while (node) {
		if (node.pre) {
			out.push(comment(node.pre));
			needNumber = true;
		}
		const number = node.color === "w" ? `${node.moveNumber}.` : needNumber ? `${node.moveNumber}...` : "";
		out.push((number ? `${number} ` : "") + node.san + node.nags.map((n) => ` $${n}`).join(""));
		needNumber = false;
		if (node.comment) {
			out.push(comment(node.comment));
			needNumber = true;
		}
		const siblings = node.parent.children.filter((c) => !c.local);
		if (siblings[0] === node && siblings.length > 1) {
			for (const alt of siblings.slice(1)) {
				out.push("(");
				writeLine(alt, out);
				out.push(")");
			}
			needNumber = true;
		}
		node = node.children.find((c) => !c.local);
	}
}

// PGN text for a game (headers + a GameTree), without visitors' local moves.
export function writePgn(headers, tree) {
	const h = { ...headers };
	for (const tag of ROSTER) if (!h[tag]) h[tag] = tag === "Date" ? "????.??.??" : tag === "Result" ? "*" : "?";
	if (tree.root.fen !== START_FEN) {
		h.SetUp = "1";
		h.FEN = tree.root.fen;
	}
	const order = [...ROSTER, ...Object.keys(h).filter((k) => !ROSTER.includes(k))];
	const headerText = order
		.filter((k) => h[k] !== undefined && h[k] !== "")
		.map((k) => `[${k} "${String(h[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`)
		.join("\n");
	const out = [];
	if (tree.root.comment) out.push(comment(tree.root.comment));
	const first = tree.root.children.find((c) => !c.local);
	if (first) writeLine(first, out);
	out.push(h.Result);
	// Units that stay on one line: a move, or a whole comment (a line break
	// inside a comment would become part of it), with "(" / ")" attached.
	const units = [];
	let open = "";
	for (const item of out) {
		if (item === "(") open += "(";
		else if (item === ")") units[units.length - 1] += ")";
		else {
			units.push(open + item);
			open = "";
		}
	}
	// Wrap at 80 columns where possible, as PGN recommends.
	const lines = [];
	let line = "";
	for (const unit of units) {
		if (line && line.length + 1 + unit.length > 79) {
			lines.push(line);
			line = unit;
		} else line = line ? `${line} ${unit}` : unit;
	}
	if (line) lines.push(line);
	return `${headerText}\n\n${lines.join("\n")}\n`;
}
