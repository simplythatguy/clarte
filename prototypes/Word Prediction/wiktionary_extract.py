"""Reduce the kaikki.org English Wiktionary extract to one line per entry: word, part of speech, sense tags, forms.

  curl -sSL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz | gunzip \
    | python3 wiktionary_extract.py wiktionary-english.tsv

The output (about 60 MB, 1.5 million entries) feeds add_wiktionary.py. Wiktionary is CC BY-SA 4.0.
"""
import json
import sys


def main():
    out = open(sys.argv[1], "w", encoding="utf-8")
    n = 0
    for line in sys.stdin:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        word = e.get("word", "")
        if e.get("lang_code") != "en" or not word:
            continue
        tags = set()
        for sense in e.get("senses") or []:
            tags.update(sense.get("tags") or [])
        forms = [f["form"] for f in e.get("forms") or [] if f.get("form")]
        out.write("\t".join([word, e.get("pos", ""), ",".join(sorted(tags)), "|".join(forms[:12])]) + "\n")
        n += 1
    print(n, "entries", file=sys.stderr)


if __name__ == "__main__":
    main()
