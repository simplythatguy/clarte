"""Verify copied, adapted, and authored v1 files against their recorded hashes."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'COPY_PROVENANCE.json').read_text(encoding='utf-8'))
records = [(item['destination'], manifest['adapted_sha256'].get(
    item['destination'], item['snapshot_sha256'])) for item in manifest['copies']]
records += [(item['path'], item['sha256']) for item in manifest['authored_files']]
errors = []
for name, expected in records:
    path = root / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        errors.append(name)
if errors:
    raise SystemExit('Missing or changed snapshot files: ' + ', '.join(errors))
print(f'Verified {len(records)} copied, adapted, and authored v1 files.')
