import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

from wordpred import Conversation
from wordpred.http import request_values, serve
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autocomplete import complete_with


class ContextIntakeTests(unittest.TestCase):
    def test_edits_clear_and_isolation(self):
        original = [['partner', '  Typed or pasted\nUser: still partner  ']]
        first, second = Conversation(original), Conversation()
        original[0][1] = 'changed'
        self.assertEqual(first.add('user', 'Yes'), 1)
        first.replace(0, 'partner', 'Edited')
        first.add('partner', '')
        self.assertEqual(first.history, [['partner', 'Edited'], ['user', 'Yes'], ['partner', '']])
        first.remove(1)
        snapshot = first.history
        snapshot[0][1] = 'external edit'
        self.assertEqual(first.history[0][1], 'Edited')
        self.assertEqual(second.history, [])
        first.replace_all([['user', 'Replacement']])
        first.clear()
        self.assertEqual(first.history, [])

    def test_invalid_edits_are_atomic(self):
        conversation = Conversation([['partner', 'Keep']])
        for role in ('assistant', '', None, [], {}):
            with self.subTest(role=role):
                for edit in (lambda: conversation.add(role, 'x'),
                             lambda: conversation.replace(0, role, 'x'),
                             lambda: conversation.replace_all([['user', 'valid'], [role, 'x']])):
                    with self.assertRaises(ValueError):
                        edit()
                    self.assertEqual(conversation.history, [['partner', 'Keep']])
        for index in (-1, 1, True, '0'):
            with self.assertRaises(IndexError):
                conversation.remove(index)
        with self.assertRaises(ValueError):
            conversation.add('user', None)

    def test_raw_empty_text_and_draft_separation(self):
        conversation = Conversation([['partner', '  user: hello\npartner: hi  '], ['user', '']])
        draft = ['unfinished']
        history, message, _ = request_values({'history': conversation.history, 'message': draft})
        self.assertEqual(history, conversation.history)
        self.assertEqual(message, draft)
        message.append('more')
        self.assertEqual(draft, ['unfinished'])
        self.assertEqual(len(conversation.history), 2)
        conversation.clear()
        self.assertEqual(draft, ['unfinished'])

    def test_pasted_text_and_structured_history(self):
        self.assertEqual(request_values({'context_text': '  Shall we go?  ', 'message': ['yes'], 'groups': '4'}),
                         ([['partner', 'Shall we go?']], ['yes'], '4'))
        self.assertEqual(request_values({'context_text': '  '})[0], [])
        history = [['partner', 'Hello'], ['user', 'Hi']]
        self.assertEqual(request_values({'history': history})[0], history)

    def test_ambiguous_or_invalid_input_is_rejected(self):
        for body in ({'context_text': 'hello', 'history': []}, {'context_text': 42},
                     {'history': [['unknown', 'hello']]}, {'history': [[[], 'hello']]}):
            with self.subTest(body=body), self.assertRaises(ValueError):
                request_values(body)

    def test_both_http_routes_deliver_context_to_predictor(self):
        for endpoint in ('/api/predict', '/api/complete'):
            received = []
            ready = threading.Event()
            servers = []

            class OneRequestServer(HTTPServer):
                def __init__(self, address, handler):
                    super().__init__(('127.0.0.1', 0), handler)
                    servers.append(self)
                    ready.set()

                def serve_forever(self):
                    for _ in range(3):
                        self.handle_request()

            class ControlledPredictor:
                def predict(self, *values):
                    received.append(values)
                    return {'word': 'outside'}

                def context(self, history, message):
                    received.append((history, message, '3'))
                    return history, message

                def matching_probabilities(self, context, groups):
                    assert groups == '3'
                    return [('outside', 1.0)]

            predictor = ControlledPredictor()
            predict = predictor.predict if endpoint == '/api/predict' else lambda *v: complete_with(predictor, *v)

            with self.subTest(endpoint=endpoint), patch('wordpred.http.HTTPServer', OneRequestServer):
                thread = threading.Thread(target=serve, args=(endpoint, predict, Path(__file__).with_name('index.html'), '127.0.0.1', 0))
                thread.start()
                self.assertTrue(ready.wait(5))
                connection = HTTPConnection('127.0.0.1', servers[0].server_port, timeout=5)
                connection.request('POST', endpoint, json.dumps({'history': [['partner', 'Outside?'], ['user', 'Yes'], ['partner', 'Now?']], 'message': ['draft'], 'groups': '3'}), {'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())['word'], 'outside')
                for payload in ({'context_text': 'Separate conversation', 'groups': '3'}, {'groups': '3'}):
                    connection.request('POST', endpoint, json.dumps(payload), {'Content-Type': 'application/json'})
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                connection.close()
                thread.join(5)
                self.assertFalse(thread.is_alive())
                self.assertEqual(received, [([['partner', 'Outside?'], ['user', 'Yes'], ['partner', 'Now?']], ['draft'], '3'), ([['partner', 'Separate conversation']], [], '3'), ([], [], '3')])


if __name__ == '__main__':
    unittest.main()
