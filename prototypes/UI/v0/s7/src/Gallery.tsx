/**
 * `?gallery` (with `palette=`): every Cloud face for review. One large Cloud with a button per
 * expression, Leave / Enter to watch the exit and entrance, Cycle to step through them all, and
 * every face at once below.
 */
import { useEffect, useState } from 'react';
import { Orb } from './Orb.tsx';
import { SketchFace, Strokes } from './SketchFace.tsx';
import { EXPRESSIONS, type ExpressionKind } from './expressions.ts';
import { NEGATIVE, NEUTRAL, POSITIVE } from './sentiment.ts';
import { PALETTE, PALETTES } from './variant.ts';

const GROUPS: { title: string; kinds: readonly ExpressionKind[] }[] = [
  { title: 'States', kinds: ['neutral', 'listening'] },
  { title: 'Positive', kinds: POSITIVE },
  { title: 'Negative', kinds: NEGATIVE },
  { title: 'Neutral', kinds: NEUTRAL },
];
const ALL = GROUPS.flatMap((g) => g.kinds);

export function Gallery() {
  const [kind, setKind] = useState<ExpressionKind>('neutral');
  const [visible, setVisible] = useState(true);
  const [cycle, setCycle] = useState(false);
  useEffect(() => {
    if (!cycle) return;
    const t = setInterval(() => setKind((k) => ALL[(ALL.indexOf(k) + 1) % ALL.length]), 2400);
    return () => clearInterval(t);
  }, [cycle]);
  const palette = PALETTES.find((p) => p.id === PALETTE)?.name;
  return (
    <main className="gallery">
      <header>
        <h1>Cloud · faces</h1>
        <p>{palette} palette · {ALL.length} faces: 2 states, 7 positive, 7 negative, 4 neutral</p>
      </header>
      <div className="gallery-main">
        <div className="gallery-stage">
          <div className="gallery-cloud">
            <Orb mood="idle" pulse={0} still={false} theme="light" palette={PALETTE} visible={visible}>
              <SketchFace kind={kind} visible={visible} enterDelay={260} />
            </Orb>
          </div>
        </div>
        <div className="gallery-controls">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2>{g.title}</h2>
              <div className="chips">
                {g.kinds.map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={k === kind} onClick={() => { setCycle(false); setKind(k); }}>{EXPRESSIONS[k].name}</button>
                ))}
              </div>
            </section>
          ))}
          <div className="chips">
            <button type="button" className="chip chip-strong" onClick={() => setVisible((v) => !v)}>{visible ? 'Leave (text appears)' : 'Enter (text gone)'}</button>
            <button type="button" className="chip chip-strong" aria-pressed={cycle} onClick={() => setCycle((c) => !c)}>{cycle ? 'Stop cycling' : 'Cycle all'}</button>
          </div>
        </div>
      </div>
      <section className="gallery-grid" aria-label="Every face">
        {ALL.map((k) => (
          <button key={k} type="button" className="gallery-cell" onClick={() => { setCycle(false); setKind(k); }}>
            <span className="gallery-thumb gallery-thumb-cloud"><Strokes kind={k} mode="still" /></span>
            <span>{EXPRESSIONS[k].name}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
