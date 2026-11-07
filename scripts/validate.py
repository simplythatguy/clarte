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

skills = list((ROOT / 'skills').iterdir())
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

required = {'office-hours', 'autoplan', 'plan-ceo-review', 'plan-design-review', 'plan-devex-review', 'plan-eng-review', 'design-html', 'frontend-design', 'better-ui', 'untangle-codebase', 'sol-loop', 'pr', 'setup-matt-pocock-skills', 'lintapple-ui'}
if {p.name for p in skills} != required:
    errors.append('Skill catalog does not match required dependency closure')

# Resolve Markdown file links, excluding remote URLs and fragment-only links.
# Upstream sources use runtime-relative paths and are integrity-checked above.
local_docs = [ROOT / 'README.md', ROOT / 'AGENTS.md', * (ROOT / 'docs').glob('*.md'), ROOT / 'skills/lintapple-ui/SKILL.md', * (ROOT / 'skills/frontend-design').glob('*.md'), * (ROOT / 'skills/better-ui').glob('*.md'), * (ROOT / 'skills/setup-matt-pocock-skills').glob('*.md')]
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
