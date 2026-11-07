import type { MouseEvent } from 'react';
import type { DwellState } from '../core/dwell';
/** Four columns by two rows, in reading order. */
export const NAVIGATION_TARGETS = (['top', 'bottom'] as const).flatMap(row => [1, 2, 3, 4].map(column => ({ id: `${row}-${column}`, label: `${row === 'top' ? 'Top' : 'Bottom'} row column ${column} target` })));
export function DwellTarget({ id, label, state, preview = false, selected, activation, onClick }: {
  id: string; label: string; state: DwellState; preview?: boolean; selected: boolean; activation: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const dwelling = state.kind === 'dwelling' && state.target === id;
  return <button className={`navigation-target target-${id} ${selected ? 'is-selected' : ''} ${preview ? 'is-previewed' : ''} ${dwelling ? 'is-dwelling' : ''}`}
    data-dwell={id} data-activation={activation} aria-label={label} aria-pressed={selected} onClick={onClick} />;
}
