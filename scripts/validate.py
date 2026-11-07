#!/usr/bin/env python3
"""Validate the bundled development skills and exact upstream copies."""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
lock = json.loads((ROOT / 'sources.lock.json').read_text())
for record in lock['copied_files']:
    path = ROOT / record['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        errors.append(f"Missing or changed upstream copy: {record['path']}")

upstream_skills = {
    Path(record['path']).parent: record['repository']
    for record in lock['copied_files']
    if Path(record['path']).match('skills/*/SKILL.md')
}
required = set(upstream_skills) | {Path(path) for path in lock['authored_skills']}
skills = sorted(path for path in (ROOT / 'skills').iterdir() if path.is_dir())
if {path.relative_to(ROOT) for path in skills} != required:
    errors.append('Skill catalog does not match the source manifest')
for skill in skills:
    entry = skill / 'SKILL.md'
    if not entry.is_file():
        errors.append(f'Missing entrypoint: {skill.name}')
        continue
    content = entry.read_text()
    parts = content.split('---', 2)
    if len(parts) != 3 or not re.search(r'^name:\s*' + re.escape(skill.name) + r'\s*$', parts[1], re.M) or not re.search(r'^description:\s*\S', parts[1], re.M):
        errors.append(f'Invalid skill metadata: {skill.name}')
    if not (skill / 'LICENSE.txt').is_file():
        errors.append(f'Missing distributed license: {skill.name}')
    # Upstream skeletons identify mandatory lazy-loaded section files.
    for section in set(re.findall(r'sections/([a-z0-9-]+\.md)', content)):
        if not (skill / 'sections' / section).is_file():
            errors.append(f'Missing section: {skill.name}/{section}')

# Resolve Markdown file links, excluding remote URLs and fragment-only links.
# Runtime-relative upstream links require the external runtime documented in the manifest.
local_docs = [ROOT / 'README.md', ROOT / 'AGENTS.md', * (ROOT / 'docs').rglob('*.md')]
for skill in skills:
    source = upstream_skills.get(skill.relative_to(ROOT))
    if source and lock['repositories'][source].get('runtime_relative_links', False):
        continue
    local_docs.extend(skill.glob('*.md'))
for path in local_docs:
    for target in re.findall(r'\]\(([^\s)]+)\)', path.read_text()):
        if '://' in target or target.startswith(('#', 'mailto:')):
            continue
        dest = target.split('#', 1)[0]
        if dest and not (path.parent / dest).exists():
            errors.append(f'Broken link in {path.relative_to(ROOT)}: {target}')

for name in lock['repositories']:
    repo = lock['repositories'][name]
    if not re.fullmatch(r'[0-9a-f]{40}', repo['commit']):
        errors.append(f'Invalid source revision: {name}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f"Validated {len(skills)} skills and {len(lock['copied_files'])} exact upstream files; sections, licenses and local links present.")
