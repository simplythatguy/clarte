"""Pull English Wiktionary's given names and surnames out of the kaikki.org English extract.

  curl -sSL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz | gunzip \
    | python3 wiktionary_names.py wiktionary-names.tsv

One line per name: the name as written, `given` and/or `surname`, and the origins the glosses name ("A
female given name from Sanskrit" -> sanskrit). Feeds build_names.py. Wiktionary is CC BY-SA 4.0.
"""
import json
import re
import sys

ORIGIN = re.compile(r"\bfrom (?:the )?([A-Z][a-z]+)")


def main():
    out = open(sys.argv[1], "w", encoding="utf-8")
    n = 0
    for line in sys.stdin:
        if '"name"' not in line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("lang_code") != "en" or e.get("pos") != "name":
            continue
        kinds, origins = set(), set()
        for sense in e.get("senses") or []:
            for gloss in sense.get("glosses") or []:
                g = gloss.lower()
                if "given name" in g or "diminutive of" in g or "pet form" in g:
                    kinds.add("given")
                if "surname" in g:
                    kinds.add("surname")
                if kinds:
                    origins.update(o.lower() for o in ORIGIN.findall(gloss))
        if kinds:
            out.write("\t".join([e["word"], ",".join(sorted(kinds)), ",".join(sorted(origins))]) + "\n")
            n += 1
    print(n, "names", file=sys.stderr)


if __name__ == "__main__":
    main()
