"""Owned paths, provenance, and small JSON helpers."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ART = HERE / "artifacts"
CHECKPOINTS = HERE / "checkpoints"
PYTHON = ROOT / "methods/neural/.venv/bin/python"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def protect(initialize=False):
    path = ART / "protected.json"
    if initialize:
        files = [ROOT / line.split()[1] for line in (ROOT / "FROZEN.sha256").read_text().splitlines()]
        files += [ROOT / x for x in ("FROZEN.sha256", "PROTOCOL-AMENDMENTS.md", "decision.tsv",
                                     "literature/methods.json")]
        for lane in ("neural", "ensemble", "optimal", "ngram"):
            files += list((ROOT / "methods" / lane).glob("*.py"))
        files += [ROOT / "methods/neural/vocabulary.json", ROOT / "methods/neural/requirements.txt"]
        write_json(path, {str(p.relative_to(ROOT)): sha(p) for p in files})
    expected = json.loads(path.read_text())
    # The parent owns its live decision log and may append concurrently. This
    # child only reads it; preserve both fingerprints without blocking its work.
    observed = {p: sha(ROOT / p) for p in expected}
    if observed.get("decision.tsv") != expected.get("decision.tsv"):
        write_json(ART / "parent-decision-drift.json", {
            "initial_sha256": expected["decision.tsv"], "observed_sha256": observed["decision.tsv"],
            "note": "Parent-owned log changed externally; child never writes it"})
    changed = [p for p, h in expected.items() if p != "decision.tsv" and observed[p] != h]
    if changed:
        raise RuntimeError(f"Protected files changed: {changed}")
    for line in (ROOT / "FROZEN.sha256").read_text().splitlines():
        digest, file = line.split()
        assert sha(ROOT / file) == digest, file
    return len(expected)
