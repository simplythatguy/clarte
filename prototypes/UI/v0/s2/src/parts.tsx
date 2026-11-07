import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GroupId } from '../../shared/decoder.ts';
import { Icon, type IconName } from './icons.tsx';

export type Quadrant = 'q1' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8';
export const QUADRANT_ORDER: readonly Quadrant[] = ['q1', 'q4', 'q5', 'q6', 'q7', 'q8'];

/** One actionable card. `id` is the backend action; `contentKey` changes cross-fade the label. */
export type TileSpec = {
  q: Quadrant;
  id: string;
  kind: 'group' | 'control' | 'primary' | 'setting';
  group?: GroupId;
  label: string;
  enabled: boolean;
  contentKey: string;
  content: ReactNode;
};

/**
 * Keeps the previous children on screen for a short opacity exit while the new ones enter, both in
 * the same grid cell, so a change is a cross-fade in place and nothing moves. A label change is
 * 150 ms out and 150 ms in; a phase or page change (`phase`) is 150 ms out and 300 ms in starting
 * at 100 ms (MOTION.md "Phase or page change"). The first render does not animate.
 */
export function CrossFade({ id, children, className = '', phase = false }: { id: string; children: ReactNode; className?: string; phase?: boolean }) {
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  // Only a layer created by a change enters with a fade; the first content never animates, and an
  // existing layer never gains the class later (which would replay its fade on any re-render).
  const changed = useRef(false);
  if (last.current.id !== id) changed.current = true;
  const [exiting, setExiting] = useState<{ id: string; node: ReactNode; phase: boolean } | null>(null);
  useLayoutEffect(() => {
    if (last.current.id !== id) setExiting({ ...last.current, phase });
    last.current = { id, node: children };
  });
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(null), 160);
    return () => window.clearTimeout(timer);
  }, [exiting]);
  return (
    <span className={`xf ${className}`}>
      {exiting && exiting.id !== id && <span key={`out-${exiting.id}`} className={`xf-layer xf-out${exiting.phase ? ' xf-out--phase' : ''}`} aria-hidden="true">{exiting.node}</span>}
      <span key={id} className={`xf-layer${changed.current ? ` xf-in${phase ? ' xf-in--phase' : ''}` : ''}`}>{children}</span>
    </span>
  );
}

/**
 * `held`: the quadrant of the control just selected by gaze. Its new occupant (Menu's "More" after
 * "Menu", Listen after Done) is out of the actionable set until gaze leaves the quadrant, so a
 * look that is still resting there cannot chain into a second selection. Looks the same; only the
 * gaze engine ignores it (`aria-disabled` is what the shared collector excludes).
 */
export function Tile({ spec, held, phaseKey, onActivate }: { spec: TileSpec; held: boolean; phaseKey: string; onActivate: (id: string) => void }) {
  // The button is keyed by quadrant so its face persists across screens; when its action changes,
  // drop any dwell state the painter set for the previous action (round 2: a stale solid ring).
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) delete el.dataset.dwell;
  }, [spec.id]);
  // A screen or page change cross-fades as one phase (MOTION.md); a label change within a screen is
  // the short label cross-fade.
  const lastPhase = useRef(phaseKey);
  const phase = lastPhase.current !== phaseKey;
  useEffect(() => { lastPhase.current = phaseKey; });
  const kind = spec.kind === 'group' ? `tile--group ${spec.group?.toLowerCase()}` : `tile--${spec.kind}`;
  return (
    <button
      ref={ref}
      type="button"
      className={`tile ${spec.q} ${kind}`}
      data-action={spec.id}
      data-held={held ? '' : undefined}
      aria-label={spec.label}
      aria-disabled={held ? 'true' : undefined}
      disabled={!spec.enabled}
      onClick={() => onActivate(spec.id)}
    >
      <CrossFade id={`${phaseKey}/${spec.contentKey}`} className="tile-body" phase={phase}>{spec.content}</CrossFade>
    </button>
  );
}

/**
 * The dwell ring: a 1.5 px track at 30% of the card's ink, and an accent arc that closes clockwise
 * from 12 o'clock. The arc is two half-discs that rotate (transform only) under a static ring mask,
 * so filling it is compositor work, not paint (MOTION.md acceptance 8). The bloom is a copy of the
 * ring for the commit. Sizes are rendered 1:1 with the viewBox so strokes stay exact.
 */
export function Ring({ size }: { size: number }) {
  const r = size / 2 - 1.5;
  return (
    <span className="ringwrap" style={{ width: size, height: size }}>
      <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} />
      </svg>
      <span className="arcbox" aria-hidden="true">
        <span className="arc-r"><span className="arc-a" /></span>
        <span className="arc-l"><span className="arc-b" /></span>
      </span>
    </span>
  );
}

