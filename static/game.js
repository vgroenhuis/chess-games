// The game page, in one of three modes:
//   game.html?id=N     a game: replay it; visitors can add moves locally, the
//                      admin edits it
//   game.html          free board (game.html?fen=... starts from a position)
//   game.html?new=1    admin: a new game
import { Board } from "./board.js";
import { $, displayName, el, eventLink, fetchData, fmtDate, loadSite } from "./common.js";
import { deleteGame, gameIds, readGame, writeGame } from "./github.js";
import { parsePgn, writePgn } from "./pgn.js";
import { GameTree, MOVE_NAGS, NAG_SYMBOLS, POSITION_NAGS, START_FEN, moveLabel } from "./tree.js";

const params = new URLSearchParams(location.search);
let gameId = params.get("id") ? Number(params.get("id")) : null;
const isNew = params.get("new") === "1";

let tree = new GameTree();
let current = tree.root;
let headers = {};
let published = false;
let editing = false; // admin editing this game: moves are saved
let dirty = false;
let sha = null; // the saved file's version on GitHub (needed to update it)

const FIELDS = [
	["White", "White"], ["Black", "Black"],
	["WhiteTeam", "White's club"], ["BlackTeam", "Black's club"],
	["WhiteElo", "White's rating"], ["BlackElo", "Black's rating"],
	["Event", "Competition"], ["EventURL", "Competition web page"],
	["Round", "Round"],
	["Date", "Date (YYYY.MM.DD)"], ["Site", "Place"],
];
const RESULTS = [["*", "* (unfinished / unknown)"], ["1-0", "1-0"], ["0-1", "0-1"], ["1/2-1/2", "½-½"]];

const board = new Board($("board"), { onMove: playMove });

// -- state changes --------------------------------------------------------

function playMove(move) {
	const before = current.children.length;
	let node;
	try {
		node = tree.addMove(current, move, { local: !editing });
	} catch {
		board.render();
		return;
	}
	// A move that already exists here is just followed, not added.
	if (editing && current.children.length > before) markDirty();
	setCurrent(node);
}

function setCurrent(node) {
	current = node;
	render();
}

function markDirty() {
	dirty = true;
	$("save-status").className = "small dirty";
	$("save-status").textContent = "Unsaved changes";
}

window.addEventListener("beforeunload", (event) => {
	if (dirty) event.preventDefault();
});

// -- rendering ------------------------------------------------------------

function render() {
	board.setPosition(current.fen, current.from ? { from: current.from, to: current.to } : null);
	renderMoves();
	const comment = current.parent ? current.comment : "";
	$("current-comment").textContent = comment;
	$("current-comment").classList.toggle("hidden", !comment);
	$("clear-local").classList.toggle("hidden", !tree.hasLocal());
	$("first").disabled = $("prev").disabled = !current.parent;
	$("next").disabled = $("last").disabled = !current.children.length;
	if (editing) renderEditor();
}

function moveSpan(node, withNumber) {
	const { number, text } = moveLabel(node, withNumber);
	const move = el("span", { class: `move${node === current ? " current" : ""}${node.local ? " local" : ""}`, dataset: { id: node.id }, onclick: () => setCurrent(node) }, text);
	return number ? [el("span", { class: "num" }, number), move, " "] : [move, " "];
}

function commentSpan(text) {
	return text ? [el("span", { class: "comment" }, text), " "] : [];
}

// Writes the line starting at `first` (and, along the way, the alternatives
// to each of its moves as indented variations) into `container`.
function renderLine(first, container) {
	let node = first;
	let needNumber = true;
	while (node) {
		if (node.pre) container.append(...commentSpan(node.pre));
		container.append(...moveSpan(node, needNumber || !!node.pre));
		needNumber = false;
		if (node.comment) {
			container.append(...commentSpan(node.comment));
			needNumber = true;
		}
		const siblings = node.parent.children;
		if (siblings[0] === node && siblings.length > 1) {
			for (const alt of siblings.slice(1)) {
				const block = el("div", { class: "variation" });
				renderLine(alt, block);
				container.append(block);
			}
			needNumber = true;
		}
		node = node.children[0];
	}
}

