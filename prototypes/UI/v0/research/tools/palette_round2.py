"""Round 2: derive per-theme variants that meet WCAG 1.4.11 (3:1 non-text) on the
theme background, then re-check CVD separation and APCA. Imports round-1 helpers."""
import importlib.util, sys
spec = importlib.util.spec_from_file_location('pc', 'palette_check.py')
pc = importlib.util.module_from_spec(spec); spec.loader.exec_module(pc)

def adjust_for_bg(h, bg, target=3.0, toward=None):
    """Mix toward black (light bg) or white (dark bg) in linear light until WCAG >= target."""
    if toward is None:
        toward = '#000000' if pc.wcag_lum(bg) > 0.5 else '#FFFFFF'
    t = 0.0
    cur = h
    while pc.wcag_ratio(cur, bg) < target and t < 0.95:
        t += 0.01
        cur = pc.mix(h, toward, t)
    return cur

def summarize(name, cols, bg):
    print('-' * 90)
    print('%s  on %s' % (name, bg))
    print('  hex: %s   L*: %s' % (' '.join(cols), ' '.join('%.0f' % pc.hex_to_lab(c)[0] for c in cols)))
    print('  WCAG vs bg: %s' % ' '.join('%.2f' % pc.wcag_ratio(c, bg) for c in cols))
    print('  APCA Lc as text vs bg: %s' % ' '.join('%.0f' % pc.apca_lc(c, bg) for c in cols))
    for k in ['normal', 'protan 1.0', 'deutan 1.0', 'tritan 1.0', 'protan 0.5', 'deutan 0.5']:
        sim = cols if k == 'normal' else [pc.simulate(c, k) for c in cols]
        d, pair = pc.pairwise_min(sim)
        print('  min dE00 %-11s %5.1f  pair G%d/G%d' % (k, d, pair[0], pair[1]))

BASES = {
    'P1 Okabe-Ito core': ['#0072B2', '#E69F00', '#009E73', '#CC79A7'],
    'E1 lightness-stepped': ['#1F3BAE', '#1D8E5A', '#CF86D4', '#F2B52E'],
    'E2 lightness-stepped (more L spread)': ['#172F93', '#1A8757', '#D592DD', '#F6C651'],
    'E3 stepped, warm rose instead of orchid': ['#1F3BAE', '#1D8E5A', '#E8789E', '#F2B52E'],
    'E4 stepped, teal G2': ['#1F3BAE', '#0F8F8A', '#CF86D4', '#F2B52E'],
}
for name, cols in BASES.items():
    print('=' * 90); print(name, 'base:', ' '.join(cols))
    light = [adjust_for_bg(c, '#FFFFFF') for c in cols]
    dark = [adjust_for_bg(c, '#121212') for c in cols]
    summarize('  light-theme variant (>=3:1 on white)', light, '#FFFFFF')
    summarize('  dark-theme variant (>=3:1 on #121212)', dark, '#121212')
    # light theme: tint fill + full bar; what tint keeps dE between tints >= 8 for normal vision?
    for tfrac in (0.6, 0.7):
        tints = [pc.mix(c, '#FFFFFF', tfrac) for c in light]
        d, pair = pc.pairwise_min(tints)
        dp, _ = pc.pairwise_min([pc.simulate(c, 'deutan 1.0') for c in tints])
        ink = min(pc.apca_lc('#111111', t) for t in tints)
        print('  light tints @%.0f%% white: %s  min dE00 normal %.1f, deutan %.1f, worst ink Lc %.0f' % (tfrac*100, ' '.join(tints), d, dp, ink))
    for tfrac in (0.55, 0.65):
        tints = [pc.mix(c, '#121212', tfrac) for c in dark]
        d, pair = pc.pairwise_min(tints)
        dp, _ = pc.pairwise_min([pc.simulate(c, 'deutan 1.0') for c in tints])
        wh = min(abs(pc.apca_lc('#F5F5F5', t)) for t in tints)
        print('  dark tints @%.0f%% #121212: %s  min dE00 normal %.1f, deutan %.1f, worst #F5F5F5-text Lc %.0f' % (tfrac*100, ' '.join(tints), d, dp, wh))
