import type { MouseEvent } from 'react';
import type { DwellState } from '../core/dwell';
export const NAVIGATION_TARGETS = [
  { id: 'top-left', label: 'Top left target' }, { id: 'top', label: 'Top target' }, { id: 'top-right', label: 'Top right target' },
  { id: 'left', label: 'Left target' }, { id: 'center', label: 'Center target' }, { id: 'right', label: 'Right target' },
  { id: 'bottom-left', label: 'Bottom left target' }, { id: 'bottom', label: 'Bottom target' }, { id: 'bottom-right', label: 'Bottom right target' },
];
export function DwellTarget({ id, label, state, preview = false, selected, activation, onClick }: {
  id: string; label: string; state: DwellState; preview?: boolean; selected: boolean; activation: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const dwelling = state.kind === 'dwelling' && state.target === id;
  return <button className={`navigation-target target-${id} ${selected ? 'is-selected' : ''} ${preview ? 'is-previewed' : ''} ${dwelling ? 'is-dwelling' : ''}`}
    data-dwell={id} data-activation={activation} aria-label={label} aria-pressed={selected} onClick={onClick} />;
}