function renderMoves() {
	const list = $("moves");
	const main = el("div", { class: "main" });
	if (tree.root.comment) main.append(el("span", { class: "comment game-comment" }, tree.root.comment));
	if (tree.root.children.length) renderLine(tree.root.children[0], main);
	else main.append(el("span", { class: "muted small" }, gameId || isNew ? "No moves yet." : "Make a move on the board."));
	if (headers.Result && headers.Result !== "*") main.append(el("span", { class: "result" }, headers.Result.replace("1/2-1/2", "½-½")));
	list.replaceChildren(main);
	const active = list.querySelector(".move.current");
	if (active) active.scrollIntoView({ block: "nearest" });
}

function renderHeader() {
	if (!gameId && !isNew) {
		$("players").textContent = "Free board";
		$("meta").textContent = "Play both sides, or replay any idea. Nothing is saved.";
		document.title = "Free board - Vincent's chess games";
		return;
	}
	const club = (name) => (name ? ` (${name})` : "");
	// Wrapped in el(), which skips missing parts; replaceChildren() would print them as "null".
	$("players").replaceChildren(
		el(
			"span",
			{},
			el("span", {}, displayName(headers.White) + club(headers.WhiteTeam)),
			el("span", { class: "vs" }, "–"),
			el("span", {}, displayName(headers.Black) + club(headers.BlackTeam)),
			headers.Result && headers.Result !== "*" ? el("span", { class: "vs" }, headers.Result.replace("1/2-1/2", "½-½")) : null,
			editing && !published ? el("span", { class: "badge" }, "draft") : null
		)
	);
	const event = headers.Event && headers.Event !== "?" ? headers.Event : "";
	const round = headers.Round && headers.Round !== "?" ? `round ${headers.Round}` : "";
	const site = headers.Site && headers.Site !== "?" ? headers.Site : "";
	const parts = [event ? eventLink(event, headers.EventURL) : "", round, fmtDate(headers.Date), site].filter(Boolean);
	$("meta").replaceChildren(...parts.flatMap((part, i) => (i ? [" · ", part] : [part])));
	document.title = `${displayName(headers.White)} - ${displayName(headers.Black)} - Vincent's chess games`;
}

// -- editor ---------------------------------------------------------------

function buildEditor() {
	$("fields").replaceChildren(
		...FIELDS.map(([key, label]) =>
			el("label", {}, label, el("input", { dataset: { header: key }, value: headers[key] && headers[key] !== "?" && headers[key] !== "????.??.??" ? headers[key] : "", oninput: onFieldInput }))
		),
		el("label", {}, "Result", el("select", { dataset: { header: "Result" }, onchange: onFieldInput }, ...RESULTS.map(([value, label]) => el("option", { value }, label))))
	);
	$("fields").querySelector("select").value = headers.Result || "*";
	$("published").checked = published;
	$("move-nags").replaceChildren(...MOVE_NAGS.map((n) => nagButton(n, MOVE_NAGS)));
	$("position-nags").replaceChildren(...POSITION_NAGS.map((n) => nagButton(n, POSITION_NAGS)));
}

function onFieldInput(event) {
	headers[event.target.dataset.header] = event.target.value.trim();
	markDirty();
	renderHeader();
	renderMoves();
}

function nagButton(nag, group) {
	return el(
		"button",
		{
			type: "button",
			class: "secondary small",
			dataset: { nag },
			title: `$${nag}`,
			onclick: () => {
				if (!current.parent) return;
				const had = current.nags.includes(nag);
				// One symbol per group: a move is "!" or "?", not both.
				current.nags = current.nags.filter((n) => !group.includes(n));
				if (!had) current.nags.push(nag);
				current.nags.sort((a, b) => a - b);
				markDirty();
				render();
			},
		},
		NAG_SYMBOLS[nag]
	);
}

function renderEditor() {
	const atMove = !!current.parent;
	$("selected-label").textContent = atMove
		? `After ${moveLabel(current, true).number}${current.san}${tree.isMainline(current) ? "" : " (variation)"}`
		: "Start of the game: the comment below is shown before the first move.";
	const comment = $("comment");
	if (document.activeElement !== comment) comment.value = atMove ? current.comment : tree.root.comment;
	comment.placeholder = atMove ? "Comment after this move" : "Comment before the first move";
	for (const button of document.querySelectorAll(".nag-buttons button")) {
		button.disabled = !atMove;
		button.classList.toggle("on", atMove && current.nags.includes(Number(button.dataset.nag)));
	}
	$("promote").disabled = $("mainline").disabled = !atMove || tree.isMainline(current);
	$("delete-move").disabled = !atMove;
}

