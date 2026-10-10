"""Builds the static site in _site/ from static/ and the games in games/.

Each game is one PGN file, games/<number>.pgn; the number is its id in the
site's URLs (game.html?id=<number>). A game with the tag [Draft "1"] is left
out of the public list and downloads (the admin editor still opens it).

Every game is read with python-chess, so an illegal move or broken PGN fails
the build and the previous version of the site stays online.

Usage: python build.py   (then e.g. python -m http.server -d _site)
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import pgnlib

ROOT = Path(__file__).resolve().parent
GAMES = ROOT / "games"
OUT = ROOT / "_site"

# Copied from the PGN headers into the game list.
LIST_FIELDS = {
    "white": "White", "black": "Black", "white_club": "WhiteTeam", "black_club": "BlackTeam",
    "event": "Event", "event_url": "EventURL", "round": "Round", "date": "Date", "result": "Result",
}


def clean(value: str | None) -> str:
    """PGN's "unknown" placeholders ("?", "????.??.??") as empty."""
    value = (value or "").strip()
    return "" if set(value) <= set("?.") else value


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "static", OUT)
    (OUT / "data" / "games").mkdir(parents=True)

    entries, public_pgn, errors = [], [], []
    files = sorted(GAMES.glob("*.pgn"), key=lambda p: int(p.stem) if p.stem.isdigit() else 0)
    for path in files:
        if not re.fullmatch(r"[1-9][0-9]*", path.stem):
            errors.append(f"{path.name}: game files must be named <number>.pgn")
            continue
        try:
            games = pgnlib.parse_pgn(path.read_text(encoding="utf-8"))
        except (pgnlib.GameError, UnicodeDecodeError) as exc:
            errors.append(f"{path.name}: {exc}")
            continue
        if len(games) != 1:
            errors.append(f"{path.name}: holds {len(games)} games; one per file")
            continue
        game = games[0]
        game_id = int(path.stem)
        headers = pgnlib.headers_of(game)
        draft = headers.pop("Draft", "") in ("1", "true", "yes")
        if "Draft" in game.headers:
            del game.headers["Draft"]
        entry = {col: clean(headers.get(tag)) for col, tag in LIST_FIELDS.items()}
        entry.update(id=game_id, result=entry["result"] or "*", plies=pgnlib.mainline_plies(game), published=not draft)
        entries.append(entry)
        if draft:
            continue  # not on the public site (the editor reads drafts from GitHub)
        text = pgnlib.export_pgn(game)
        public_pgn.append(text)
        (OUT / "data" / "games" / f"{game_id}.json").write_text(
            json.dumps({"id": game_id, "headers": headers, "tree": pgnlib.tree_from_game(game), "published": True}),
            encoding="utf-8",
        )
        (OUT / "data" / "games" / f"{game_id}.pgn").write_text(text, encoding="utf-8")

    if errors:
        print("Build failed:", *errors, sep="\n  ", file=sys.stderr)
        return 1
    entries.sort(key=lambda e: (e["date"], e["id"]), reverse=True)
    (OUT / "data" / "index.json").write_text(json.dumps({"games": entries}), encoding="utf-8")
    (OUT / "data" / "all-games.pgn").write_text("\n".join(public_pgn), encoding="utf-8")
    print(f"Built _site/ with {len(public_pgn)} published game(s), {len(entries) - len(public_pgn)} draft(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
