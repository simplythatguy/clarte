"""Train/evaluate the ASSETS-2017-inspired phrase models on local JSONL dialogues.

Research credit: Keith Vertanen, "Towards Improving Predictive AAC using
Crowdsourced Dialogues and Partner Context", ASSETS '17, pp. 347-348.
https://doi.org/10.1145/3132525.3134814
Adapts the recurrent dialogue/utterance modeling and partner-error experiments;
the corpora, full-softmax optimizer setup and phrase-ranking use differ.

Each line: {"turns": [["partner", "..."], ["user", "..."]]}
Supply disjoint train/dev/test files. No downloads or private-transcript collection.
"""
import argparse
import csv
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import random

import torch
from torch.nn.utils.rnn import pad_sequence
from engine.dialogue_lm import DialogueLM, GRULM, SPECIAL, tokens


def read(path):
    rows = [json.loads(line)['turns'] for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]
    if not rows or any(not row or any(not isinstance(t, list) or len(t) != 2 or t[0] not in ('partner', 'user')
                                    or not isinstance(t[1], str) for t in row) for row in rows):
        raise ValueError('Expected nonempty dialogues of [partner|user, text] turns')
    return rows


def sequences(rows, dialogue):
    for turns in rows:
        if dialogue:
            yield ['<bos>'] + [w for role, text in turns for w in
                               (['<partner>' if role == 'partner' else '<user>'] + tokens(text) + ['<eos>'])]
        else:
            for role, text in turns:
                if role == 'user':
                    yield ['<bos>', '<user>'] + tokens(text) + ['<eos>']


def corrupt(history, rate, vocabulary, rng):
    # Vertanen (2017), Section 2.2: 80% substitution, 10% insertion, 10% deletion.
    # https://doi.org/10.1145/3132525.3134814 (Clarte uses its train-only vocabulary).
    out = []
    for role, text in history:
        words = tokens(text)
        if role == 'partner':
            changed = []
            for word in words:
                if rng.random() >= rate:
                    changed.append(word)
                else:
                    kind = rng.random()
                    if kind < .8:
                        changed.append(rng.choice(vocabulary))
                    elif kind < .9:
                        changed.extend([word, rng.choice(vocabulary)])
                    # final 10%: delete
            words = changed
        out.append([role, ' '.join(words)])
    return out


def evaluate(model, rows, rate=0, partner=True):
    rng, loss, count, unknown = random.Random(0), 0., 0, 0
    for turns in rows:
        history = []
        for role, text in turns:
            if role == 'user':
                context = corrupt(history, rate, model.vocabulary[5:] or ['unknown'], rng)
                values = model.token_scores(context, text, partner=partner)
                loss -= float(values.sum()); count += len(values)
                unknown += sum(w not in model.index for w in tokens(text))
            history.append([role, text])
    if not count:
        raise ValueError('Evaluation requires user turns')
    return {'perplexity': math.exp(min(loss/count, 700)), 'tokens': count, 'unknown_tokens': unknown}


