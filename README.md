# Vincent's chess games

A small website for my own chess games: visitors replay them move by move,
with comments and variations, and can try their own moves on the board; I
enter and annotate the games in an admin mode. Live at
<https://vgroenhuis.github.io/chess-games/>.

It's a static site on GitHub Pages: no server. The games are PGN files in
this repository, and the admin editor saves them here through GitHub's API.

## What it does

- **Game list**: all published games with date, players, clubs, result,
  competition (linked to its web page if given) and round; a search box
  filters on any of them. Everything downloads as one PGN file.
- **Game viewer**: board plus move list, with variations (indented) and
  comments. Navigate with the buttons, by clicking moves, or with the
  keyboard (← → previous/next, Home/End, ↑ ↓ switch between alternatives,
  f flips the board). Visitors can move the pieces to try their own ideas
  from any position: those moves show in orange and are never saved.
  Each game downloads as PGN, or opens in Chess.com's analysis board.
- **Free board**: play both sides from the start, or from any position
  with `game.html?fen=<FEN>`.
- **Admin** (the **Admin** link at the bottom of the list):
  - new games, or **Import PGN** (one or many games, e.g. exported from
    Chess.com or Lichess; they arrive as drafts);
  - game details: players, clubs, ratings, competition and its web page,
    round, date, place, result, and published or draft;
  - moves are entered on the board; a move where the game already
    continues differently becomes a variation;
  - per move: a comment, a move mark (!, ?, !!, ??, !?, ?!) and a position
    mark (=, ∞, +=, =+, ±, ∓, +−, −+); **Promote variation**, **Make main
    line**, **Delete from here**.

## How it works

- `games/<number>.pgn`: one game per file; the number is the game's id
  (`game.html?id=<number>`). `[Draft "1"]` keeps a game off the public
  pages (but the repository is public, so it's readable here).
- `build.py` (python-chess, via `pgnlib.py`) checks every game and builds
  the site in `_site/`: the pages from `static/` plus `data/` (the game
  list, each game as a move tree and as PGN, and all games in one PGN).
  An illegal move fails the build, and the previous site stays online.
- `.github/workflows/pages.yml` runs the build on every push to `main`
  and publishes `_site/` to GitHub Pages, about a minute after a save.
- `static/`: plain HTML and JavaScript modules, no build step for the
  code. `board.js` is the board (click or drag, mouse or touch), `tree.js`
  the game tree, `pgn.js` reads and writes PGN for the editor,
  `github.js` saves through the GitHub API, `game.js` is the viewer and
  editor, `config.js` names the repository and the home link.
- Admin login: a fine-grained personal access token with **Contents: read
  and write** on this repository only, kept in the admin's browser
  (localStorage); the login page explains how to make one.
- Moves in the browser: [chess.js](https://github.com/jhlywa/chess.js)
  1.4.0 (BSD-2-Clause), in `static/vendor/`. Pieces: the "cburnett" set by
  Colin M.L. Burnett (CC BY-SA 3.0), via
  [Lichess](https://github.com/lichess-org/lila), in `static/pieces/`.

## Locally

```bash
pip install -r requirements.txt     # python-chess
python build.py
python -m http.server -d _site      # http://localhost:8000/
```

The admin mode works locally too; it saves to GitHub just the same.

## Author

Vincent Groenhuis

## AI disclaimer

Claude Code was used to write this site.
