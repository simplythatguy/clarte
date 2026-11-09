"""Punctuation for the spoken sentence (NAT-38).

The person types words; the voice (ElevenLabs, or the system voice) changes its intonation and pauses
with punctuation, so "are you okay" said without a "?" sounds like a statement. This module asks the
rescorer's language model where the marks go.

The model reads the conversation the way it was fine-tuned on it ("Partner: …\\nMe: …"), so it has seen
punctuated turns. For each gap between words, left to right, every option is scored as a whole turn
(the words so far with their chosen marks, this gap's option, the rest of the words, then the end of the
turn), and an option replaces "no mark" only when it makes the turn more likely by its margin:

- a comma, or an end mark inside the message ("yes. are you") after which the next word is capitalised;
- an opening quote before the next word, with or without a comma before it ('he said, "no"'), and once a
  quote is open, a closing quote after a word.

The end of the message always takes an end mark: "?" or "!" when the model prefers it to "." by its
margin, else ".". An open quote is closed at the end. Words are written in their display forms
("I", "Priya"), the first word of each sentence capitalised.

Cheaper scoring (audit L4). Most gaps take no mark, so the gaps are not all scored. One first pass scores the
three end marks over the unmarked turn ("." is that turn itself), and its log probabilities after each word say
where a mark is even plausible: a gap is scored with all its options only when the model gives a comma, an end
mark or an opening quote there at least `gap_floor` (log probability); the rest keep no mark. When no inner mark
was chosen, that first pass also gave the end mark; otherwise the end mark is scored again over the marked turn.
A typical five-word reply now costs one or two passes instead of five.

Only the torch rescorer (smol135-ft) can do this; without it the request answers `available: false` and
the app falls back to its own rule for the end mark.

It runs as background work (NAT-52): between the gaps it scores it calls `pause()`, which lets a prediction that
arrived meanwhile use the engine first. A prediction re-runs the rescorer's shared prompt cache, so punctuation
keeps its own copy of the conversation's keys and values (the tensors themselves, which the cache replaces rather
than edits) and never reads the shared one after it has begun.
"""
import time

PUNCT_DEFAULTS = dict(
    comma_margin=-4.5,     # log-probability gain a comma needs over no mark (negative: the model under-writes commas; RESULTS.md)
    split_margin=2.0,      # ... an end mark inside the message (it starts a new sentence)
    quote_margin=1.5,      # ... an opening or closing quote
    question_margin=0.0,   # ... "?" over "." at the end
    exclaim_margin=-1.0,   # ... "!" over "." at the end (negative: the model under-writes "!"; RESULTS.md)
    max_words=40,          # longer messages get only an end mark
    gap_floor=-7.0,        # a gap is scored only when a mark there has at least this log probability (L4; RESULTS.md)
)

ENDS = (".", "?", "!")


def cap(word):
    return word[:1].upper() + word[1:]