def train(args):
    rows, valid = read(args.train), read(args.valid)
    # Fail on exact dialogue overlap; caller must also prevent near-duplicate leakage.
    if {json.dumps(r) for r in rows} & {json.dumps(r) for r in valid}:
        raise ValueError('Train/validation dialogue overlap')
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    counts = Counter(w for row in rows for _, text in row for w in tokens(text))
    vocab = SPECIAL + [w for w, _ in counts.most_common(args.vocab - len(SPECIAL))]
    index = {w: i for i, w in enumerate(vocab)}
    nets = []
    for dialogue in (False, True):
        net = GRULM(len(vocab), args.hidden)
        optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
        seqs = []
        for words in sequences(rows, dialogue):
            ids = [index.get(w, 0) for w in words]
            # Overlapping boundary token preserves every next-token target exactly once.
            seqs.extend(torch.tensor(ids[i:i+args.length+1]) for i in range(0, len(ids)-1, args.length))
        if not seqs:
            raise ValueError('Training requires user turns')
        best_loss, best = math.inf, None
        for epoch in range(args.epochs):
            net.train(); rng.shuffle(seqs)
            for at in range(0, len(seqs), args.batch):
                batch = seqs[at:at+args.batch]
                x = pad_sequence([s[:-1] for s in batch], batch_first=True)
                y = pad_sequence([s[1:] for s in batch], batch_first=True, padding_value=-100)
                optimizer.zero_grad()
                logits, _ = net(x)
                loss = torch.nn.functional.cross_entropy(logits.flatten(0, 1), y.flatten(), ignore_index=-100)
                loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 5); optimizer.step()
            net.eval()
            # Select epochs only on validation sequences, never test.
            total, n = 0., 0
            with torch.inference_mode():
                for words in sequences(valid, dialogue):
                    ids = [index.get(w, 0) for w in words]
                    for at in range(0, len(ids)-1, args.length):
                        s = torch.tensor([ids[at:at+args.length+1]])
                        logits, _ = net(s[:, :-1])
                        total += float(torch.nn.functional.cross_entropy(logits.flatten(0, 1), s[:, 1:].flatten(), reduction='sum'))
                        n += s.shape[1]-1
            if not n:
                raise ValueError('Validation requires user turns')
            if total/n < best_loss:
                best_loss = total/n
                best = {k: v.detach().clone() for k, v in net.state_dict().items()}
            print(json.dumps({'model': 'dialogue' if dialogue else 'utterance', 'epoch': epoch+1, 'valid_nll': total/n}), flush=True)
        net.load_state_dict(best); nets.append(net)
    path = Path(args.output); path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({'format': 1, 'vocabulary': vocab, 'hidden': args.hidden,
                'utterance': nets[0].state_dict(), 'dialogue': nets[1].state_dict()}, path)
    model = DialogueLM(vocab, *nets)
    trials = [(evaluate(DialogueLM(vocab, *nets, mix=w), valid)['perplexity'], w) for w in (0, .25, .5, .75, 1)]
    _, model.mix = min(trials)
    receipt = {'paper': 'https://doi.org/10.1145/3132525.3134814', 'adaptation': 'GRU softmax; local supplied corpora; utterance/dialogue interpolation',
               'source': args.source, 'license': args.license, 'seed': args.seed, 'mix': model.mix,
               'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
               'inputs': {str(p): hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (args.train, args.valid)},
               'valid': evaluate(model, valid)}
    path.with_suffix('.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare', help='Convert author TSV retaining original set labels')
    prep.add_argument('--input', required=True); prep.add_argument('--output', required=True)
    t = sub.add_parser('train')
    for name in ('train', 'valid', 'output', 'source', 'license'):
        t.add_argument('--'+name, required=True)
    for name, default in [('epochs', 10), ('hidden', 250), ('vocab', 20000), ('length', 128), ('batch', 16), ('seed', 0)]:
        t.add_argument('--'+name, type=int, default=default)
    t.add_argument('--lr', type=float, default=.001)
    e = sub.add_parser('evaluate'); e.add_argument('--model', required=True); e.add_argument('--test', required=True)
    p.add_argument('--threads', type=int, default=4)
    args = p.parse_args(); torch.set_num_threads(args.threads)
    if args.command == 'prepare':
        path = Path(args.input); out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
        with path.open(encoding='utf-8') as stream:
            rows = list(csv.DictReader(stream, delimiter='\t'))
        for split in ('train', 'dev', 'test'):
            selected = [{'turns': [['partner' if i % 2 == 0 else 'user', row[f'turn{i+1}']] for i in range(6)]}
                        for row in rows if row['set'] == split]
            if not selected:
                raise ValueError(f'Missing author split {split}')
            (out / f'{split}.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in selected), encoding='utf-8')
        (out / 'source.json').write_text(json.dumps({'source': 'http://keithv.com/data/turk-dialogues.txt',
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'split': 'original author labels',
            'license': 'Redistribution unverified; do not publish data/weights without review'}, indent=2)+'\n', encoding='utf-8')
    elif args.command == 'train':
        if min(args.epochs, args.hidden, args.length, args.batch) < 1 or args.vocab < 6:
            p.error('positive dimensions and vocabulary >=6 required')
        train(args)
    else:
        receipt = json.loads(Path(args.model).with_suffix('.json').read_text())
        if hashlib.sha256(Path(args.model).read_bytes()).hexdigest() != receipt['sha256']:
            raise ValueError('Checkpoint hash mismatch')
        model = DialogueLM.load(args.model, receipt['mix']); rows = read(args.test)
        print(json.dumps({'no_partner': evaluate(model, rows, partner=False),
                          'partner_noise': {str(r): evaluate(model, rows, r) for r in (0, .1, .2, .4, .7, 1)}}))


if __name__ == '__main__':
    main()
