/**
 * Style 7 has one variation: the palette, from the URL (`?palette=`), never from saved settings.
 *
 * - `soft`: style 6's faded tints (the default).
 * - `vibrant`: solid bright letter cards with white letters, a stronger orb, darker greys.
 *
 * `s_all` opens each as its own entry (S7 and S7V).
 */
export type PaletteKind = 'soft' | 'vibrant';

export const PALETTES: { id: PaletteKind; name: string }[] = [
  { id: 'soft', name: 'Soft' },
  { id: 'vibrant', name: 'Vibrant' },
];

const requested = new URLSearchParams(location.search).get('palette');
export const PALETTE: PaletteKind = (PALETTES.find((p) => p.id === requested) ?? PALETTES[0]).id;

document.documentElement.dataset.palette = PALETTE;
