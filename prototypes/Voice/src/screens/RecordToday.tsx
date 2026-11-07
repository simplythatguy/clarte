import { useCallback, useEffect, useRef, useState } from 'react';
import { createVoice, type Voice } from '../api';
import { NameAndConsent } from '../components/Consent';
import { ENOUGH_SECONDS, MINIMUM_SECONDS, PROMPTS } from '../prompts';
import { Recorder, takeToFile, type Take } from '../recorder';

const MAX_TAKE_S = 30;

export function RecordToday({ onMade }: { onMade: (voice: Voice) => void }) {
  const recorder = useRef<Recorder | null>(null);
  const [stage, setStage] = useState<'setup' | 'recording' | 'making'>('setup');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [index, setIndex] = useState(0);
  const [takes, setTakes] = useState<Record<string, Take>>({});
  const [live, setLive] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const prompt = PROMPTS[index];
  const take = takes[prompt.id];
  const seconds = Object.values(takes).reduce((sum, t) => sum + t.seconds, 0);
  const enough = seconds >= MINIMUM_SECONDS;

  useEffect(() => () => recorder.current?.close(), []);

  // Level meter and take timer while the microphone is live.
  useEffect(() => {
    if (!live) return;
    let frame = 0;
    const started = performance.now();
    const tick = () => {
      setLevel(recorder.current?.level() ?? 0);
      const s = (performance.now() - started) / 1000;
      setElapsed(s);
      if (s >= MAX_TAKE_S) void toggle();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  const begin = async () => {
    setError('');
    try {
      recorder.current = new Recorder();
      await recorder.current.open();
      setStage('recording');
    } catch {
      setError('Clarte needs the microphone. Allow it in the browser, then try again.');
    }
  };

  const toggle = useCallback(async () => {
    const r = recorder.current;
    if (!r) return;
    if (r.recording) {
      const next = await r.stop();
      setLive(false);
      setLevel(0);
      if (next.seconds < 0.6) return; // a stray tap, not a take
      setTakes((all) => {
        if (all[prompt.id]) URL.revokeObjectURL(all[prompt.id].url);
        return { ...all, [prompt.id]: next };
      });
    } else {
      r.start();
      setElapsed(0);
      setLive(true);
    }
  }, [prompt.id]);

  // Space starts and stops recording anywhere except text fields: one large
  // key is easier than a pointer for many people with tremor.
  useEffect(() => {
    if (stage !== 'recording') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.code !== 'Space' || event.repeat || target.closest('input, textarea, button')) return;
      event.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, toggle]);

  const move = (step: number) => {
    if (live) return;
    setIndex((i) => Math.min(PROMPTS.length - 1, Math.max(0, i + step)));
  };

  const make = async () => {
    setStage('making');
    setError('');
    recorder.current?.close();
    const files = PROMPTS.filter((p) => takes[p.id]).map((p) => takeToFile(takes[p.id], p.id));
    try {
      onMade(await createVoice(name.trim() || 'My voice', 'current', files));
    } catch (e) {
      setError((e as Error).message);
      setStage('recording');
      recorder.current = new Recorder();
      await recorder.current.open().catch(() => undefined);
    }
  };

  if (stage === 'setup') {
    return (
      <section className="stack">
        <h1 tabIndex={-1}>Record how you speak today</h1>
        <p className="lede">
          You'll see short sentences one at a time. Say each one at your own pace; there's no time
          limit, and you can redo or skip any of them. About a minute of speech in all works best.
        </p>
        <NameAndConsent name={name} onName={setName} consent={consent} onConsent={setConsent} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="primary" disabled={!consent} onClick={begin}>
          Turn on the microphone
        </button>
        <p className="fine">A quiet room helps most. Sit as you usually do when you talk.</p>
      </section>
    );
  }

  return (
    <section className="stack record">
      <div className="record-progress" aria-label={`Recorded ${Math.round(seconds)} of ${ENOUGH_SECONDS} seconds`}>
        <div className="record-progress-fill" style={{ width: `${Math.min(1, seconds / ENOUGH_SECONDS) * 100}%` }} />
      </div>
      <p className="fine">
        Sentence {index + 1} of {PROMPTS.length}, {Math.round(seconds)} s recorded
      </p>

      <h1 tabIndex={-1} className="prompt">{prompt.text}</h1>
      {prompt.hint && <p className="lede">{prompt.hint}</p>}

      <button
        type="button"
        className={`record-button${live ? ' is-live' : ''}`}
        onClick={() => void toggle()}
        disabled={stage === 'making'}
        style={{ ['--level' as string]: level.toFixed(2) }}
      >
        <span className="record-dot" aria-hidden="true" />
        {live ? `Stop (${Math.floor(elapsed)} s)` : take ? 'Record again' : 'Record'}
      </button>
      <p className="fine">Or press the space bar.</p>

      {take && !live && (
        <div className="take">
          <audio controls src={take.url} aria-label="Your recording of this sentence" />
          <span className="fine">{take.seconds.toFixed(1)} s</span>
        </div>
      )}

      <div className="row">
        <button type="button" className="secondary" onClick={() => move(-1)} disabled={index === 0 || live}>
          Back
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => move(1)}
          disabled={index === PROMPTS.length - 1 || live}
        >
          {take ? 'Next sentence' : 'Skip this one'}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={!enough || live || stage === 'making'}
        onClick={make}
      >
        {stage === 'making' ? 'Making your voice…' : enough ? 'Make my voice' : `Record ${Math.ceil(MINIMUM_SECONDS - seconds)} s more to continue`}
      </button>
    </section>
  );
}
