"""Build data/names.tsv.gz: the names the engine offers where a name is likely (round 5).

Sources:
- English Wiktionary's given names and surnames (wiktionary_names.py; about 62,000, many cultures; CC BY-SA 4.0),
- the 2010 US Census surnames with their counts (162,253 names seen 100 times or more; public domain),
- /usr/share/dict/propernames (1,302 first names).

Each name gets a prior: its wordfreq probability when wordfreq has seen it in text, else the Census share of
people with that surname scaled by 1e-3 (Smith: 0.8% of people -> 8e-6, near wordfreq's 1e-5 for "smith"),
else a 1e-9 floor. A name that is also an everyday word (tier 1 of the lexicon at Zipf 3.5 or more: will,
mark, rose) takes its prior from name evidence only, since its word frequency mixes both uses: the Census
share, or 3e-6 when Wiktionary or propernames call it a given name; without either it is left out, and a
short list of function words (the, and, my) never counts as a name. Text frequency is not trusted for short names that are
not given names, or for apostrophe names. The written form keeps Wiktionary's case (O'Brien, McDonald);
Census names, all capitals, are written with an initial capital.

  .venv/bin/python build_names.py WIKTIONARY_NAMES_TSV CENSUS_CSV [--out data/names.tsv.gz]
"""
import argparse
import csv
import gzip
import re
from pathlib import Path

from wordfreq import word_frequency, zipf_frequency

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "names.tsv.gz"
NAME = re.compile(r"^[a-z]+('[a-z]+)?$")
FLOOR = 1e-9
CENSUS_SCALE = 1e-3
GIVEN_COMMON = 3e-6
# Function words the Census lists as the surnames of a few people; never offered as names.
STOP = set("the and to in of a i for is it on at by be as an or so no do my me we he us up if not but are was you all can".split())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wiktionary")
    ap.add_argument("census")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()
    names = {}

    def add(written, kind, source):
        key = written.lower()
        if len(key) < 2 or not NAME.match(key):
            return
        entry = names.setdefault(key, {"written": written, "kinds": set(), "sources": set(), "census": 0})
        if source == "w" and entry["written"].isupper():
            entry["written"] = written
        entry["kinds"].add(kind)
        entry["sources"].add(source)
        return entry

    with open(a.wiktionary, encoding="utf-8") as f:
        for line in f:
            word, kinds, _origins = (line.rstrip("\n").split("\t") + ["", ""])[:3]
            for kind in kinds.split(","):
                add(word, kind, "w")
    total = 0
    with open(a.census, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            count = int(row["count"]) if row["count"].isdigit() else 0
            total += count
            entry = add(row["name"].capitalize(), "surname", "c")
            if entry is not None:
                entry["census"] += count
    for line in open("/usr/share/dict/propernames", encoding="utf-8"):
        add(line.strip(), "given", "p")
    common, bare = set(), set()
    with gzip.open(HERE / "data" / "lexicon.tsv.gz", "rt", encoding="utf-8") as f:
        for line in f:
            if not line.startswith("#"):
                w, _p, src, tier = line.rstrip("\n").split("\t")
                if "'" in w:
                    bare.add(w.replace("'", ""))
                if tier == "1" and "k" not in src and zipf_frequency(w, "en") >= 3.5:
                    common.add(w)
    rows = []
    for key, e in names.items():
        if key in bare and key not in common:
            continue        # arent, dont: the bare forms of contractions (round 3) are not names either
        census = CENSUS_SCALE * e["census"] / total if e["census"] else 0.0
        if key in STOP:
            continue
        if key in common:
            # A given name that is also an everyday word (Mary, Bob, John, Will, Rose): its word frequency mixes
            # both uses, so it takes a fixed prior, about that of a well-known first name. A Census surname that
            # is an everyday word (Brown, Young) keeps its Census share.
            given = "given" in e["kinds"] and ("w" in e["sources"] or "p" in e["sources"])
            prior = max(census if census >= 1e-7 else 0.0, GIVEN_COMMON if given else 0.0)
            if prior == 0:
                continue
        else:
            # wordfreq counts a token, not a person: trust it for names of four letters or more without an
            # apostrophe; ii, im, gen, dec, con (abbreviations as often as names) and o'young (wordfreq splits at
            # the apostrophe) take the Census share or 1e-7 for a listed given name.
            given = "given" in e["kinds"] and ("w" in e["sources"] or "p" in e["sources"])
            if "'" in key or len(key) <= 3:
                prior = max(census, 1e-7 if given else 0.0) or FLOOR
            else:
                seen = word_frequency(key, "en")
                prior = seen if seen > 0 else (census or FLOOR)
        rows.append((key, f"{prior:.3e}", ",".join(sorted(e["kinds"])), "".join(sorted(e["sources"])), e["written"]))
    rows.sort(key=lambda r: -float(r[1]))
    with gzip.open(a.out, "wt", encoding="utf-8", compresslevel=9) as f:
        f.write("# name\tprior\tkinds\tsources (w Wiktionary CC BY-SA 4.0, c 2010 US Census, p propernames)\twritten\n")
        for r in rows:
            f.write("\t".join(r) + "\n")
    print(f"{len(rows):,} names -> {a.out}")


if __name__ == "__main__":
    main()
