"""SQLite storage: one row per game, holding its full PGN plus copies of the
fields the game list shows and searches."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pgn        TEXT NOT NULL,
    white      TEXT NOT NULL DEFAULT '',
    black      TEXT NOT NULL DEFAULT '',
    white_club TEXT NOT NULL DEFAULT '',
    black_club TEXT NOT NULL DEFAULT '',
    event      TEXT NOT NULL DEFAULT '',
    round      TEXT NOT NULL DEFAULT '',
    date       TEXT NOT NULL DEFAULT '',
    result     TEXT NOT NULL DEFAULT '*',
    plies      INTEGER NOT NULL DEFAULT 0,
    published  INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
"""

# Listing fields, from PGN headers.
_COLUMNS = {
    "white": "White", "black": "Black", "white_club": "WhiteTeam", "black_club": "BlackTeam",
    "event": "Event", "event_url": "EventURL", "round": "Round", "date": "Date", "result": "Result",
}


def _clean(value: str | None) -> str:
    """PGN's "unknown" placeholders ("?", "????.??.??") as empty."""
    value = (value or "").strip()
    return "" if set(value) <= set("?.") else value


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            columns = {row[1] for row in self._conn.execute("PRAGMA table_info(games)")}
            if "event_url" not in columns:  # added after the first release
                self._conn.execute("ALTER TABLE games ADD COLUMN event_url TEXT NOT NULL DEFAULT ''")

    def _query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def _execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    @staticmethod
    def _fields(headers: dict, plies: int) -> dict:
        fields = {col: _clean(headers.get(tag)) for col, tag in _COLUMNS.items()}
        fields["result"] = fields["result"] or "*"
        fields["plies"] = plies
        return fields

    def list_games(self, include_drafts: bool) -> list[dict]:
        where = "" if include_drafts else "WHERE published = 1"
        rows = self._query(
            f"SELECT id, white, black, white_club, black_club, event, event_url, round, date, result, plies, published, "
            f"updated_at FROM games {where} ORDER BY date DESC, id DESC"
        )
        return [dict(row) for row in rows]

    def get(self, game_id: int) -> dict | None:
        rows = self._query("SELECT * FROM games WHERE id = ?", (game_id,))
        return dict(rows[0]) if rows else None

    def all_pgn(self, include_drafts: bool) -> list[str]:
        where = "" if include_drafts else "WHERE published = 1"
        return [row["pgn"] for row in self._query(f"SELECT pgn FROM games {where} ORDER BY date, id")]

    def create(self, pgn: str, headers: dict, plies: int, published: bool) -> int:
        now = time.time()
        fields = self._fields(headers, plies)
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        cursor = self._execute(
            f"INSERT INTO games (pgn, {cols}, published, created_at, updated_at) VALUES (?, {marks}, ?, ?, ?)",
            (pgn, *fields.values(), int(published), now, now),
        )
        return int(cursor.lastrowid)

    def update(self, game_id: int, pgn: str, headers: dict, plies: int, published: bool) -> bool:
        fields = self._fields(headers, plies)
        sets = ", ".join(f"{col} = ?" for col in fields)
        cursor = self._execute(
            f"UPDATE games SET pgn = ?, {sets}, published = ?, updated_at = ? WHERE id = ?",
            (pgn, *fields.values(), int(published), time.time(), game_id),
        )
        return cursor.rowcount > 0

    def delete(self, game_id: int) -> bool:
        return self._execute("DELETE FROM games WHERE id = ?", (game_id,)).rowcount > 0
