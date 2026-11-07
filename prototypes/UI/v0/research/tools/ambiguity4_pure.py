import sys, itertools, random, time, math
from collections import defaultdict
path = sys.argv[1]; TOPN = int(sys.argv[2]); SEARCH_N = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
words, freqs = [], []
with open(path) as f:
    for line in f:
        w, c = line.rstrip('\n').split('\t')
        if w.isascii() and w.isalpha():
            words.append(w.lower()); freqs.append(int(c))
        if len(words) >= TOPN: break
total = float(sum(freqs))
alpha = 'abcdefghijklmnopqrstuvwxyz'

def table(groups):
    m = {}
    for g, letters in enumerate(groups):
        for ch in letters: m[ord(ch)] = str(g)
    return m

def evaluate(groups, ws=words, fs=freqs, detail=False):
    tb = table(groups)
    classes = defaultdict(list)
    for w, c in zip(ws, fs):
        classes[w.translate(tb)].append(c)
    tot = float(sum(fs))
    top1 = top2 = top3 = top5 = 0.0; extra = 0.0
    for cs in classes.values():
        # already sorted by freq desc because input list is sorted desc
        top1 += cs[0]; top2 += sum(cs[:2]); top3 += sum(cs[:3]); top5 += sum(cs[:5])
        extra += sum(i * c for i, c in enumerate(cs))
    out = dict(top1=top1 / tot, top2=top2 / tot, top3=top3 / tot, top5=top5 / tot,
               extra_presses_per_word=extra / tot, n_classes=len(classes))
    kl = sum(c * (len(w) + 1) for w, c in zip(ws, fs))
    out['kspc'] = (kl + extra) / kl
    if detail:
        inv = defaultdict(list)
        for w, c in zip(ws, fs): inv[w.translate(tb)].append((w, c))
        lost = sorted(((sum(c for _, c in v[1:]), v[:5]) for v in inv.values()), reverse=True)[:12]
        out['worst'] = [(m / tot, [w for w, _ in v]) for m, v in lost]
        per_len = {}
        for Lw in range(1, 11):
            mass = sum(c for w, c in zip(ws, fs) if len(w) == Lw)
            hit = 0.0
            for v in inv.values():
                if len(v[0][0]) == Lw: hit += v[0][1]
            per_len[Lw] = (hit / mass if mass else 0, mass / tot)
        out['per_len'] = per_len
    return out

def prefix_completion(groups, ks=(1, 2, 3, 4, 5, 6)):
    tb = table(groups)
    codes = [w.translate(tb) for w in words]
    res = {}
    for k in ks:
        best = {}; order = defaultdict(list)
        for w, c, code in zip(words, freqs, codes):
            p = code[:k]
            order[p].append((w, c))  # sorted desc by freq already
        mass = hit1 = hit3 = 0.0
        for p, lst in order.items():
            for i, (w, c) in enumerate(lst):
                if len(w) > k:
                    mass += c
                    if i == 0: hit1 += c
                    if i <= 2: hit3 += c
        res[k] = (hit1 / mass, hit3 / mass, mass / total)
    return res

def contiguous(cuts):
    c = [0] + list(cuts) + [26]
    return [alpha[c[i]:c[i + 1]] for i in range(4)]

user = ['abcdef', 'ghijklmn', 'opqrs', 'tuvwxyz']
print(f"N={len(words)} alphabetic tokens (top {TOPN} of Norvig count_1w.txt)")
r = evaluate(user, detail=True)
print("\n== User split A-F / G-N / O-S / T-Z ==")
for k in ('top1', 'top2', 'top3', 'top5', 'extra_presses_per_word', 'kspc'):
    print(f"  {k}: {r[k]:.4f}")
print(f"  n_classes: {r['n_classes']} (distinct gesture sequences for {len(words)} words)")
print("  worst collision classes (words by freq; frequency mass of the non-top-1 words):")
for m, ws in r['worst']: print(f"    {ws}  lost={m*100:.2f}%")
print("  top-1 accuracy by word length (len: acc, share of word mass):")
for Lw, (acc, share) in r['per_len'].items(): print(f"    {Lw}: {acc*100:.1f}%  share={share*100:.1f}%")
print("  completion after k groups (target = top-1 / top-3 among ALL words sharing the first k codes; mass = words longer than k):")
for k, (h1, h3, mass) in prefix_completion(user).items(): print(f"    k={k}: top1={h1*100:.1f}% top3={h3*100:.1f}% (mass {mass*100:.1f}%)")

