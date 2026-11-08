#!/bin/sh
# cmp.sh A B [splits] : compact comparison on ui, ghost, top1_next, top2_full
A=$1; B=$2; S=${3:-aac_dev,dd_dev}
for m in ui ghost top1_next top1_full top2_full; do
  .venv/bin/python bench/harness.py compare "$A" "$B" --splits "$S" --metric $m 2>/dev/null | python3 -c "
import json,sys; d=json.load(sys.stdin); print(f\"{d['metric']:10s} A={d['A_mean']:.4f} B={d['B_mean']:.4f} delta={d['delta_B_minus_A']:+.4f} ci=[{d['ci95'][0]:+.4f},{d['ci95'][1]:+.4f}] {'SIG' if d['significant'] else 'n.s.'} words={d['words']}\")"
done
