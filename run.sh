#!/bin/sh
# Starts the site in the foreground (see deploy/ for the systemd unit).
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
	echo "No .env found - copying .env.example. Edit it to set the admin password!"
	cp .env.example .env
fi
if [ ! -x .venv/bin/python ]; then
	command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/"; exit 1; }
	uv venv --python 3.12 .venv
	uv pip install --python .venv/bin/python -r requirements.txt
fi
set -a; . ./.env; set +a
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "${CHESS_PORT:-8200}"