$("comment").addEventListener("input", (event) => {
	if (current.parent) current.comment = event.target.value;
	else tree.root.comment = event.target.value;
	markDirty();
	renderMoves();
	$("current-comment").textContent = current.parent ? current.comment : "";
	$("current-comment").classList.toggle("hidden", !(current.parent && current.comment));
});

$("promote").addEventListener("click", () => {
	if (tree.promote(current)) {
		markDirty();
		render();
	}
});

$("mainline").addEventListener("click", () => {
	if (tree.makeMainline(current)) {
		markDirty();
		render();
	}
});

$("delete-move").addEventListener("click", () => {
	if (!current.parent) return;
	const following = countNodes(current) - 1;
	if (following > 0 && !confirm(`Delete ${current.san} and the ${following} move(s) after it?`)) return;
	const parent = current.parent;
	tree.remove(current);
	markDirty();
	setCurrent(parent);
});

function countNodes(node) {
	let n = 0;
	const stack = [node];
	while (stack.length) {
		const x = stack.pop();
		n++;
		stack.push(...x.children);
	}
	return n;
}

$("published").addEventListener("change", (event) => {
	published = event.target.checked;
	markDirty();
	renderHeader();
});

$("save").addEventListener("click", async () => {
	const status = $("save-status");
	status.className = "small muted";
	status.textContent = "Saving to GitHub...";
	const text = gamePgn();
	const title = `${headers.White || "?"} - ${headers.Black || "?"}`;
	try {
		if (gameId) {
			sha = await writeGame(gameId, text, sha, `Update game ${gameId}: ${title}`);
		} else {
			const id = Math.max(0, ...(await gameIds())) + 1;
			sha = await writeGame(id, text, null, `Add game ${id}: ${title}`);
			gameId = id;
			history.replaceState(null, "", `game.html?id=${gameId}`);
			$("delete-game").disabled = false;
		}
		dirty = false;
		updateLinks();
		status.className = "small";
		status.style.color = "var(--ok)";
		status.textContent = `Saved ${new Date().toLocaleTimeString()}; the public site shows it in about a minute.`;
	} catch (err) {
		status.className = "small error";
		status.style.color = "";
		status.textContent = err.message;
	}
});

$("delete-game").addEventListener("click", async () => {
	if (!gameId || !confirm("Delete this game for good?")) return;
	try {
		await deleteGame(gameId, sha, `Delete game ${gameId}`);
		dirty = false;
		location.href = "./";
	} catch (err) {
		$("save-status").className = "small error";
		$("save-status").textContent = err.message;
	}
});

$("pgn-load").addEventListener("click", async () => {
	const status = $("pgn-status");
	status.className = "small muted";
	status.textContent = "";
	try {
		const games = parsePgn($("pgn-text").value);
		headers = games[0].headers;
		tree = games[0].tree;
		current = tree.root;
		buildEditor();
		renderHeader();
		markDirty();
		render();
		status.textContent = games.length > 1 ? `Loaded the first of ${games.length} games.` : "Loaded.";
	} catch (err) {
		status.className = "small error";
		status.textContent = err.message;
	}
});

// -- Chess.com analysis -----------------------------------------------------

// Chess.com's analysis board takes a PGN in its URL. A long PGN (many
// comments and variations) would make the URL too long for some browsers and
// servers, so then only the main line goes.
const CHESSCOM_MAX_URL = 7000;

function chesscomUrl(pgnText) {
	return `https://www.chess.com/analysis?pgn=${encodeURIComponent(pgnText.trim())}`;
}

function mainlinePgn() {
	const tags = [["White", headers.White], ["Black", headers.Black], ["Result", headers.Result || "*"]];
	if (tree.root.fen !== START_FEN) tags.push(["SetUp", "1"], ["FEN", tree.root.fen]);
	const moves = [];
	for (let n = tree.root.children[0], first = true; n && !n.local; n = n.children[0], first = false) {
		// Plain PGN numbering ("1." / "1..."), not the move list's display labels.
		const number = n.color === "w" ? `${n.moveNumber}. ` : first ? `${n.moveNumber}... ` : "";
		moves.push(number + n.san);
	}
	return tags.filter(([, v]) => v).map(([k, v]) => `[${k} "${v}"]`).join("\n") + `\n\n${moves.join(" ")} ${headers.Result || "*"}`;
}

