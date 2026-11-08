/**
 * First-run setup, as reports (owner concept, 2026-11-07: "the introduction page where you first
 * configure the application", in the look of a data report: a step counter, a bold section name
 * with a quiet qualifier, a row of small-caption metrics, one large figure with a bar, a chart,
 * and hairline rules).
 *
 * Backend quadrants on every page: Q1 Back (absent on the first page: a rest zone), Q4 Next or
 * Start (the one ink card), Q8 the page's own action. Q2, Q3, Q6 and Q7 are one rest zone that
 * holds the report; Q5 is a rest zone that holds a warning when there is one. The settings page
 * instead puts four settings in Q5–Q8 and keeps the report in Q2–Q3.
 *
 * Every figure is real: the eyes page counts the places the gaze engine has seen a look in since
 * the page opened, and the voice page reads the local voice service. Only the debug phase
 * `setup-voice-sample` shows sample data, and then the page says "Sample".
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { QuadrantId } from '../../shared/quadrants.ts';
import { engine } from './gaze.ts';
import type { Settings, SetupStep } from './model.ts';
import { SETUP_STEPS } from './model.ts';
import type { Slots, SlotView } from './Tile.tsx';
import { settingSlot, settingText } from './Menu.tsx';
import { longest } from './text.ts';
import { Alert, ArrowRight, Back, Check, Target, Waveform } from './icons.tsx';
import { SAMPLE_VOICE, VOICE_APP_URL, readVoices, type VoiceReport } from './voiceService.ts';

const QUADRANTS: QuadrantId[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'];
const PLACE: Record<QuadrantId, string> = {
  Q1: 'Top left', Q2: 'Top, left of centre', Q3: 'Top, right of centre', Q4: 'Top right',
  Q5: 'Bottom left', Q6: 'Bottom, left of centre', Q7: 'Bottom, right of centre', Q8: 'Bottom right',
};

export type SetupContext = {
  step: SetupStep;
  settings: Settings;
  calibratedAt: number | null;
  voice: VoiceReport;
};

const card = (action: string, label: string, icon: ReactNode, tone: 'surface' | 'ink' = 'surface', hint?: string): SlotView => ({
  action, tone, icon, bodyKey: `${action}:${label}:${hint ?? ''}`,
  body: <><span className="card-label" style={longest(label)}>{label}</span>{hint && <span className="card-hint">{hint}</span>}</>,
});

export function setupSlots(ctx: SetupContext): Slots {
  const { step, settings, voice } = ctx;
  const slots: Slots = {};
  if (step !== 'eyes') slots.q1 = card('setup-back', 'Back', <Back />);
  if (step === 'eyes') {
    slots.q4 = card('setup-next', 'Next', <ArrowRight />, 'ink');
    slots.q8 = card('setup-calibrate', ctx.calibratedAt ? 'Calibrate again' : 'Calibrate', <Target />);
  } else if (step === 'voice') {
    const ready = voice.kind === 'voice' && voice.voice.status === 'ready';
    slots.q4 = card('setup-next', ready ? 'Next' : 'Skip for now', <ArrowRight />, 'ink');
    slots.q8 = card('setup-voice-app', voice.kind === 'voice' ? 'Make a new voice' : 'Make a voice', <Waveform />);
  } else {
    slots.q4 = card('setup-start', 'Start', <Check />, 'ink');
    slots.q5 = settingSlot('textScale', settings);
    slots.q6 = settingSlot('letterDwell', settings);
    slots.q7 = settingSlot('controlDwell', settings);
    slots.q8 = settingSlot('orbMotion', settings);
  }
  return slots;
}

export function openVoiceApp(): void {
  window.open(VOICE_APP_URL, '_blank', 'noopener');
}

/** The voice report, read once per visit to the voice page (and on return to the tab). */
export function useVoiceReport(active: boolean, sample: boolean): VoiceReport {
  const [report, setReport] = useState<VoiceReport>({ kind: 'loading' });
  useEffect(() => {
    if (!active) return;
    if (sample) { setReport({ kind: 'voice', voice: SAMPLE_VOICE, sample: true }); return; }
    const controller = new AbortController();
    const load = () => { void readVoices(controller.signal).then((r) => { if (!controller.signal.aborted) setReport(r); }); };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, sample]);
  return report;
}

/** Quadrants the gaze engine has reported a look in since the eyes page opened. */
function useSeen(): Set<QuadrantId> {
  const [seen, setSeen] = useState<Set<QuadrantId>>(() => new Set());
  useEffect(() => engine.subscribe((s) => {
    const q = s.quadrant;
    if (!q) return;
    setSeen((prev) => (prev.has(q) ? prev : new Set(prev).add(q)));
  }), []);
  return seen;
}

