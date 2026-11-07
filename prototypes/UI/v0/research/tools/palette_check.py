"""Verify candidate 4-colour group palettes for Clarte (G1..G4).

Pure Python (no numpy). Checks:
  * CVD simulation with the Machado, Oliveira & Fernandes (2009) matrices
    (severity 1.0 and 0.5), applied in LINEAR RGB as the colorspace R
    package does since 2.1-0 (the paper's matrices are linear transforms).
  * Pairwise CIEDE2000 (Sharma, Wu & Dalal 2005) between the four colours
    for normal vision and each simulated deficiency.
  * WCAG 2.x contrast ratio and APCA Lc (APCA-W3 0.0.98G-4g constants)
    for each colour used as text / underline against light and dark
    backgrounds, and for near-black / white text on each colour used as a
    token fill, plus on light/dark tints of each colour.

Run:  python3 -I palette_check.py
"""

import math

# ---------- colour conversions ----------

def hex_to_rgb01(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def rgb01_to_hex(rgb):
    return '#%02X%02X%02X' % tuple(int(round(max(0.0, min(1.0, c)) * 255)) for c in rgb)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def lin_rgb(h):
    return tuple(srgb_to_linear(c) for c in hex_to_rgb01(h))


def matmul3(m, v):
    return tuple(sum(m[r][c] * v[c] for c in range(3)) for r in range(3))


def lin_to_xyz(rgb):
    m = ((0.4124564, 0.3575761, 0.1804375),
         (0.2126729, 0.7151522, 0.0721750),
         (0.0193339, 0.1191920, 0.9503041))
    return matmul3(m, rgb)


def xyz_to_lab(xyz):
    xn, yn, zn = 0.95047, 1.0, 1.08883
    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29
    fx, fy, fz = f(xyz[0] / xn), f(xyz[1] / yn), f(xyz[2] / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def hex_to_lab(h):
    return xyz_to_lab(lin_to_xyz(lin_rgb(h)))


# ---------- Machado et al. 2009 matrices (row-major, from the authors' page) ----------

MACHADO = {
    'protan 1.0': ((0.152286, 1.052583, -0.204868),
                   (0.114503, 0.786281, 0.099216),
                   (-0.003882, -0.048116, 1.051998)),
    'deutan 1.0': ((0.367322, 0.860646, -0.227968),
                   (0.280085, 0.672501, 0.047413),
                   (-0.011820, 0.042940, 0.968881)),
    'tritan 1.0': ((1.255528, -0.076749, -0.178779),
                   (-0.078411, 0.930809, 0.147602),
                   (0.004733, 0.691367, 0.303900)),
    'protan 0.5': ((0.458064, 0.679578, -0.137642),
                   (0.092785, 0.846313, 0.060902),
                   (-0.007494, -0.016807, 1.024301)),
    'deutan 0.5': ((0.547494, 0.607765, -0.155259),
                   (0.181692, 0.781742, 0.036566),
                   (-0.010410, 0.027275, 0.983136)),
    'tritan 0.5': ((1.017277, 0.027029, -0.044306),
                   (-0.006113, 0.958479, 0.047634),
                   (0.006379, 0.248708, 0.744913)),
}


def simulate(h, kind):
    lin = lin_rgb(h)
    sim = matmul3(MACHADO[kind], lin)
    sim = tuple(max(0.0, min(1.0, c)) for c in sim)
    return rgb01_to_hex(tuple(linear_to_srgb(c) for c in sim))


# ---------- CIEDE2000 ----------

def ciede2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    kL = kC = kH = 1.0
    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    def hp(a, b):
        if a == 0 and b == 0:
            return 0.0
        h = math.degrees(math.atan2(b, a))
        return h + 360 if h < 0 else h
    h1p, h2p = hp(a1p, b1), hp(a2p, b2)
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0:
        dhp = 0.0
    else:
        d = h2p - h1p
        if d > 180:
            d -= 360
        elif d < -180:
            d += 360
        dhp = d
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    else:
        s = h1p + h2p
        if abs(h1p - h2p) > 180:
            hbp = (s + 360) / 2 if s < 360 else (s - 360) / 2
        else:
            hbp = s / 2
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dtheta = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    SL = 1 + (0.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    SC = 1 + 0.045 * Cbp
    SH = 1 + 0.015 * Cbp * T
    RT = -math.sin(math.radians(2 * dtheta)) * RC
    return math.sqrt((dLp / (kL * SL)) ** 2 + (dCp / (kC * SC)) ** 2 + (dHp / (kH * SH)) ** 2
                     + RT * (dCp / (kC * SC)) * (dHp / (kH * SH)))


# ---------- contrast ----------

def wcag_lum(h):
    r, g, b = lin_rgb(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def wcag_ratio(fg, bg):
    l1, l2 = wcag_lum(fg), wcag_lum(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def apca_y(h):
    r, g, b = hex_to_rgb01(h)
    y = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.0721750 * b ** 2.4
    if y < 0.022:
        y += (0.022 - y) ** 1.414
    return y


def apca_lc(txt, bg):
    """APCA-W3 0.0.98G-4g. Positive Lc = dark text on light bg; negative = light on dark."""
    ytxt, ybg = apca_y(txt), apca_y(bg)
    if ybg > ytxt:
        sapc = (ybg ** 0.56 - ytxt ** 0.57) * 1.14
        return 0.0 if sapc < 0.1 else (sapc - 0.027) * 100
    sapc = (ybg ** 0.65 - ytxt ** 0.62) * 1.14
    return 0.0 if sapc > -0.1 else (sapc + 0.027) * 100


def mix(h, other, t):
    """Mix in linear light: t fraction of `other`."""
    a, b = lin_rgb(h), lin_rgb(other)
    return rgb01_to_hex(tuple(linear_to_srgb(a[i] * (1 - t) + b[i] * t) for i in range(3)))


# ---------- evaluation ----------

LIGHT_BG = '#FFFFFF'
LIGHT_BG2 = '#F4F3EF'   # warm off-white (Rello & Bigham 2017 favour warm, not pure white)
DARK_BG = '#121212'
DARK_BG2 = '#1C1C1E'
INK = '#111111'
PAPER = '#FFFFFF'

PALETTES = {
    'A  Okabe-Ito core (blue, orange, bluish green, reddish purple)':
        ['#0072B2', '#E69F00', '#009E73', '#CC79A7'],
    'A2 Okabe-Ito with sky blue':
        ['#56B4E9', '#E69F00', '#009E73', '#CC79A7'],
    'B  Tol vibrant (blue, orange, teal, magenta)':
        ['#0077BB', '#EE7733', '#009988', '#EE3377'],
    'B2 Tol bright (blue, yellow, green, purple)':
        ['#4477AA', '#CCBB44', '#228833', '#AA3377'],
    'C  Lightness-stepped custom (indigo L~40, teal L~57, rose L~62, amber L~78)':
        ['#3A4ED8', '#0F8F78', '#E0588F', '#F0A41B'],
    'D  Lightness-stepped custom 2 (navy L~35, green L~55, orchid L~60, gold L~80)':
        ['#2B49C2', '#1D8E5A', '#C85CC6', '#F2B52E'],
}

KINDS = ['normal', 'protan 1.0', 'deutan 1.0', 'tritan 1.0', 'protan 0.5', 'deutan 0.5', 'tritan 0.5']


def pairwise_min(cols):
    labs = [hex_to_lab(c) for c in cols]
    worst = (999, None)
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            d = ciede2000(labs[i], labs[j])
            if d < worst[0]:
                worst = (d, (i + 1, j + 1))
    return worst


def report_palette(name, cols):
    print('=' * 100)
    print(name)
    print('  colours:', ' '.join(cols), ' L*:', ' '.join('%.0f' % hex_to_lab(c)[0] for c in cols))
    print('  Min pairwise dE00 (worst pair) per vision type, full colours:')
    for k in KINDS:
        sim = cols if k == 'normal' else [simulate(c, k) for c in cols]
        d, pair = pairwise_min(sim)
        print('    %-11s %5.1f  pair G%d/G%d   simulated: %s' % (k, d, pair[0], pair[1], ' '.join(sim)))
    # tints for token fills
    light_tints = [mix(c, PAPER, 0.78) for c in cols]
    dark_tints = [mix(c, DARK_BG, 0.72) for c in cols]
    print('  Light-theme token tints (78%% white in linear light): %s' % ' '.join(light_tints))
    for k in ['normal', 'protan 1.0', 'deutan 1.0', 'tritan 1.0']:
        sim = light_tints if k == 'normal' else [simulate(c, k) for c in light_tints]
        d, pair = pairwise_min(sim)
        print('    tint dE00 %-11s %5.1f  pair G%d/G%d' % (k, d, pair[0], pair[1]))
    print('  Dark-theme token tints (72%% #121212): %s' % ' '.join(dark_tints))
    for k in ['normal', 'protan 1.0', 'deutan 1.0', 'tritan 1.0']:
        sim = dark_tints if k == 'normal' else [simulate(c, k) for c in dark_tints]
        d, pair = pairwise_min(sim)
        print('    tint dE00 %-11s %5.1f  pair G%d/G%d' % (k, d, pair[0], pair[1]))
    print('  Contrast of full colour as TEXT/UNDERLINE (WCAG ratio | APCA Lc):')
    print('    %-9s %-18s %-18s %-18s %-18s' % ('', 'on #FFFFFF', 'on #F4F3EF', 'on #121212', 'on #1C1C1E'))
    for i, c in enumerate(cols):
        row = []
        for bg in (LIGHT_BG, LIGHT_BG2, DARK_BG, DARK_BG2):
            row.append('%4.2f:1 | Lc %6.1f' % (wcag_ratio(c, bg), apca_lc(c, bg)))
        print('    G%d %s  %s' % (i + 1, c, '  '.join(row)))
    print('  Ink #111111 text on full colour fill / on light tint; white text on full colour / on dark tint (APCA Lc):')
    for i, c in enumerate(cols):
        print('    G%d  ink on fill %6.1f | ink on light tint %6.1f (%s) | white on fill %6.1f | white on dark tint %6.1f (%s)' % (
            i + 1, apca_lc(INK, c), apca_lc(INK, light_tints[i]), light_tints[i],
            apca_lc(PAPER, c), apca_lc(PAPER, dark_tints[i]), dark_tints[i]))


if __name__ == '__main__':
    # sanity checks
    assert abs(wcag_ratio('#000000', '#FFFFFF') - 21.0) < 0.01
    lc = apca_lc('#000000', '#FFFFFF')
    print('sanity: APCA Lc black-on-white = %.1f (expected ~106), white-on-black = %.1f (expected ~-108)' % (lc, apca_lc('#FFFFFF', '#000000')))
    print('sanity: dE00 between #0072B2 and #E69F00 = %.1f' % ciede2000(hex_to_lab('#0072B2'), hex_to_lab('#E69F00')))
    print('sanity: pure red #FF0000 under protan 1.0 ->', simulate('#FF0000', 'protan 1.0'), '(expect dark olive/brown)')
    for name, cols in PALETTES.items():
        report_palette(name, cols)
