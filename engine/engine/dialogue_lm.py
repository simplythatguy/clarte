"""Local GRU language models inspired by Vertanen (ASSETS 2017).

Research credit: Keith Vertanen, "Towards Improving Predictive AAC using
Crowdsourced Dialogues and Partner Context", ASSETS '17, pp. 347-348.
https://doi.org/10.1145/3132525.3134814
Clarte adaptation: utterance/dialogue GRUs and token-probability interpolation;
full softmax and saved-phrase ranking differ from the original experiments.

Two independently trained LMs: individual user utterances and two-sided dialogue.
Interpolate token probabilities, not phrase ranks. No conversation is persisted here.
"""
import math
import re
from pathlib import Path

import torch
from torch import nn

SPECIAL = ['<unk>', '<bos>', '<eos>', '<partner>', '<user>']


def tokens(text):
    return re.findall(r"\w+(?:['’]\w+)*|[^\w\s]", text.lower(), re.UNICODE)


class GRULM(nn.Module):
    def __init__(self, vocabulary, hidden=250):
        super().__init__()
        self.embedding = nn.Embedding(vocabulary, hidden)
        self.gru = nn.GRU(hidden, hidden, batch_first=True)
        self.output = nn.Linear(hidden, vocabulary)

    def forward(self, ids, state=None):
        values, state = self.gru(self.embedding(ids), state)
        return self.output(values), state


class DialogueLM:
    def __init__(self, vocabulary, utterance, dialogue, mix=0.5, max_context=256):
        if not 0 <= mix <= 1:
            raise ValueError('mix must be in [0,1]')
        self.vocabulary = vocabulary
        self.index = {w: i for i, w in enumerate(vocabulary)}
        self.utterance, self.dialogue = utterance.eval(), dialogue.eval()
        self.mix, self.max_context = mix, max_context

    @classmethod
    def load(cls, path, mix=0.5):
        data = torch.load(Path(path), map_location='cpu', weights_only=True)
        if data['format'] != 1 or data['vocabulary'][:5] != SPECIAL:
            raise ValueError('Unsupported dialogue checkpoint')
        nets = [GRULM(len(data['vocabulary']), data['hidden']) for _ in range(2)]
        for net, key in zip(nets, ('utterance', 'dialogue')):
            net.load_state_dict(data[key])
        return cls(data['vocabulary'], *nets, mix=mix)

    def ids(self, words):
        return [self.index.get(w, 0) for w in words]

    def context(self, history, partner=True):
        words = ['<bos>']
        for role, text in history[-24:]:
            if role == 'partner' and not partner:
                continue
            words += ['<partner>' if role == 'partner' else '<user>'] + tokens(text) + ['<eos>']
        return words[-self.max_context:] + ['<user>']

    @torch.inference_mode()
    def token_scores(self, history, phrase, partner=True):
        """Per-token interpolated log probabilities, including utterance end."""
        target = self.ids(tokens(phrase) + ['<eos>'])
        contexts = [self.ids(['<bos>', '<user>']), self.ids(self.context(history, partner))]
        values = []
        for net, context in zip((self.utterance, self.dialogue), contexts):
            seq = torch.tensor([context + target[:-1]])
            logits, _ = net(seq)
            logp = logits[0, len(context)-1:].log_softmax(-1)
            values.append(logp.gather(1, torch.tensor(target).unsqueeze(1)).squeeze(1))
        if self.mix == 0:
            return values[0]
        if self.mix == 1:
            return values[1]
        return torch.logaddexp(values[0] + math.log1p(-self.mix), values[1] + math.log(self.mix))

    def rank(self, history, phrases):
        # Sum log probabilities: probability of the complete utterance, including EOS.
        scores = [float(self.token_scores(history, text).sum()) for text in phrases]
        probs = torch.softmax(torch.tensor(scores, dtype=torch.float64), 0).tolist() if scores else []
        return sorted([{'text': text, 'probability': p} for text, p in zip(phrases, probs)],
                      key=lambda row: -row['probability'])
