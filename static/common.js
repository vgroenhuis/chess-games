// Shared helpers for the pages. All URLs are relative, so the app works at the
// site root and under a prefix such as /chess/.

export class ApiError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

export async function api(path, { method = "GET", body } = {}) {
	const init = { method, credentials: "same-origin", headers: {} };
	if (body !== undefined) {
		init.headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const response = await fetch(path, init);
	let data = null;
	try {
		data = await response.json();
	} catch {
		// not JSON
	}
	if (!response.ok) {
		const detail = data && data.detail;
		const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : `Request failed (${response.status})`;
		throw new ApiError(message, response.status);
	}
	return data;
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

// The site's home page (if this deployment has one) and whether we're admin.
export async function loadSite() {
	try {
		const site = await api("api/site");
		const link = $("home-link");
		if (link && site.home) {
			link.href = site.home.url;
			link.textContent = `← ${site.home.title}`;
			link.hidden = false;
		}
		return site;
	} catch {
		return { home: null, admin: false };
	}
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

export function fmtDate(pgnDate) {
	if (!pgnDate) return "";
	const [y, m, d] = pgnDate.split(".");
	if (!y || /^\?+$/.test(y)) return "";
	if (!m || /\?/.test(m)) return y;
	if (!d || /\?/.test(d)) return `${y}-${m}`;
	return `${y}-${m}-${d}`;
}
