"""Games as PGN (stored) and as a JSON move tree (what the pages work with).

Tree format:
    {"fen": <start FEN, or null for the standard start>,
     "comment": <comment before the first move>,
     "children": [node, ...]}
    node = {"san": "e4", "comment": "...", "pre": <comment before this move,
            e.g. at the start of a variation>, "nags": [1, ...],
            "children": [node, ...]}
The first child is the main continuation; the others are variations.

python-chess does all PGN reading and writing, and every move is checked
against the position when a tree is turned back into a game.
"""

from __future__ import annotations

import io

import chess
import chess.pgn

MAX_NODES = 5000
MAX_COMMENT = 4000
RESULTS = ("1-0", "0-1", "1/2-1/2", "*")
# Headers the admin page edits; any other header in an imported PGN is kept.
FIELDS = ("Event", "Site", "Date", "Round", "White", "Black", "Result",
          "WhiteTeam", "BlackTeam", "WhiteElo", "BlackElo", "EventURL")


class GameError(ValueError):
    pass


def tree_from_game(game: chess.pgn.Game) -> dict:
    board = game.board()
    root = {
        "fen": None if board.fen() == chess.STARTING_FEN else board.fen(),
        "comment": game.comment,
        "children": [],
    }
    # Iterative walk: long games would otherwise nest deeply.
    stack = [(game, root)]
    while stack:
        pg_node, out = stack.pop()
        parent_board = pg_node.board()
        for child in pg_node.variations:
            item = {
                "san": parent_board.san(child.move),
                "comment": child.comment,
                "pre": child.starting_comment,
                "nags": sorted(child.nags),
                "children": [],
            }
            out["children"].append(item)
            stack.append((child, item))
    return root


def game_from_tree(tree: dict, headers: dict) -> chess.pgn.Game:
    game = chess.pgn.Game()
    for key, value in headers.items():
        if value is not None and str(value).strip() != "":
            game.headers[str(key)] = str(value).strip()
    fen = tree.get("fen")
    if fen:
        try:
            game.setup(chess.Board(fen))
        except ValueError as exc:
            raise GameError(f"Invalid start position: {exc}") from None
    game.comment = _comment(tree.get("comment"))

    count = 0
    stack = [(game, tree.get("children") or [], "")]
    while stack:
        pg_node, children, path = stack.pop()
        board = pg_node.board()
        for i, child in enumerate(children):
            count += 1
            if count > MAX_NODES:
                raise GameError(f"A game can have at most {MAX_NODES} moves including variations.")
            san = str(child.get("san", ""))
            where = f"{path} {san}".strip()
            try:
                move = board.parse_san(san)
            except ValueError:
                raise GameError(f"Illegal move {san!r} after: {path or 'the start'}") from None
            node = pg_node.add_variation(
                move,
                comment=_comment(child.get("comment")),
                starting_comment=_comment(child.get("pre")),
                nags=[int(n) for n in child.get("nags") or [] if 0 < int(n) < 256],
            )
            stack.append((node, child.get("children") or [], where))
    return game


def _comment(value) -> str:
    text = str(value or "").strip()
    if len(text) > MAX_COMMENT:
        raise GameError(f"Comments can be at most {MAX_COMMENT} characters.")
    # "}" would end a PGN comment early.
    return text.replace("}", ")")


def parse_pgn(text: str) -> list[chess.pgn.Game]:
    """Every game in a PGN text; errors in a game raise GameError."""
    stream = io.StringIO(text)
    games = []
    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        if game.errors:
            first = game.errors[0]
            raise GameError(f"Game {len(games) + 1} ({game.headers.get('White', '?')} - "
                            f"{game.headers.get('Black', '?')}): {first}")
        games.append(game)
    if not games:
        raise GameError("No games found in that PGN.")
    return games


def export_pgn(game: chess.pgn.Game) -> str:
    return game.accept(chess.pgn.StringExporter(headers=True, variations=True, comments=True)) + "\n"


def headers_of(game: chess.pgn.Game) -> dict:
    return dict(game.headers)


def mainline_plies(game: chess.pgn.Game) -> int:
    return sum(1 for _ in game.mainline_moves())
