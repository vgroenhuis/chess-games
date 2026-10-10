// The admin editor saves games straight to the GitHub repository, through
// GitHub's REST API, with a fine-grained personal access token that only the
// admin has. The token stays in this browser (localStorage); the site itself
// has no server. Each save is a commit, which rebuilds the public site.

import { GITHUB } from "./config.js";

const TOKEN_KEY = "chess_github_token";
const API = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}`;

export function getToken() {
	try {
		return localStorage.getItem(TOKEN_KEY) || "";
	} catch {
		return "";
	}
}

export function setToken(token) {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		// private window etc.: admin mode needs storage
	}
}

export const isAdmin = () => !!getToken();

async function gh(path, { method = "GET", body } = {}) {
	const response = await fetch(`${API}${path}`, {
		method,
		cache: "no-store",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${getToken()}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = response.status === 204 ? null : await response.json().catch(() => null);
	if (!response.ok) {
		const message = response.status === 401 ? "GitHub doesn't accept the token (expired or mistyped?). Log in again." : (data && data.message) || `GitHub error ${response.status}`;
		const err = new Error(message);
		err.status = response.status;
		throw err;
	}
	return data;
}

function utf8ToBase64(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	// In chunks: spreading a large array into one call overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}
const base64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

// Checks the token: it must be allowed to write to the repository.
export async function checkToken() {
	const repo = await gh("");
	if (!repo.permissions || !repo.permissions.push) throw new Error("This token can't write to the repository: give it Contents read and write access.");
	return repo;
}

// { text, sha } of games/<id>.pgn, or null if it doesn't exist.
export async function readGame(id) {
	try {
		const file = await gh(`/contents/${GITHUB.gamesDir}/${id}.pgn?ref=${GITHUB.branch}`);
		return { text: base64ToUtf8(file.content), sha: file.sha };
	} catch (err) {
		if (err.status === 404) return null;
		throw err;
	}
}

// The ids of all games in the repository (drafts included).
export async function gameIds() {
	try {
		const files = await gh(`/contents/${GITHUB.gamesDir}?ref=${GITHUB.branch}`);
		return files.map((f) => f.name.match(/^(\d+)\.pgn$/)).filter(Boolean).map((m) => Number(m[1]));
	} catch (err) {
		if (err.status === 404) return []; // no games folder yet
		throw err;
	}
}

// Creates or updates games/<id>.pgn; returns the new sha.
export async function writeGame(id, text, sha, message) {
	const result = await gh(`/contents/${GITHUB.gamesDir}/${id}.pgn`, {
		method: "PUT",
		body: { message, content: utf8ToBase64(text), branch: GITHUB.branch, ...(sha ? { sha } : {}) },
	});
	return result.content.sha;
}

export async function deleteGame(id, sha, message) {
	await gh(`/contents/${GITHUB.gamesDir}/${id}.pgn`, { method: "DELETE", body: { message, sha, branch: GITHUB.branch } });
}
