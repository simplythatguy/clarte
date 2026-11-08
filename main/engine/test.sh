#!/bin/sh
# One command: contract + tier tests (fast + live HTTP), the adversarial suite, and a coverage sample.
# Usage: ./test.sh            (about 4 minutes; loads the engine four times)
#        PREDICT_TESTS=fast ./test.sh   (validation, tier rules and fake-engine HTTP tests only, under a second)
# coverage.py exits non-zero when a lexicon word is unreachable or a tier-2 word precedes a tier-1 word without context.
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
$PY -m unittest discover -s tests -v
if [ "${PREDICT_TESTS:-live}" != "fast" ]; then
  $PY adversarial.py --out bench/results/adversarial.json
  $PY coverage.py --sample 300 --templates 3 --out bench/results/coverage_quick.json
fi
