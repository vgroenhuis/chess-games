"""Vincent's chess games: a FastAPI app serving the game list, a viewer with
variations and comments, a free board, and an admin editor.

Visitors can only read: list, view and download games, and play moves on the
board in their own browser (never saved). Writing needs the admin session.

Run: see run.sh (settings in .env, see .env.example).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import pgn
from .store import Store

log = logging.getLogger("chess")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
DATA_DIR = Path(os.environ.get("CHESS_DATA_DIR", ROOT / "data"))
ADMIN_PASSWORD = os.environ.get("CHESS_ADMIN_PASSWORD", "")
if ADMIN_PASSWORD == "change-me":  # the .env.example placeholder: keep admin login off
    ADMIN_PASSWORD = ""
SESSION_HOURS = float(os.environ.get("CHESS_SESSION_HOURS", "720"))


def _base_path(value: str) -> str:
    return "/" + value.strip("/") + "/" if value.strip("/") else "/"


# URL path the app is served under ("/" or e.g. "/chess/"), for the cookie path.
BASE_PATH = _base_path(os.environ.get("CHESS_BASE_PATH", "/"))
TRUST_PROXY_HEADERS = os.environ.get("CHESS_TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes", "on")
HOME_URL = os.environ.get("CHESS_HOME_URL", "")
HOME_TITLE = os.environ.get("CHESS_HOME_TITLE", "")
ADMIN_COOKIE = "chess_admin"

app = FastAPI(title="Vincent's chess games", docs_url=None, redoc_url=None)
store = Store(DATA_DIR / "games.db")


def _secret() -> bytes:
    key_file = DATA_DIR / "secret.key"
    if not key_file.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        key_file.write_text(secrets.token_hex(32))
        key_file.chmod(0o600)
    return key_file.read_text().strip().encode()


SECRET = _secret()


# -- helpers -----------------------------------------------------------------


def api_error(status: int, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail=message)


def client_addr(request: Request) -> str:
    if TRUST_PROXY_HEADERS and request.headers.get("x-forwarded-for"):
        return request.headers["x-forwarded-for"].split(",")[0].strip()
    return request.client.host if request.client else ""


def is_secure(request: Request) -> bool:
    if TRUST_PROXY_HEADERS and request.headers.get("x-forwarded-proto"):
        return request.headers["x-forwarded-proto"] == "https"
    return request.url.scheme == "https"


def sign_session(hours: float) -> str:
    expiry = str(int(time.time() + hours * 3600))
    return f"{expiry}.{hmac.new(SECRET, f'admin:{expiry}'.encode(), hashlib.sha256).hexdigest()}"


def is_admin(request: Request) -> bool:
    value = request.cookies.get(ADMIN_COOKIE) or ""
    if not ADMIN_PASSWORD or "." not in value:
        return False
    expiry, signature = value.split(".", 1)
    expected = hmac.new(SECRET, f"admin:{expiry}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected) and expiry.isdigit() and int(expiry) > time.time()


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise api_error(401, "Log in as admin first.")


class RateLimiter:
    def __init__(self, max_events: int, window: float) -> None:
        self.max, self.window = max_events, window
        self.events: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.events[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max:
            return False
        q.append(now)
        return True


login_limiter = RateLimiter(5, 300)


def game_json(row: dict, admin: bool) -> dict:
    game = pgn.parse_pgn(row["pgn"])[0]
    return {
        "id": row["id"],
        "headers": pgn.headers_of(game),
        "tree": pgn.tree_from_game(game),
        "published": bool(row["published"]),
        "updatedAt": row["updated_at"],
        "admin": admin,
    }


def get_visible(game_id: int, request: Request) -> dict:
    row = store.get(game_id)
    if row is None or (not row["published"] and not is_admin(request)):
        raise api_error(404, "No such game.")
    return row


_DATE_DASHES = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def clean_headers(headers: dict) -> dict:
    out = {}
    for key, value in headers.items():
        key = str(key).strip()
        if not re.fullmatch(r"[A-Za-z0-9_]{1,40}", key):
            raise api_error(400, f"Invalid header name {key!r}.")
        value = str(value if value is not None else "").strip().replace('"', "'")
        if len(value) > 200:
            raise api_error(400, f"{key} is too long.")
        out[key] = value
    if out.get("Date") and _DATE_DASHES.match(out["Date"]):
        out["Date"] = out["Date"].replace("-", ".")
    if out.get("Result", "*") not in pgn.RESULTS and out.get("Result"):
        raise api_error(400, "Result must be 1-0, 0-1, 1/2-1/2 or *.")
    return out


def filename_for(headers: dict) -> str:
    parts = [headers.get("Date", ""), headers.get("White", ""), headers.get("Black", "")]
    stem = "_".join(re.sub(r"[^A-Za-z0-9.]+", "-", p).strip("-.") for p in parts if p and set(p) - set("?."))
    return (stem or "game") + ".pgn"


# -- pages and public API ----------------------------------------------------


@app.get("/api/site")
def site(request: Request) -> dict:
    """The site's home page (set by the reverse proxy, or CHESS_HOME_URL), for the back link."""
    url = request.headers.get("x-site-home-url") or HOME_URL
    title = request.headers.get("x-site-home-title") or HOME_TITLE or "Home"
    ok = re.fullmatch(r"(/|https?://)[^\s\"'<>]*", url)
    return {"home": {"url": url, "title": title[:80]} if ok else None, "admin": is_admin(request)}


