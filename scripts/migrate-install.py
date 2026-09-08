"""Back up and migrate an old installation before deploying the new runtime.

Close Obsidian, then run: python3 scripts/migrate-install.py /path/to/vault
"""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def migrate(vault):
    config = vault / '.obsidian'
    old = config / 'plugins/note-lock'
    new = config / 'plugins/page-lock'
    if not old.exists():
        return
    if new.exists():
        raise RuntimeError('Both installations exist; resolve before migrating.')
    updates = {}
    for name in ('community-plugins.json', 'hotkeys.json'):
        file = config / name
        if not file.exists():
            continue
        original = file.read_bytes()
        data = json.loads(original)
        if name == 'community-plugins.json':
            data = list(dict.fromkeys('page-lock' if x == 'note-lock' else x for x in data))
        else:
            for key in list(data):
                if key.startswith('note-lock:'):
                    target = 'page-lock:' + key.split(':', 1)[1]
                    if target in data and data[target] != data[key]:
                        raise RuntimeError('Conflicting command hotkeys.')
                    data[target] = data.pop(key)
        updates[file] = (original, json.dumps(data, indent=2) + '\n')
    backup = config / 'plugin-migration-backups' / ('note-lock-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True)
    shutil.copytree(old, backup / old.name)
    for file in updates:
        shutil.copy2(file, backup / file.name)
    old.rename(new)
    try:
        for file, (_, content) in updates.items():
            file.write_text(content)
    except Exception:
        for file, (original, _) in updates.items():
            file.write_bytes(original)
        new.rename(old)
        raise
    print('Migrated installation; backup:', backup)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: migrate-install.py /path/to/vault')
    migrate(Path(sys.argv[1]).expanduser().resolve())
