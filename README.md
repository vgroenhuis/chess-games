# Vincent's chess games

A small website for my own chess games: visitors replay them move by move,
with comments and variations, and can try their own moves on the board; I
enter and annotate the games through an admin mode. Live at
<https://closer.ram.eemcs.utwente.nl/chess/>.

## What it does

- **Game list**: all published games with date, players, clubs, result,
  competition and round; a search box filters on any of them. Everything
  can be downloaded as one PGN file.
- **Game viewer**: board plus move list, with variations (indented) and
  comments. Navigate with the buttons, by clicking moves, or with the
  keyboard (← → previous/next, Home/End, ↑ ↓ switch between alternatives,
  f flips the board). Visitors can move the pieces to try their own ideas
  from any position: those moves show in orange and are never saved
  (**Clear my moves** removes them). Each game downloads as PGN.
- **Free board**: play both sides from the start, or from any position
  with `game.html?fen=<FEN>`.
- **Admin** (log in via the **Admin** link at the bottom of the list):
  - new games, or **Import PGN** (one or many games, e.g. exported from
    Chess.com or Lichess; they arrive as drafts);
  - game details: players, clubs, ratings, competition, round, date,
    place, result, and published or draft;
  - moves are entered on the board; a move where the game already
    continues differently becomes a variation;
  - per move: a comment, a move mark (!, ?, !!, ??, !?, ?!) and a position
    mark (=, ∞, +=, =+, ±, ∓, +−, −+); **Promote variation**, **Make main
    line**, **Delete from here**;
  - drafts are only visible to the admin.

## Running it

Requires Linux or macOS with [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env      # set CHESS_ADMIN_PASSWORD
./run.sh                  # http://127.0.0.1:8200/
```

As a service behind Apache (as on closer.ram.eemcs.utwente.nl): set
`CHESS_BASE_PATH=/chess/` and `CHESS_TRUST_PROXY_HEADERS=true` in `.env`,
run `sudo bash deploy/setup.sh` once, and proxy `/chess/` to
`http://127.0.0.1:8200/`.

## How it works

- `app/`: FastAPI. Games are stored as PGN in SQLite (`data/games.db`,
  not in git; back it up, or use **Download all**). The pages exchange
  games as a JSON move tree; [python-chess](https://python-chess.readthedocs.io)
  turns that into PGN and back, and checks every move when a game is saved.
- `static/`: plain HTML and JavaScript modules, no build step.
  `board.js` is the board (click or drag, mouse or touch), `tree.js` the
  game tree, `game.js` the viewer and editor.
- Moves in the browser: [chess.js](https://github.com/jhlywa/chess.js)
  1.4.0 (BSD-2-Clause), in `static/vendor/`.
- Pieces: the "cburnett" set by Colin M.L. Burnett (CC BY-SA 3.0), via
  [Lichess](https://github.com/lichess-org/lila), in `static/pieces/`.

## Author

Vincent Groenhuis

## AI disclaimer

Claude Code was used to write this site.
