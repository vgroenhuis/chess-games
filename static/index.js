import { $, displayName, el, eventLink, fetchData, fmtDate, loadSite } from "./common.js";
import { gameIds, setToken, writeGame } from "./github.js";
import { parsePgn, writePgn } from "./pgn.js";

let games = [];
const { admin } = loadSite();

function player(name, club) {
	return [displayName(name), club ? el("span", { class: "club" }, club) : null];
}

function render() {
	const words = $("search").value.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = games.filter((g) => {
		if (!g.published && !admin) return false;
		const text = [g.white, g.black, g.white_club, g.black_club, g.event, g.round, g.date, g.result].join(" ").toLowerCase();
		return words.every((w) => text.includes(w));
	});
	if (!shown.length) {
		$("games-body").replaceChildren(el("tr", {}, el("td", { colspan: 7, class: "muted" }, games.length ? "No games match." : "No games yet.")));
		return;
	}
	$("games-body").replaceChildren(
		...shown.map((g) =>
			el(
				"tr",
				{ onclick: () => (location.href = `game.html?id=${g.id}`) },
				el("td", {}, el("a", { href: `game.html?id=${g.id}` }, fmtDate(g.date) || "—"), g.published ? null : el("span", { class: "badge" }, "draft")),
				el("td", {}, player(g.white, g.white_club)),
				el("td", {}, player(g.black, g.black_club)),
				el("td", { class: "result" }, g.result.replace("1/2-1/2", "½-½")),
				el("td", { class: "wide" }, eventLink(g.event, g.event_url)),
				el("td", { class: "wide" }, g.round),
				el("td", { class: "wide" }, Math.ceil(g.plies / 2) || "")
			)
		)
	);
}

async function load() {
	try {
		games = (await fetchData("data/index.json")).games;
	} catch (err) {
		$("games-body").replaceChildren(el("tr", {}, el("td", { colspan: 7, class: "error" }, err.message)));
		return;
	}
	render();
}

$("admin-bar").classList.toggle("hidden", !admin);
$("admin-note").classList.toggle("hidden", !admin);
$("login-link").classList.toggle("hidden", admin);
$("search").addEventListener("input", render);
$("import-toggle").addEventListener("click", () => $("import-card").classList.toggle("hidden"));

$("import-go").addEventListener("click", async () => {
	const status = $("import-status");
	status.className = "small muted";
	try {
		const parsed = parsePgn($("import-text").value);
		status.textContent = `Saving ${parsed.length} game(s) to GitHub...`;
		let next = Math.max(0, ...(await gameIds())) + 1;
		for (const game of parsed) {
			const pgn = writePgn({ ...game.headers, Draft: "1" }, game.tree);
			await writeGame(next, pgn, null, `Import game ${next}: ${game.headers.White || "?"} - ${game.headers.Black || "?"}`);
			next++;
		}
		status.textContent = `Imported ${parsed.length} game(s) as drafts. They appear in this list in about a minute, once the site has rebuilt.`;
		$("import-text").value = "";
	} catch (err) {
		status.className = "small error";
		status.textContent = err.message;
	}
});

$("logout").addEventListener("click", () => {
	setToken("");
	location.reload();
});

load();
