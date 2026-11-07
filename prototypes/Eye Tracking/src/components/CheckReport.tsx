import type { CheckSummary } from '../core/check-report';

const round = (v: number | null) => (v === null ? '—' : String(Math.round(v)));
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;

/** Aggregated results of the last free-flow check. Numbers are screen pixels. */
export function CheckReport({ summary }: { summary: CheckSummary }) {
  const { width, height } = summary.viewport;
  const mapWidth = 320, scale = mapWidth / width, mapHeight = Math.round(height * scale);
  return <div className="check-report">
    <p className="check-summary">
      Median error <strong>{round(summary.medianPx)} px</strong>, 90th percentile <strong>{round(summary.p90Px)} px</strong>, from {summary.bins} samples on {summary.references} references ({Math.round(summary.coverage * 100)}% coverage){summary.condition === 'turn' ? ', head turned' : ''}.
    </p>
    {summary.notes.map(note => <p key={note} className="check-note">{note}</p>)}
    {summary.models.length > 0 && <table className="check-table">
      <caption>How each correction model would score on this check (held-out, lower is better)</caption>
      <thead><tr><th scope="col">Model</th><th scope="col">Median</th><th scope="col">90th pct</th></tr></thead>
      <tbody>{summary.models.map(m => <tr key={m.model} className={m.best ? 'is-best' : ''}><th scope="row">{m.label}{m.best ? ' ★' : ''}</th><td>{round(m.medianPx)}</td><td>{round(m.p90Px)}</td></tr>)}</tbody>
    </table>}
    {summary.offsets.length > 0 && <>
      <svg className="check-map" viewBox={`0 0 ${mapWidth} ${mapHeight}`} width={mapWidth} height={mapHeight} role="img" aria-label="Where the pointer landed relative to each reference">
        <rect x=".5" y=".5" width={mapWidth - 1} height={mapHeight - 1} fill="none" stroke="currentColor" strokeOpacity=".4" />
        {summary.offsets.map((o, i) => {
          const x = o.x * scale, y = o.y * scale, ex = x + o.dx * scale * 3, ey = y + o.dy * scale * 3;
          return <g key={i}><circle cx={x} cy={y} r="3.5" fill="#1c5e9e" /><line x1={x} y1={y} x2={ex} y2={ey} stroke="#b3261e" strokeWidth="2" /><circle cx={ex} cy={ey} r="2.5" fill="#b3261e" /></g>;
        })}
      </svg>
      <p className="check-legend">Blue: reference. Red: where the pointer sat, drawn 3× exaggerated.</p>
      <table className="check-table">
        <caption>Offset at each reference</caption>
        <thead><tr><th scope="col">Reference (x, y)</th><th scope="col">Pointer offset (dx, dy)</th><th scope="col">Samples</th></tr></thead>
        <tbody>{summary.offsets.map((o, i) => <tr key={i}><td>{Math.round(o.x)}, {Math.round(o.y)}</td><td>{signed(o.dx)}, {signed(o.dy)}</td><td>{o.samples}</td></tr>)}</tbody>
      </table>
      <table className="check-table">
        <caption>Average offset by screen half</caption>
        <thead><tr><th scope="col">Region</th><th scope="col">dx</th><th scope="col">dy</th></tr></thead>
        <tbody>{summary.regions.map(r => <tr key={r.name}><th scope="row">{r.name}</th><td>{signed(r.dx)}</td><td>{signed(r.dy)}</td></tr>)}</tbody>
      </table>
    </>}
  </div>;
}
