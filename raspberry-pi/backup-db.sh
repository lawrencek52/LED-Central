#!/bin/bash
# Snapshot LED-Central's SQLite database (controllers, canvases, playback,
# settings). The database is not in git, so this is what you need to bring
# a replacement Pi back to the same state.
#
#   raspberry-pi/backup-db.sh [dest-dir]     default dest: ~/led-central-backups
#
# Safe while LED-Central is running: it uses SQLite's online backup, which
# also folds in the -wal file. Keeps the newest KEEP snapshots.
# Copies on the Pi don't survive the SD card dying; copy them off regularly, e.g.
#   scp 'deck:led-central-backups/*' ~/led-central-backups/
set -e
here=$(dirname "$(readlink -f "$0")")
backend="$here/../backend"
dest=${1:-$HOME/led-central-backups}
KEEP=${KEEP:-14}

db=$(grep -s '^EFFECT_DATABASE_PATH=' "$backend/.env" | cut -d= -f2-)
db=${db:-./data/led-central.db}
case $db in /*) ;; *) db="$backend/$db" ;; esac
if [ ! -f "$db" ]; then
    echo "database not found: $db" >&2
    exit 1
fi

mkdir -p "$dest"
out="$dest/led-central-$(date +%F-%H%M).db"
python3 - "$db" "$out" <<'EOF'
import sqlite3, sys
src = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close(); src.close()
EOF
echo "backed up $db -> $out"

# keep the newest KEEP snapshots
ls -1t "$dest"/led-central-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