@app.get("/api/games")
def list_games(request: Request) -> dict:
    admin = is_admin(request)
    return {"games": store.list_games(include_drafts=admin), "admin": admin}


@app.get("/api/games/{game_id}")
def get_game(game_id: int, request: Request) -> dict:
    return game_json(get_visible(game_id, request), is_admin(request))


@app.get("/api/games/{game_id}/pgn")
def get_game_pgn(game_id: int, request: Request) -> Response:
    row = get_visible(game_id, request)
    headers = pgn.headers_of(pgn.parse_pgn(row["pgn"])[0])
    return PlainTextResponse(
        row["pgn"], media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="{filename_for(headers)}"'},
    )


@app.get("/api/all-games.pgn")
def all_games_pgn(request: Request) -> Response:
    text = "\n".join(store.all_pgn(include_drafts=is_admin(request)))
    return PlainTextResponse(
        text, media_type="application/x-chess-pgn",
        headers={"Content-Disposition": 'attachment; filename="vincent-chess-games.pgn"'},
    )


# -- admin -------------------------------------------------------------------


class LoginRequest(BaseModel):
    password: str = Field(max_length=200)


@app.post("/api/admin/login")
def login(body: LoginRequest, request: Request) -> JSONResponse:
    if not ADMIN_PASSWORD:
        raise api_error(503, "Admin login is disabled: set CHESS_ADMIN_PASSWORD.")
    addr = client_addr(request)
    if not login_limiter.allow(addr):
        raise api_error(429, "Too many attempts. Wait a few minutes.")
    if not hmac.compare_digest(ADMIN_PASSWORD.encode(), body.password.encode()):
        log.info("Failed admin login from %s", addr)
        raise api_error(401, "Wrong password.")
    log.info("Admin login from %s", addr)
    response = JSONResponse({"ok": True})
    response.set_cookie(
        ADMIN_COOKIE, sign_session(SESSION_HOURS), max_age=int(SESSION_HOURS * 3600),
        httponly=True, samesite="strict", secure=is_secure(request), path=BASE_PATH,
    )
    return response


@app.post("/api/admin/logout")
def logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE, path=BASE_PATH)
    return response


class GameBody(BaseModel):
    headers: dict[str, Optional[str]] = Field(default_factory=dict)
    tree: dict
    published: bool = False


def build(body: GameBody):
    headers = clean_headers(body.headers)
    try:
        game = pgn.game_from_tree(body.tree, headers)
    except pgn.GameError as exc:
        raise api_error(400, str(exc)) from None
    return game, pgn.export_pgn(game)


@app.post("/api/admin/games", dependencies=[Depends(require_admin)])
def create_game(body: GameBody) -> dict:
    game, text = build(body)
    game_id = store.create(text, pgn.headers_of(game), pgn.mainline_plies(game), body.published)
    log.info("Created game %s", game_id)
    return {"id": game_id}


@app.put("/api/admin/games/{game_id}", dependencies=[Depends(require_admin)])
def update_game(game_id: int, body: GameBody) -> dict:
    game, text = build(body)
    if not store.update(game_id, text, pgn.headers_of(game), pgn.mainline_plies(game), body.published):
        raise api_error(404, "No such game.")
    log.info("Saved game %s", game_id)
    return {"id": game_id}


@app.delete("/api/admin/games/{game_id}", dependencies=[Depends(require_admin)])
def delete_game(game_id: int) -> dict:
    if not store.delete(game_id):
        raise api_error(404, "No such game.")
    log.info("Deleted game %s", game_id)
    return {"ok": True}


class PgnBody(BaseModel):
    pgn: str = Field(max_length=2_000_000)
    action: Literal["parse", "import"] = "parse"


@app.post("/api/admin/pgn", dependencies=[Depends(require_admin)])
def import_pgn(body: PgnBody) -> dict:
    """parse: the games as {headers, tree}, e.g. to load one into the editor.
    import: store every game in the text as a draft."""
    try:
        games = pgn.parse_pgn(body.pgn)
    except pgn.GameError as exc:
        raise api_error(400, str(exc)) from None
    if body.action == "parse":
        return {"games": [{"headers": pgn.headers_of(g), "tree": pgn.tree_from_game(g)} for g in games]}
    ids = [store.create(pgn.export_pgn(g), pgn.headers_of(g), pgn.mainline_plies(g), False) for g in games]
    log.info("Imported %d game(s) as drafts", len(ids))
    return {"ids": ids}


@app.middleware("http")
async def revalidate(request: Request, call_next):
    # Pages and scripts revalidate (cheaply) so updates show up right away.
    response = await call_next(request)
    if request.method == "GET" and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
