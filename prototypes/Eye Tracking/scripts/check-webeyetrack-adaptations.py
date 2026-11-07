from pathlib import Path
from tempfile import TemporaryDirectory
from difflib import unified_diff
import json, hashlib, shutil, subprocess, sys
root=Path(__file__).resolve().parents[1]
base=root/'vendor/webeyetrack'
up=json.loads((base/'UPSTREAM.json').read_text())
for entry in up['files']:
    assert hashlib.sha256((base/entry['path']).read_bytes()).hexdigest()==entry['sha256'], entry['path']
patch=[]
with TemporaryDirectory(prefix='still-webeyetrack-') as temporary:
    work=Path(temporary)
    (work/'scripts').mkdir()
    shutil.copytree(base/'js/src',work/'vendor/webeyetrack/js/src')
    shutil.copyfile(root/'scripts/adapt-webeyetrack.py',work/'scripts/adapt-webeyetrack.py')
    subprocess.run([sys.executable,str(work/'scripts/adapt-webeyetrack.py')],check=True)
    for expected in sorted((work/'vendor/webeyetrack/local').rglob('*')):
        if not expected.is_file(): continue
        name=expected.relative_to(work/'vendor/webeyetrack/local')
        actual=base/'local'/name
        assert actual.read_bytes()==expected.read_bytes(),f'Adaptation drift: {name}'
        original=(base/'js/src'/name).read_text()
        adapted=actual.read_text()
        if original!=adapted:patch.extend(unified_diff(original.splitlines(keepends=True),adapted.splitlines(keepends=True),fromfile=f'a/{name}',tofile=f'b/{name}'))
text=''.join(patch)
if '--write-patch' in sys.argv:(base/'LOCAL-ADAPTATIONS.patch').write_text(text)
else:assert (base/'LOCAL-ADAPTATIONS.patch').read_text()==text,'Portable patch drift'
print(f'PASS: {len(up["files"])} pinned WebEyeTrack files and all reproducible local adaptations match.')