// The game as PGN, as it is now (the Draft tag marks unpublished games).
function gamePgn() {
	return writePgn(published ? headers : { ...headers, Draft: "1" }, tree);
}

// "Download PGN" and "Analyze at Chess.com", both from the game as shown.
function updateLinks() {
	const text = writePgn(headers, tree);
	const download = $("download-pgn");
	download.href = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn" }));
	download.download = `${[headers.Date, headers.White, headers.Black].filter((p) => p && /[^?.]/.test(p)).map((p) => p.replace(/[^A-Za-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")).join("_") || "game"}.pgn`;
	download.classList.remove("hidden");
	let url = chesscomUrl(text);
	if (url.length > CHESSCOM_MAX_URL) url = chesscomUrl(mainlinePgn());
	$("analyze-chesscom").href = url;
	$("analyze-chesscom").classList.remove("hidden");
}

// -- navigation -----------------------------------------------------------

$("first").addEventListener("click", () => setCurrent(tree.root));
$("prev").addEventListener("click", () => current.parent && setCurrent(current.parent));
$("next").addEventListener("click", () => current.children.length && setCurrent(current.children[0]));
$("last").addEventListener("click", () => setCurrent(tree.lastOfLine(current)));
$("flip").addEventListener("click", () => board.flip());
$("clear-local").addEventListener("click", () => {
	const onLocal = tree.path(current).some((n) => n.local);
	tree.removeLocal();
	if (onLocal) {
		let n = current;
		while (n.local) n = n.parent;
		current = n;
	}
	render();
});

document.addEventListener("keydown", (event) => {
	if (event.target.closest("input, textarea, select") || event.altKey || event.ctrlKey || event.metaKey) return;
	const siblings = current.parent ? current.parent.children : [];
	const i = siblings.indexOf(current);
	const actions = {
		ArrowLeft: () => current.parent && setCurrent(current.parent),
		ArrowRight: () => current.children.length && setCurrent(current.children[0]),
		Home: () => setCurrent(tree.root),
		End: () => setCurrent(tree.lastOfLine(current)),
		// Switch between the alternatives to this move.
		ArrowUp: () => i > 0 && setCurrent(siblings[i - 1]),
		ArrowDown: () => i >= 0 && i < siblings.length - 1 && setCurrent(siblings[i + 1]),
		f: () => board.flip(),
	};
	if (actions[event.key]) {
		event.preventDefault();
		actions[event.key]();
	}
});

// -- start ----------------------------------------------------------------

async function init() {
	const site = loadSite();
	try {
		if (gameId && site.admin) {
			// The admin edits the file on GitHub, which may be newer than the built site.
			const file = await readGame(gameId);
			if (!file) throw Object.assign(new Error("Not found."), { status: 404 });
			const game = parsePgn(file.text)[0];
			sha = file.sha;
			headers = game.headers;
			published = !["1", "true", "yes"].includes(headers.Draft);
			delete headers.Draft;
			tree = game.tree;
			editing = true;
		} else if (gameId) {
			const game = await fetchData(`data/games/${gameId}.json`);
			headers = game.headers;
			published = true;
			tree = new GameTree(game.tree);
		}
		if (gameId) {
			updateLinks();
			// The player's own perspective: show the board from Black's side when Vincent had Black.
			if (/groenhuis/i.test(headers.Black || "") && !/groenhuis/i.test(headers.White || "")) board.flip();
		} else if (isNew && site.admin) {
			editing = true;
			const today = new Date().toISOString().slice(0, 10).replaceAll("-", ".");
			headers = { Event: "", Site: "", Date: today, Round: "", White: "", Black: "", Result: "*" };
			$("delete-game").disabled = true;
		} else {
			tree = new GameTree({ fen: params.get("fen") || null });
		}
	} catch (err) {
		$("players").textContent = "";
		$("load-error").textContent = err.status === 404 ? "This game doesn't exist (or isn't published yet)." : err.message;
		$("load-error").hidden = false;
		return;
	}
	current = tree.root;
	if (editing) {
		$("editor").classList.remove("hidden");
		$("explore-note").textContent = "Admin: moves you make are added to the game (as a variation where a move already exists). Save to keep them.";
		buildEditor();
	}
	renderHeader();
	render();
}

init();
