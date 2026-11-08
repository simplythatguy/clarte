# bench/

- `harness.py`: dev/test runs for v0 and v1, two policies, paired bootstrap (`run`, `summary`, `compare`).
- `cmp.sh A B [splits]`: compact comparison on ui, ghost, top1_next, top1_full, top2_full.
- `latency.py`: cold start and p50/p95 through the HTTP server.
- `decision.tsv`: one row per experiment (hypothesis, change, before, after, delta, tests, verdict, note).
- `results/` (gitignored): per-run `<split>.jsonl` with one record per word (ranks after each group,
  rank at the full code in the whole list, costs) and `summary.json`.

Record fields: `ranks[k]` is the target's 0-based rank in the 12-word list shown after k groups (null
if absent); `ranks_ghost` is the list the ghost policy uses (v0's composer list; the same list for v1);
`rank_full` is the rank in the complete paged list at the full code.