function Counter({ step }: { step: SetupStep }) {
  const index = SETUP_STEPS.indexOf(step);
  return (
    <div className="report-counter">
      <span className="report-bars" aria-hidden="true">{SETUP_STEPS.map((s, i) => <i key={s} data-on={i <= index || undefined} />)}</span>
      <span><b>{index + 1}</b> of {SETUP_STEPS.length}</span>
    </div>
  );
}

function Heading({ name, detail }: { name: string; detail: string }) {
  return <h1 className="report-heading"><b>{name}</b><span aria-hidden="true"> · </span><span className="report-detail">{detail}</span></h1>;
}

function Metric({ caption, value, unit }: { caption: string; value: ReactNode; unit?: string }) {
  return (
    <div className="metric">
      <span className="metric-caption">{caption}</span>
      <span className="metric-value">{value}{unit && <small>{unit}</small>}</span>
    </div>
  );
}

function Figure({ value, unit, caption }: { value: ReactNode; unit?: string; caption: ReactNode }) {
  return (
    <div className="figure">
      <span className="figure-bar" aria-hidden="true" />
      <div>
        <p className="figure-value">{value}{unit && <small>{unit}</small>}</p>
        <p className="figure-caption">{caption}</p>
      </div>
    </div>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="report-note" role="note">
      <span className="report-note-title">{title}</span>
      <span className="report-note-body">{children}</span>
      <Alert />
    </aside>
  );
}

/** The 2 × 4 grid as a chart: a filled dot where a look has been seen. */
function PlacesChart({ seen }: { seen: Set<QuadrantId> }) {
  return (
    <figure className="places" aria-label={`Looks seen in ${seen.size} of 8 places`}>
      <div className="places-grid">
        {QUADRANTS.map((q) => (
          <span key={q} className="place" data-seen={seen.has(q) || undefined} title={PLACE[q]}>
            <i aria-hidden="true" />
          </span>
        ))}
      </div>
      <figcaption className="chart-caption"><span className="chart-key"><i data-seen /> Seen</span></figcaption>
    </figure>
  );
}

/**
 * Eyes: the tracking check. The metrics are settings' values (minimal-ui: no readout for a state
 * that a card already carries, so calibration shows only as Calibrate / Calibrate again in Q8).
 * The figure counts the places a look has reached and appears with the first one (no zero count);
 * the 2 × 4 map fills as the person looks around, so no sentence explains it.
 */
function EyesReport({ settings, calibratedAt }: { settings: Settings; calibratedAt: number | null }) {
  const seen = useSeen();
  return (
    <section className="report report-tall" aria-label="Eyes">
      <div className="report-upper">
        <header className="report-top"><Counter step="eyes" /><span className="report-where">Setup</span></header>
        <Heading name="Eyes" detail={calibratedAt ? 'Calibrated' : 'Tracking check'} />
        <div className="metrics">
          <Metric caption="Selection" value={settings.mode === 'click' ? 'Click' : settings.mode === 'dwell' ? 'Dwell' : 'Confirm'} />
          <Metric caption="Letter dwell" value={(settings.letterDwell / 1000).toFixed(1)} unit="s" />
          <Metric caption="Button dwell" value={(settings.controlDwell / 1000).toFixed(1)} unit="s" />
        </div>
        <div className="rule-line" aria-hidden="true"><i style={{ width: `${(seen.size / 8) * 100}%` }} /></div>
      </div>
      <div className="report-lower">
        <div className="report-column">
          {seen.size > 0 && <Figure value={seen.size} unit="of 8" caption={<b>Places seen</b>} />}
        </div>
        <PlacesChart seen={seen} />
      </div>
    </section>
  );
}

