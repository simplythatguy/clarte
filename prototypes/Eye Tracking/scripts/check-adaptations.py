"""Check reproducibility against pristine source; optionally refresh the portable diff."""
from difflib import unified_diff
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

root = Path(__file__).resolve().parents[1]
patch = []
with TemporaryDirectory(prefix='still-adaptations-') as temporary:
    workspace = Path(temporary)
    (workspace / 'scripts').mkdir()
    source = workspace / 'vendor/webgazer/src'
    source.mkdir(parents=True)
    adapter = workspace / 'scripts/adapt-webgazer.py'
    shutil.copyfile(root / 'scripts/adapt-webgazer.py', adapter)
    for name in ['index.mjs', 'params.mjs', 'facemesh.mjs']:
        shutil.copyfile(root / 'vendor/webgazer/upstream' / name, source / name)
    subprocess.run([sys.executable, str(adapter)], check=True)
    for name in ['index.mjs', 'params.mjs', 'facemesh.mjs']:
        original = (root / 'vendor/webgazer/upstream' / name).read_text()
        adapted = (source / name).read_text()
        assert adapted == (root / 'vendor/webgazer/src' / name).read_text(), f'Adapter output drift: {name}'
        patch.extend(unified_diff(original.splitlines(keepends=True), adapted.splitlines(keepends=True), fromfile=f'a/src/{name}', tofile=f'b/src/{name}'))

expected = ''.join(patch)
destination = root / 'vendor/webgazer/LOCAL-ADAPTATIONS.patch'
if '--write-patch' in sys.argv:
    destination.write_text(expected)
else:
    assert destination.read_text() == expected, 'Stale LOCAL-ADAPTATIONS.patch. Run python3 scripts/check-adaptations.py --write-patch'
print('PASS: adapter reproduces all three changed upstream files; portable patch matches pristine originals.')
