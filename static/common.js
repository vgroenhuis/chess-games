// Shared helpers for the pages. All URLs are relative, so the site works at a
// domain's root and under a path such as /chess-games/.

import { HOME } from "./config.js";
import { isAdmin } from "./github.js";

export class ApiError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

// A file the build made (data/...), as JSON or text.
export async function fetchData(path, { text = false } = {}) {
	const response = await fetch(path, { cache: "no-cache" });
	if (!response.ok) throw new ApiError(response.status === 404 ? "Not found." : `Couldn't load ${path} (${response.status}).`, response.status);
	return text ? response.text() : response.json();
}

// el("div", { class: "x", onclick: fn }, child, "text", [more])
export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
		else if (key === "class") node.className = value;
		else if (key === "dataset") Object.assign(node.dataset, value);
		else node.setAttribute(key, value === true ? "" : value);
	}
	for (const child of children.flat(Infinity)) {
		if (child === null || child === undefined || child === false) continue;
		node.append(child instanceof Node ? child : String(child));
	}
	return node;
}

export const $ = (id) => document.getElementById(id);

// The "back" link to the site's home page, and whether this browser is the admin's.
export function loadSite() {
	const link = $("home-link");
	if (link && HOME.url) {
		link.href = HOME.url;
		link.textContent = `← ${HOME.title}`;
		link.hidden = false;
	}
	return { admin: isAdmin() };
}

// "Groenhuis, Vincent" -> "Vincent Groenhuis" for display; PGN keeps "Last, First".
export function displayName(name) {
	if (!name) return "?";
	const parts = name.split(",").map((s) => s.trim());
	return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : name;
}

// The competition's name, linked to its web page (PGN tag EventURL) when it has one.
export function eventLink(name, url) {
	if (!url || !/^https?:\/\//.test(url)) return name;
	return el("a", { href: url, target: "_blank", rel: "noopener", title: "Competition page (new tab)", onclick: (e) => e.stopPropagation() }, name);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// PGN "2026.10.09" -> "Oct 9, 2026" (or "Oct 2026" / "2026" when partly unknown).
export function fmtDate(pgnDate) {
	if (!pgnDate) return "";
	const [y, m, d] = pgnDate.split(".");
	if (!y || !/^\d{4}$/.test(y)) return "";
	const month = MONTHS[Number(m) - 1];
	if (!month) return y;
	if (!d || !/^\d+$/.test(d)) return `${month} ${y}`;
	return `${month} ${Number(d)}, ${y}`;
}

// PGN "2026.10.09" -> "09-10-2026" for the editor ("" when unknown).
export function pgnDateToInput(pgnDate) {
	const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(pgnDate || "");
	return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// The editor's "dd-mm-yyyy" (also d-m-yyyy, with / or .) -> PGN "yyyy.mm.dd";
// "" for an empty field, null if it isn't a valid date.
export function inputDateToPgn(text) {
	const value = text.trim();
	if (!value) return "";
	const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
	if (!m) return null;
	const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // e.g. 31-02
	return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}
