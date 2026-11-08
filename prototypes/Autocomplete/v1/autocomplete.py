"""Single highest-probability completion from the bundled local prediction engine."""
import os
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parent / 'engine'
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
from wordpred import Predictor
from wordpred.http import request_values

_predictor = None


def complete_with(predictor, history, message, groups):
    """Stateless suggestion only; never commit to the predictor or caller's draft."""
    history, message, groups = request_values(dict(history=history, message=message, groups=groups))
    matches = predictor.matching_probabilities(predictor.context(history, message), groups)
    if not matches:
        return {'status': 'no_match', 'word': '', 'probability': 0.0, 'alternatives': [],
                'probability_kind': 'conditional_model_mass'}
    word, probability = matches[0]
    return {'status': 'suggestion', 'word': word, 'probability': probability,
            'probability_kind': 'conditional_model_mass',
            'alternatives': [{'word': w, 'probability': p} for w, p in matches[1:4]]}


def complete(history, message, groups):
    """Return the most probable matching word, its conditional mass, and up to 3 alternatives."""
    global _predictor
    if _predictor is None:
        _predictor = Predictor(model=os.environ.get('WORDPRED_MODEL', 'deployable'))
        _predictor.start_conversation('ui')
    return complete_with(_predictor, history, message, groups)
