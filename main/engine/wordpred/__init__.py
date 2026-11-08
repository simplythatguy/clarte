"""Local four-group word prediction, independent of the research workspace."""
from .context import Context, code_of, words_of
from .predictor import Predictor

__all__ = ["Predictor", "Context", "code_of", "words_of"]
