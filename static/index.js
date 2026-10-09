import { $, api, displayName, el, fmtDate, loadSite } from "./common.js";

let games = [];
let admin = false;

function player(name, club) {
	return [displayName(name), club ? el("span", { class: "club" }, club) : null];
}

function render() {
	const words = $("search").value.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = games.filter((g) => {
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
				el("td", { class: "wide" }, g.event),
				el("td", { class: "wide" }, g.round),
				el("td", { class: "wide" }, Math.ceil(g.plies / 2) || "")
			)
		)
	);
}

async function load() {
	try {
		const data = await api("api/games");
		games = data.games;
		admin = data.admin;
	} catch (err) {
		$("games-body").replaceChildren(el("tr", {}, el("td", { colspan: 7, class: "error" }, err.message)));
		return;
	}
	$("admin-bar").classList.toggle("hidden", !admin);
	$("login-link").classList.toggle("hidden", admin);
	render();
}

$("search").addEventListener("input", render);

$("import-toggle").addEventListener("click", () => $("import-card").classList.toggle("hidden"));

$("import-go").addEventListener("click", async () => {
	const status = $("import-status");
	status.className = "small muted";
	status.textContent = "Importing...";
	try {
		const { ids } = await api("api/admin/pgn", { method: "POST", body: { pgn: $("import-text").value, action: "import" } });
		status.textContent = `Imported ${ids.length} game(s) as drafts.`;
		$("import-text").value = "";
		load();
	} catch (err) {
		status.className = "small error";
		status.textContent = err.message;
	}
});

$("logout").addEventListener("click", async () => {
	await api("api/admin/logout", { method: "POST" }).catch(() => {});
	load();
});

loadSite();
load();
