"""Stdlib HTTP wrapper for the single-completion API."""
import argparse
from pathlib import Path

from autocomplete import complete_with
from wordpred.http import load_predictor, serve


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=['deployable', 'light'], default='deployable')
    parser.add_argument('--light', action='store_true', help='Alias for --model light')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    predictor = load_predictor('light' if args.light else args.model)
    print('Autocomplete model:', predictor.model, flush=True)
    try:
        serve('/api/complete', lambda *values: complete_with(predictor, *values),
              Path(__file__).with_name('index.html'), args.host, args.port,
              correlate=True, assets={'/client.mjs': Path(__file__).with_name('client.mjs')})
    finally:
        predictor.close()


if __name__ == '__main__':
    main()