sw, sf = words[:SEARCH_N], freqs[:SEARCH_N]
t0 = time.time(); res = []
for cuts in itertools.combinations(range(1, 26), 3):
    g = contiguous(cuts); rr = evaluate(g, sw, sf); res.append((rr['top1'], rr['kspc'], g))
res.sort(key=lambda x: -x[0])
rank = [i for i, b in enumerate(res) if b[2] == user][0] + 1
print(f"\n== All {len(res)} contiguous alphabetical 4-splits on top {SEARCH_N} words ({time.time()-t0:.0f}s) ==")
print(f"  user split rank: {rank} of {len(res)}; user top1 on this subset = {[b for b in res if b[2]==user][0][0]*100:.2f}%")
for t1, k, g in res[:8]: print(f"  top1={t1*100:.2f}% kspc={k:.4f}  {' / '.join(g)}")
print(f"  median top1={res[len(res)//2][0]*100:.2f}%; worst top1={res[-1][0]*100:.2f}% {' / '.join(res[-1][2])}")
for g in (['abcdef', 'ghijkl', 'mnopqrs', 'tuvwxyz'], ['abcdefg', 'hijklm', 'nopqrs', 'tuvwxyz'], ['abcde', 'fghijkl', 'mnopq', 'rstuvwxyz']):
    rr = evaluate(g); print(f"  ref (full set) {' / '.join(g)}: top1={rr['top1']*100:.2f}% kspc={rr['kspc']:.4f}")

# unconstrained local search on a smaller subset, then re-evaluate on full set
random.seed(11); t0 = time.time()
ssw, ssf = words[:6000], freqs[:6000]
def gfa(a): return [''.join(alpha[i] for i in range(26) if a[i] == g) for g in range(4)]
best = (0, None)
for restart in range(2):
    a = [random.randrange(4) for _ in range(26)]; s = evaluate(gfa(a), ssw, ssf)['top1']; T = 0.01
    for it in range(500):
        b = a[:]
        if random.random() < 0.5: b[random.randrange(26)] = random.randrange(4)
        else:
            i, j = random.sample(range(26), 2); b[i], b[j] = b[j], b[i]
        if min(b.count(g) for g in range(4)) == 0: continue
        sb = evaluate(gfa(b), ssw, ssf)['top1']
        if sb > s or random.random() < math.exp((sb - s) / T): a, s = b, sb
        T *= 0.995
    if s > best[0]: best = (s, a[:])
g = gfa(best[1]); rr = evaluate(g)
print(f"\n== Unconstrained 4-group local search ({time.time()-t0:.0f}s; heuristic, not proven optimal) ==")
print(f"  best found (re-scored on full set): top1={rr['top1']*100:.2f}% top3={rr['top3']*100:.2f}% kspc={rr['kspc']:.4f}  groups: {' / '.join(g)}  sizes={[len(x) for x in g]}")

print("\n== Best contiguous alphabetical split by group count (top 6000 words; G=3,5 exhaustive, G=6,8 hill-climb on cut positions) ==")
tw, tf = words[:6000], freqs[:6000]
def gcuts(cuts, G):
    c = [0] + sorted(cuts) + [26]; return [alpha[c[i]:c[i + 1]] for i in range(G)]
for G in (3, 5, 6, 8):
    bb = (0, None, 0)
    if G <= 5:
        for cuts in itertools.combinations(range(1, 26), G - 1):
            gg = gcuts(cuts, G); rr = evaluate(gg, tw, tf)
            if rr['top1'] > bb[0]: bb = (rr['top1'], gg, rr['kspc'])
    else:
        for restart in range(4):
            cuts = sorted(random.sample(range(1, 26), G - 1)); cur = evaluate(gcuts(cuts, G), tw, tf)['top1']
            improved = True
            while improved:
                improved = False
                for i in range(len(cuts)):
                    for d in (-1, 1):
                        nc = cuts[:]; nc[i] += d
                        if nc[i] < 1 or nc[i] > 25 or len(set(nc)) < len(nc): continue
                        v = evaluate(gcuts(nc, G), tw, tf)['top1']
                        if v > cur: cuts, cur, improved = sorted(nc), v, True
            if cur > bb[0]: gg = gcuts(cuts, G); bb = (cur, gg, evaluate(gg, tw, tf)['kspc'])
    print(f"  G={G}: top1={bb[0]*100:.2f}% kspc={bb[2]:.4f}  {' / '.join(bb[1])}", flush=True)
