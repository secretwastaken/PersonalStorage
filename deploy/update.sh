#!/usr/bin/env bash
#
# Update the bot on the server: pull, install, register commands, back up the
# database, restart, check it came back.
#
#   bash deploy/update.sh             # does nothing when there is nothing new
#   bash deploy/update.sh --restart   # restart even if the pull changed nothing
#
# Override the unit name with PS_SERVICE if it is not "personalstorage".

set -euo pipefail

SERVICE="${PS_SERVICE:-personalstorage}"
FORCE_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --restart) FORCE_RESTART=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1" >&2; }

[ -d .git ] || { echo "Not a git checkout: $PWD" >&2; exit 1; }
[ -f .env ] || { echo "No .env in $PWD. Copy .env.example to .env and fill in the token first." >&2; exit 1; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Tracked files have local changes; refusing to pull over them:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

step "Pulling"
OLD=$(git rev-parse HEAD)
git pull --ff-only
NEW=$(git rev-parse HEAD)
if [ "$OLD" = "$NEW" ]; then
  echo "Already up to date at ${NEW:0:7}."
  CHANGED=""
  [ "$FORCE_RESTART" -eq 1 ] || [ ! -d node_modules ] || { echo "Nothing to do. (--restart restarts anyway.)"; exit 0; }
else
  CHANGED=$(git diff --name-only "$OLD" "$NEW")
  git --no-pager log --oneline "$OLD..$NEW"
fi
touched() { printf '%s\n' "$CHANGED" | grep -qE "$1"; }

if touched '^package(-lock)?\.json$' || [ ! -d node_modules ]; then
  step "Installing dependencies"
  npm ci --omit=dev
fi

# Discord keeps the old command definitions until it is told the new ones.
if touched '^src/(commands|kinds|reminders)\.js$'; then
  step "Registering slash commands"
  npm run --silent deploy
fi

DB=data/personal-storage.db
if [ -f "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  step "Backing up the database"
  mkdir -p backups
  sqlite3 "$DB" ".backup backups/personal-storage-$(date +%F-%H%M%S).db"
  ls -1t backups/personal-storage-*.db | tail -n +6 | xargs -r rm --
fi

step "Restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 4
if ! systemctl is-active --quiet "$SERVICE"; then
  warn "$SERVICE is not running after the update. Last 30 log lines:"
  journalctl -u "$SERVICE" -n 30 --no-pager >&2
  warn "To go back: git reset --hard $OLD && npm ci --omit=dev && systemctl restart $SERVICE"
  exit 1
fi
journalctl -u "$SERVICE" -n 3 --no-pager -o cat
echo
echo "Now at $(git rev-parse --short HEAD). Live logs: journalctl -u $SERVICE -f"
