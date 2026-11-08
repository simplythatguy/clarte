"""Caller-owned conversation history; draft composition stays with the caller."""


def validate_history(history):
    """Return a detached JSON-compatible snapshot, or reject the entire input."""
    if not isinstance(history, (list, tuple)):
        raise ValueError('history must contain ordered [role, text] pairs')
    result = []
    for turn in history:
        if (not isinstance(turn, (list, tuple)) or len(turn) != 2
                or not isinstance(turn[0], str) or turn[0] not in ('partner', 'user')
                or not isinstance(turn[1], str)):
            raise ValueError('history must contain ["partner"|"user", text] pairs')
        result.append(list(turn))
    return result


class Conversation:
    """One independent conversation. All edits are explicit and preserve raw text."""

    def __init__(self, history=()):
        self.replace_all(history)

    @property
    def history(self):
        return [turn.copy() for turn in self._history]

    def add(self, role, text):
        """Append a committed turn and return its zero-based index."""
        turn = validate_history([[role, text]])[0]
        self._history.append(turn)
        return len(self._history) - 1

    def _index(self, index):
        if type(index) is not int or not 0 <= index < len(self._history):
            raise IndexError('turn index must identify an existing turn')
        return index

    def replace(self, index, role, text):
        index = self._index(index)
        self._history[index] = validate_history([[role, text]])[0]

    def remove(self, index):
        del self._history[self._index(index)]

    def replace_all(self, history):
        self._history = validate_history(history)

    def clear(self):
        self._history.clear()
