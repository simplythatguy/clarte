"""Single highest-probability completion from the sibling Word Prediction engine."""
import os
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2] / 'Word Prediction/v0'
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
from wordpred import Predictor

_predictor = None


def complete_with(predictor, history, message, groups):
    groups = ''.join(ch for ch in str(groups) if ch in '1234')
    matches = predictor.matching_probabilities(predictor.context(history, message), groups)
    if not matches:
        return {'word': '', 'probability': 0.0, 'alternatives': []}
    word, probability = matches[0]
    return {'word': word, 'probability': probability,
            'alternatives': [{'word': w, 'probability': p} for w, p in matches[1:2]]}


def complete(history, message, groups):
    """Return the most probable matching word, its conditional mass, and one alternative."""
    global _predictor
    if _predictor is None:
        _predictor = Predictor(model=os.environ.get('WORDPRED_MODEL', 'deployable'))
        _predictor.start_conversation('ui')
    return complete_with(_predictor, history, message, groups)