/** CSS that drives an arc to empty or full: half A sweeps 12 → 6 o'clock, then half B 6 → 12. */
export function arcRule(scope: string, to: 0 | 1, ms: number, timing: string, reduced = false): string {
  const half = Math.round(ms / 2);
  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const show = `${scope} .arc-a,${scope} .arc-b{opacity:1}`;
  if (reduced) {
    // Reduced motion: the ring never rotates. The full arc fades in by four opacity steps over the
    // dwell and fades out on cancel (MOTION.md "Reduced motion").
    const full = `${scope} .arc-a{transform:rotate(225deg);transition:none}${scope} .arc-b{transform:rotate(405deg);transition:none}${show}`;
    return to === 1
      ? `${full}${scope} .arcbox{opacity:1;transition:opacity ${ms}ms steps(4, end)}`
      : `${full}${scope} .arcbox{opacity:0;transition:opacity ${ms}ms ${ease}}`;
  }
  // Rest angles are 45° (A) and 225° (B); full is 180° further. Transform only, so the compositor
  // runs it and a cancel retargets from the current angle.
  if (to === 1) {
    return `${scope} .arc-a{transform:rotate(225deg);transition:transform ${half}ms ${timing}}`
      + `${scope} .arc-b{transform:rotate(405deg);transition:transform ${half}ms ${timing} ${half}ms}${show}`;
  }
  // Drain in reverse order, B (6 → 12) before A (12 → 6), so one arc shrinks back to 12 o'clock.
  return `${scope} .arc-b{transform:rotate(225deg);transition:transform ${half}ms ${ease}}`
    + `${scope} .arc-a{transform:rotate(45deg);transition:transform ${half}ms ${ease} ${half}ms}${show}`;
}

/** Dice pips on the identity dot: one to four, so group order reads without colour. */
const PIPS: Record<GroupId, [number, number][]> = {
  G1: [[50, 50]],
  G2: [[32, 32], [68, 68]],
  G3: [[27, 27], [50, 50], [73, 73]],
  G4: [[32, 32], [68, 32], [32, 68], [68, 68]],
};

/** The group's letters, the only text on its card, split into halves so 200% text wraps 4 + 4. */
export function GroupContent({ group, letters }: { group: GroupId; letters: string }) {
  const chars = letters.replace(/\s+/g, '').split('');
  const half = Math.ceil(chars.length / 2);
  return (
    <span className="stack stack--group">
      <span className="letters">
        <span className="half">{chars.slice(0, half).map((ch, i) => <Fragment key={ch}>{i > 0 && ' '}<span>{ch}</span></Fragment>)}</span>{' '}
        <span className="half">{chars.slice(half).map((ch, i) => <Fragment key={ch}>{i > 0 && ' '}<span>{ch}</span></Fragment>)}</span>
      </span>
      <span className="orbs" aria-hidden="true">
        <span className="id-dot">{PIPS[group].map(([x, y], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />)}</span>
        <Ring size={48} />
      </span>
    </span>
  );
}

/**
 * A label that enlarges with the text size but never breaks inside a word: each word is unbreakable,
 * and if the widest word is wider than the card, the label's size comes down until it fits (round 3:
 * "Recalibr / ate" at 200%). Writes only when the fitted size changes.
 */
export function FitText({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const tile = el?.closest<HTMLElement>('.tile');
    if (!el || !tile) return;
    const pad = parseFloat(getComputedStyle(tile).paddingLeft) || 0;
    const avail = tile.clientWidth - 2 * pad;
    const widest = () => Math.max(0, ...Array.from(el.querySelectorAll<HTMLElement>('.fw'), (w) => w.getBoundingClientRect().width));
    for (let pass = 0; pass < 2; pass++) {
      const current = parseFloat(getComputedStyle(el).fontSize);
      const ratio = avail / Math.max(1, widest());
      if (ratio < 1) { el.style.fontSize = `${Math.floor(current * ratio * 0.98)}px`; break; }
      if (el.style.fontSize && ratio > 1.04) { el.style.fontSize = ''; continue; }
      break;
    }
  });
  return (
    <span ref={ref} className={className}>
      {text.split(/\s+/).map((w, i) => <Fragment key={i}>{i > 0 && ' '}<span className="fw">{w}</span></Fragment>)}
    </span>
  );
}

export function ControlContent({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="stack">
      <span className="mark"><Ring size={64} /><Icon name={icon} /></span>
      <FitText className="clabel" text={label} />
    </span>
  );
}

export function CandidateContent({ word }: { word: string | null }) {
  return (
    <span className="stack">
      <span className="mark"><Ring size={64} /><Icon name="check" /></span>
      <FitText className={word ? 'candidate' : 'clabel'} text={word ?? 'No word'} />
    </span>
  );
}

export function SettingContent({ name, value }: { name: string; value: string }) {
  return (
    <span className="stack">
      <span className="mark" aria-hidden="true"><Ring size={48} /></span>
      <FitText className="sname" text={name} />{' '}
      <FitText className="svalue" text={value} />
    </span>
  );
}

export function PhraseContent({ text }: { text: string }) {
  return (
    <span className="stack">
      <span className="mark" aria-hidden="true"><Ring size={48} /></span>
      <FitText className="phrase" text={text} />
    </span>
  );
}

