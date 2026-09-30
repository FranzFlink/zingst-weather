#!/usr/bin/env bash
# Cron entrypoint: rebuild the dashboard JSON (and optionally publish via git).
# Safe by design: runs entirely as your user, touches only this project folder.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p logs
# keep the log from growing forever
if [ -f logs/update.log ] && [ "$(stat -c%s logs/update.log)" -gt 1000000 ]; then
  tail -n 200 logs/update.log > logs/update.log.tmp && mv logs/update.log.tmp logs/update.log
fi

# never run twice at once
exec 9>".update.lock"
flock -n 9 || exit 0

{
  echo "--- $(date -Is)"
  python3 pipeline/build_data.py
} >> logs/update.log 2>&1

# --- publish to GitHub Pages ---
{
  git add docs/data
  git commit -m "data update" --quiet || exit 0   # nothing changed -> done
  if ! git push --quiet origin main; then
    # Rejected: main moved on GitHub (web edit, merged PR). Integrate, retry once.
    # Rebase needs a clean tree; with local edits fall back to a merge, which
    # aborts without touching anything if those edits overlap the incoming change.
    if git diff --quiet && git diff --cached --quiet; then
      git pull --rebase --quiet origin main || { git rebase --abort; exit 1; }
    else
      git pull --no-rebase --no-edit --quiet origin main || { git merge --abort 2>/dev/null || true; exit 1; }
    fi
    git push --quiet origin main
  fi
} >> logs/update.log 2>&1