class Punctuator:
    def __init__(self, engine, params=None):
        self.engine = engine
        self.params = {**PUNCT_DEFAULTS, **(params or {})}
        r = engine.rescorer
        self.lm = r if r is not None and hasattr(r, "net") and hasattr(r, "torch") else None
        self.last_ms = {}

    def available(self):
        return self.lm is not None

    # ---- model -----------------------------------------------------------------
    def _prompt(self, history):
        """The conversation so far, run once through the model: its cache, length and next-token log probabilities."""
        return self.lm._prefix(self.lm.prompt(history, []))

    def _forward(self, legacy, n, seqs):
        """Log probabilities after every position of each token sequence, against the cached prompt (`legacy`: its
        keys and values per layer). Sequences are right-padded; a causal model never lets a position see the padding
        after it."""
        torch = self.lm.torch
        from transformers.cache_utils import DynamicCache
        B, T = len(seqs), max(len(s) for s in seqs)
        ids = torch.full((B, T), self.lm.pad, dtype=torch.long, device=self.lm.device)
        for i, s in enumerate(seqs):
            ids[i, :len(s)] = torch.tensor(s, device=self.lm.device)
        cache = DynamicCache(ddp_cache_data=[(k.expand(B, -1, -1, -1), v.expand(B, -1, -1, -1)) for k, v in legacy])
        pos = torch.arange(n, n + T, device=self.lm.device).unsqueeze(0).expand(B, -1)
        out = self.lm.net(input_ids=ids, position_ids=pos, past_key_values=cache, use_cache=False)
        return torch.log_softmax(out.logits.float(), -1)       # [B, T, V]

    # ---- rendering -------------------------------------------------------------
    @staticmethod
    def render(words, marks, opens, closes):
        """The turn as written: marks[i] follows word i, opens[i] puts a quote before it, closes[i] after its mark."""
        out, new_sentence = [], True
        for i, w in enumerate(words):
            w = cap(w) if new_sentence else w
            piece = ('"' if opens[i] else "") + w + marks[i] + ('"' if closes[i] else "")
            out.append(piece)
            new_sentence = marks[i] in ENDS
        return " ".join(out)

    # ---- scoring ---------------------------------------------------------------
    def _score(self, legacy, n, last, texts):
        """Log probability of each text (with its end of turn) after the cached prompt."""
        tok = self.lm.tokenizer
        newline = tok.encode("\n", add_special_tokens=False)
        seqs = [tok.encode(" " + t, add_special_tokens=False) + newline for t in texts]
        full = self._forward(legacy, n, seqs)
        out = []
        for i, ids in enumerate(seqs):
            lp = float(last[ids[0]])
            for t in range(1, len(ids)):
                lp += float(full[i, t - 1, ids[t]])
            out.append(lp)
        return out

    def _mark_tokens(self):
        """First token of each mark as it follows a word: ",", ".", "?", "!", and an opening quote (' "')."""
        if not hasattr(self, "_marks"):
            tok = self.lm.tokenizer
            self._marks = sorted({tok.encode(m, add_special_tokens=False)[0] for m in (",",) + ENDS}
                                 | {tok.encode(' "', add_special_tokens=False)[0]})
        return self._marks

    def _probe(self, legacy, n, last, words, opens, closes):
        """One pass over the unmarked turn with each end mark: the three end scores, and for each gap whether any
        mark there reaches `gap_floor` (gaps whose tokens do not line up with the turn's are kept, to be safe)."""
        tok = self.lm.tokenizer
        newline = tok.encode("\n", add_special_tokens=False)
        n_words = len(words)
        texts = []
        for m in ENDS:
            mk = [""] * n_words
            mk[-1] = m
            texts.append(self.render(words, mk, opens, closes))
        seqs = [tok.encode(" " + t, add_special_tokens=False) + newline for t in texts]
        full = self._forward(legacy, n, seqs)
        ends = []
        for i, ids in enumerate(seqs):
            lp = float(last[ids[0]])
            for t in range(1, len(ids)):
                lp += float(full[i, t - 1, ids[t]])
            ends.append(lp)
        marks = self._mark_tokens()
        plain = seqs[0]
        floor = self.params["gap_floor"]
        keep = []
        for g in range(n_words - 1):
            prefix = tok.encode(" " + self.render(words[:g + 1], [""] * (g + 1), opens[:g + 1], [False] * (g + 1)),
                                add_special_tokens=False)
            b = len(prefix)
            if plain[:b] != prefix or b >= len(plain):
                keep.append(True)
                continue
            keep.append(float(full[0, b - 1, marks].max()) >= floor)
        return ends, keep

    def _end(self, s_dot, s_q, s_ex):
        p = self.params
        if s_q - s_dot > p["question_margin"] and s_q - p["question_margin"] >= s_ex - p["exclaim_margin"]:
            return "?"
        if s_ex - s_dot > p["exclaim_margin"]:
            return "!"
        return "."

    def punctuate(self, history, message, pause=lambda: None):
        """`pause` is called between scoring steps; it may let other work use the engine (NAT-52)."""
        t0 = time.perf_counter()
        p = self.params
        engine = self.engine
        ctx = engine.context(history, message)
        msg = list(ctx.message)
        if not msg:
            return {"available": self.available(), "text": "", "end": ""}
        forms = engine.prior(ctx)[3]
        words = [engine.display(w, forms) for w in msg]
        words = ["I" + w[1:] if w == "i" or w.startswith("i'") else w for w in words]
        n_words = len(words)
        marks, opens, closes = [""] * n_words, [False] * n_words, [False] * n_words
        if not self.available():
            return {"available": False, "text": self.render(words, marks[:-1] + ["."], opens, closes), "end": "."}
        torch = self.lm.torch
        with torch.inference_mode():
            kv, n, last = self._prompt(history)
            legacy = tuple(kv.to_legacy_cache())     # our own copy: a prediction may re-run the shared cache in a pause
            quote_open = False
            inner = n_words <= p["max_words"]
            pause()
            first_ends, worth = self._probe(legacy, n, last, words, opens, closes)
            passes, placed = 1, False
            for g in range(n_words - 1 if inner else 0):
                if not quote_open and not worth[g]:
                    continue      # no mark is plausible here: it keeps none (L4)
                # Options for the gap after word g: (mark, open a quote before word g+1, close after word g).
                options = [("", False, False)]
                for m in (",",) + ENDS:
                    options.append((m, False, False))
                if quote_open:
                    for m in ("", ",") + ENDS:
                        options.append((m, False, True))
                else:
                    for m in ("", ","):
                        options.append((m, True, False))
                texts = []
                for m, o, c in options:
                    mk, op, cl = marks[:], opens[:], closes[:]
                    mk[g], cl[g] = m, c
                    if o:
                        op[g + 1] = True
                    texts.append(self.render(words, mk, op, cl))
                pause()
                scores = self._score(legacy, n, last, texts)
                passes += 1
                base = scores[0]
                best, best_gain = 0, 0.0
                for k, ((m, o, c), s) in enumerate(zip(options, scores)):
                    if k == 0:
                        continue
                    need = p["quote_margin"] if (o or c) else p["split_margin"] if m in ENDS else p["comma_margin"]
                    gain = s - base - need
                    if gain > best_gain:
                        best, best_gain = k, gain
                m, o, c = options[best]
                placed = placed or best != 0
                marks[g], closes[g] = m, c
                if o:
                    opens[g + 1] = True
                    quote_open = True
                if c:
                    quote_open = False
            # The end mark: ".", "?" or "!", closing a quote left open. The first pass already scored it over the
            # unmarked turn; only a turn that took inner marks is scored again.
            closes[-1] = quote_open
            if placed or quote_open:
                texts = []
                for m in ENDS:
                    mk = marks[:]
                    mk[-1] = m
                    texts.append(self.render(words, mk, opens, closes))
                pause()
                end = self._end(*self._score(legacy, n, last, texts))
                passes += 1
            else:
                end = self._end(*first_ends)
            marks[-1] = end
        self.last_ms = {"total": 1000 * (time.perf_counter() - t0), "passes": passes}
        return {"available": True, "text": self.render(words, marks, opens, closes), "end": end}
