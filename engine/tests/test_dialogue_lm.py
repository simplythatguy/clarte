"""Synthetic plumbing checks, not evidence of AAC prediction accuracy.

Tests Clarte's adaptation of Keith Vertanen, "Towards Improving Predictive AAC
using Crowdsourced Dialogues and Partner Context", ASSETS '17, pp. 347-348.
https://doi.org/10.1145/3132525.3134814
"""
import math
from pathlib import Path
import random
import sys
import tempfile
import unittest

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.dialogue_lm import DialogueLM, GRULM, SPECIAL, tokens
from train_dialogue import corrupt, evaluate


class DialogueTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(2)
        torch.set_num_threads(1)
        self.vocab = SPECIAL + ['tea', 'coffee', '?', 'yes', 'no']
        self.model = DialogueLM(self.vocab, GRULM(10, 8), GRULM(10, 8))

    def test_partner_changes_scores_and_ablation_removes_it(self):
        tea, coffee = [['partner', 'tea ?']], [['partner', 'coffee ?']]
        self.assertFalse(torch.equal(self.model.token_scores(tea, 'yes'), self.model.token_scores(coffee, 'yes')))
        self.assertTrue(torch.equal(self.model.token_scores(tea, 'yes', False), self.model.token_scores(coffee, 'yes', False)))

    def test_interpolation_is_token_probability_mixture(self):
        h = [['partner', 'tea ?']]
        self.model.mix = 0; a = self.model.token_scores(h, 'yes').exp()
        self.model.mix = 1; b = self.model.token_scores(h, 'yes').exp()
        self.model.mix = .25
        self.assertTrue(torch.allclose(self.model.token_scores(h, 'yes').exp(), .75*a+.25*b))

    def test_roundtrip_and_ranking(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'lm.pt'
            torch.save({'format': 1, 'vocabulary': self.vocab, 'hidden': 8,
                        'utterance': self.model.utterance.state_dict(), 'dialogue': self.model.dialogue.state_dict()}, path)
            restored = DialogueLM.load(path)
            rows = restored.rank([['partner', 'tea ?']], ['yes', 'no'])
            self.assertEqual({p['text'] for p in rows}, {'yes', 'no'})
            self.assertAlmostEqual(sum(p['probability'] for p in rows), 1)
            self.assertEqual(rows, self.model.rank([['partner', 'tea ?']], ['yes', 'no']))

    def test_noise_and_evaluation(self):
        history = [['user', 'yes'], ['partner', 'tea ?']]
        self.assertEqual(corrupt(history, 0, ['no'], random.Random(0)), history)
        self.assertEqual(corrupt(history, 1, ['no'], random.Random(0))[0], history[0])
        result = evaluate(self.model, [history + [['user', 'no']]])
        self.assertTrue(math.isfinite(result['perplexity']))
        self.assertEqual(tokens('I can’t.'), ['i', 'can’t', '.'])


if __name__ == '__main__':
    unittest.main()
