#!/bin/bash
# Root-only, once: installs the service, and lets groenhuis restart it without
# a password (for the auto-deploy). Run: sudo bash ~/chess-games/deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../.env ] || { echo "Create ../.env first (cp .env.example .env, set CHESS_ADMIN_PASSWORD)."; exit 1; }
install -m 644 chess-games.service /etc/systemd/system/chess-games.service
systemctl daemon-reload
systemctl enable --now chess-games.service
rule='groenhuis ALL=(root) NOPASSWD: /usr/bin/systemctl restart chess-games'
tmp=$(mktemp)
echo "$rule" > "$tmp"
visudo -cf "$tmp" >/dev/null && install -m 440 "$tmp" /etc/sudoers.d/chess-games
rm -f "$tmp"
echo "Done: systemctl status chess-games"
