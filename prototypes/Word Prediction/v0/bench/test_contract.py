"""Output contract tests without model weights or native libraries."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))
from wordpred.predictor import Predictor
from wordpred.context import code_of
from run import claude

spec = importlib.util.spec_from_file_location('autocomplete', ENGINE.parents[1] / 'Autocomplete/v0/autocomplete.py')
autocomplete = importlib.util.module_from_spec(spec)
spec.loader.exec_module(autocomplete)


class Contract(unittest.TestCase):
    def test_unverified_remote_model_rejected_before_network(self):
        with patch('run.urlopen') as network:
            with self.assertRaisesRegex(ValueError, 'Unsupported benchmark model'):
                claude('claude-opus-5-5', {'groups': ''})
            network.assert_not_called()

    def setUp(self):
        self.predictor = Predictor.__new__(Predictor)
        p = self.predictor
        p.words = ['outside', 'out', 'stupid', 'puts', 'outstanding']
        p.word_array = np.array(p.words, dtype=object)
        p.codes = [code_of(w) for w in p.words]
        p.lengths = np.array([len(c) for c in p.codes])
        p.probs = np.array([.5, .2, .15, .1, .05])
        p.prefix = {c[:k]: np.array([i for i, code in enumerate(p.codes) if code.startswith(c[:k])])
                    for c in p.codes for k in range(len(c)+1)}
        p._prepare = lambda ctx: None

    def test_views_use_probability_order_not_exact_length_or_composer(self):
        p = self.predictor
        p.rank = lambda *args: self.fail('HTTP view should not run optimal composer')
        result = p.predict([], [], '34')
        for field in ['likely', 'choose', 'candidates']:
            self.assertEqual(result[field], ['outside', 'out'])
        self.assertEqual(result['ghost'], 'outside')
        self.assertLessEqual(len(result['short']), 2)
        self.assertTrue(set(result['short']).issubset(result['likely']))

    def test_no_groups_and_no_matches(self):
        self.assertEqual(self.predictor.predict([], [], '')['likely'], ['outside', 'out'])
        result = self.predictor.predict([], [], '11111111')
        self.assertEqual(result, dict(likely=[], choose=[], candidates=[], short=[], ghost=''))

    def test_autocomplete_preserves_full_mass(self):
        result = autocomplete.complete_with(self.predictor, [], [], '')
        self.assertEqual(result['word'], 'outside')
        self.assertEqual(result['probability'], .5)
        self.assertEqual(result['alternatives'], [{'word': 'out', 'probability': .2}])

    def test_single_match(self):
        result = self.predictor.predict([], [], code_of('outstanding'))
        self.assertEqual(result['likely'], ['outstanding'])


if __name__ == '__main__':
    unittest.main()