function Strip({ report }: { report: Extract<VoiceReport, { kind: 'voice' }> }) {
  const { voice } = report;
  const order = voice.order.length ? voice.order : voice.segments.map((s) => s.n);
  const byN = new Map(voice.segments.map((s) => [s.n, s]));
  const pieces = order.map((n) => byN.get(n)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const unused = voice.segments.filter((s) => !order.includes(s.n));
  // The track is two minutes wide, so the one-minute mark sits at its middle.
  const total = voice.segments.reduce((t, s) => t + s.duration, 0);
  return (
    <figure className="strip" aria-label={`${Math.round(voice.reference.seconds)} seconds of speech chosen, of the one minute recommended`}>
      <div className="strip-track">
        {[...pieces, ...unused].map((s) => (
          <i key={s.n} style={{ flex: `${s.duration} 0 0` }} data-on={s.selected || undefined} data-other={s.other_speaker || undefined} />
        ))}
        <b className="strip-rest" style={{ flex: `${Math.max(0, 120 - total)} 0 0` }} aria-hidden="true" />
        <span className="strip-mark" style={{ left: '50%' }}><span>1 min</span></span>
      </div>
      <figcaption className="chart-caption"><span>Clearest first</span><span className="chart-key"><i data-seen /> Used</span><span className="chart-key"><i /> Left out</span></figcaption>
    </figure>
  );
}

function VoiceReportView({ report }: { report: VoiceReport }) {
  let figure: ReactNode = null;
  let metrics: ReactNode;
  let rows: ReactNode = null;
  let note: ReactNode = null;
  let chart: ReactNode = <figure className="strip strip-empty" aria-hidden="true"><div className="strip-track"><span className="strip-mark" style={{ left: '50%' }}><span>1 min</span></span></div></figure>;
  if (report.kind === 'voice') {
    const v = report.voice;
    const kept = v.segments.filter((s) => s.selected);
    const others = v.segments.filter((s) => s.other_speaker).length;
    // Counts of zero are not shown (minimal-ui): a voice with no other speaker has no "Other voices" metric.
    metrics = (
      <div className="metrics">
        <Metric caption="From" value={v.source === 'past' ? 'Before' : 'Today'} />
        <Metric caption="Pieces" value={kept.length} unit={`of ${v.segments.length}`} />
        {others > 0 && <Metric caption="Other voices" value={others} />}
        <Metric caption="Status" value={v.status === 'ready' ? 'Ready' : 'Needs more'} />
      </div>
    );
    figure = <Figure value={Math.round(v.reference.seconds)} unit="s" caption={<b>Clear speech</b>} />;
    chart = <Strip report={report} />;
    rows = (
      <ul className="rows">
        {v.files.slice(0, 3).map((f) => {
          const secs = v.segments.filter((s) => s.file === f && s.selected).reduce((t, s) => t + s.duration, 0);
          const problem = v.problems.find((p) => p.file === f)?.problem;
          return (
            <li key={f}>
              <span className="row-name"><b>{f}</b></span>
              <span className="row-value">{problem ?? `${Math.round(secs)} s used`}</span>
            </li>
          );
        })}
      </ul>
    );
  } else {
    // No voice yet: one status, no placeholder dashes and no zero-second figure (minimal-ui). When the
    // local voice service is not running the corner note says so, in the report's warning spot.
    metrics = (
      <div className="metrics">
        <Metric caption="Voice" value={report.kind === 'loading' ? 'Checking' : report.kind === 'none' ? 'None yet' : 'System voice'} />
      </div>
    );
    figure = null;
    if (report.kind === 'offline') note = <Note title="Voice service">Not running</Note>;
  }
  return (
    <>
      <section className="report report-tall" aria-label="Voice">
        <div className="report-upper">
          <header className="report-top"><Counter step="voice" /><span className="report-where">Setup{report.kind === 'voice' && report.sample ? <span className="report-sample"> · Sample</span> : null}</span></header>
          <Heading name="Voice" detail={report.kind === 'voice' ? report.voice.name : 'Your recordings'} />
          {metrics}
          <div className="rule-line" aria-hidden="true"><i style={{ width: report.kind === 'voice' ? `${Math.min(100, (report.voice.reference.seconds / 60) * 100)}%` : '0%' }} /></div>
        </div>
        <div className="report-lower">
          <div className="report-column">
            {figure}
            {rows}
          </div>
          {chart}
        </div>
      </section>
      {note}
    </>
  );
}

function ReadyReport({ settings, calibratedAt, voice }: { settings: Settings; calibratedAt: number | null; voice: VoiceReport }) {
  // What setup found; the settings themselves are the cards below (Q5–Q8). A step not taken (no
  // calibration) is not reported as a negative (minimal-ui): the Eyes row appears once it is done.
  const items = [
    ...(calibratedAt ? [{ name: 'Eyes', value: 'Calibrated' }] : []),
    { name: 'Voice', value: voice.kind === 'voice' && voice.voice.status === 'ready' ? (voice.sample ? 'Sample' : 'Your voice') : 'System voice' },
    settingText('mode', settings),
    settingText('sound', settings),
  ];
  return (
    <section className="report report-short" aria-label="Ready">
      <div className="report-upper">
        <header className="report-top"><Counter step="ready" /><span className="report-where">Setup</span></header>
        <Heading name="Ready" detail="Before you start" />
        <div className="metrics">
          {items.map((i) => <Metric key={i.name} caption={i.name} value={i.value} />)}
        </div>
        <div className="rule-line" aria-hidden="true"><i style={{ width: '100%' }} /></div>
      </div>
    </section>
  );
}

export function SetupReport({ ctx }: { ctx: SetupContext }) {
  if (ctx.step === 'eyes') return <EyesReport settings={ctx.settings} calibratedAt={ctx.calibratedAt} />;
  if (ctx.step === 'voice') return <VoiceReportView report={ctx.voice} />;
  return <ReadyReport settings={ctx.settings} calibratedAt={ctx.calibratedAt} voice={ctx.voice} />;
}
