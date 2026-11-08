"""Frozen benchmark context and token/group rules, ported without changes."""
import re
from dataclasses import dataclass

GROUPS = ("abcdef", "ghijklmn", "opqrs", "tuvwxyz")
ZONE = {ch: str(i + 1) for i, g in enumerate(GROUPS) for ch in g}
TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)*")

def code_of(word: str) -> str:
    """Zone code of a word. Characters without a zone (the apostrophe) produce no selection."""
    return "".join(ZONE[c] for c in word if c in ZONE)

def words_of(text: str) -> list[str]:
    return TOKEN.findall(text.replace("’", "'").lower())

@dataclass(frozen=True)
class Context:
    conv_id: str
    history: tuple[tuple[str, str], ...]   # earlier turns: ("user" | "partner", raw text)
    message: tuple[str, ...]
