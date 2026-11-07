import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addRecordings,
  deleteVoice,
  getVoice,
  qualityWord,
  referenceUrl,
  segmentUrl,
  speak,
  updateVoice,
  type Style,
  type Voice,
} from '../api';
import { VoiceStrip } from '../components/VoiceStrip';
import { QUICK_PHRASES } from '../prompts';
import { bestFirst, MIN_REFERENCE_S, selectedSeconds } from '../strip';

interface Props {
  id: string;
  onChanged: (voice: Voice) => void;
  onDeleted: (id: string) => void;
}

const STYLE_HELP: Record<Style, string> = {
  'like-me': 'Follows the rhythm and expression of your recordings as well as their sound.',
  clearer: 'Keeps the sound of your voice with calmer, steadier delivery.',
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceScreen({ id, onChanged, onDeleted }: Props) {
  const [voice, setVoice] = useState<Voice | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [style, setStyle] = useState<Style>('like-me');
  const [speaking, setSpeaking] = useState(false);
  const [spoken, setSpoken] = useState<{ url: string; note: string } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const pieces = useRef<HTMLAudioElement>(null);

  const accept = (next: Voice) => {
    setVoice(next);
    setChosen(new Set(next.reference.segments));
    onChanged(next);
  };

  useEffect(() => {
    getVoice(id).then(accept, (e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => () => {
    if (spoken) URL.revokeObjectURL(spoken.url);
  }, [spoken]);

  const dirty = useMemo(() => {
    if (!voice) return false;
    const current = new Set(voice.reference.segments);
    return chosen.size !== current.size || [...chosen].some((n) => !current.has(n));
  }, [chosen, voice]);

  if (!voice) {
    return (
      <section className="stack">
        <h1 tabIndex={-1}>{error ? 'Voice not found' : 'Opening voice…'}</h1>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const ready = voice.status === 'ready';
  const chosenSeconds = selectedSeconds(voice.segments, chosen);

  const say = async (words: string) => {
    if (!words.trim() || !ready) return;
    setSpeaking(true);
    setError('');
    try {
      const result = await speak(voice.id, words, style);
      const note = result.cached
        ? 'Said before, so it played straight away.'
        : `Ready in ${(result.synthesisMs / 1000).toFixed(1)} s.`;
      setSpoken({ url: result.url, note });
      requestAnimationFrame(() => void player.current?.play());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpeaking(false);
    }
  };

  const playPiece = (n: number) => {
    const audio = pieces.current;
    if (!audio) return;
    if (playing === n) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.src = segmentUrl(voice, n);
    setPlaying(n);
    void audio.play();
  };

  const saveChoice = async () => {
    setSaving(true);
    setError('');
    try {
      accept(await updateVoice(voice.id, { selected: bestFirst(voice.segments, chosen) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addMore = async (files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    setError('');
    try {
      accept(await addRecordings(voice.id, Array.from(files)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <h1 tabIndex={-1}>{voice.name}</h1>

      {!ready && (
        <div className="notice" role="status">
          This voice needs at least {MIN_REFERENCE_S} seconds of clear speech from you. Add more
          recordings, or include more pieces below.
        </div>
      )}

      <div className="speak" aria-busy={speaking}>
        <label className="field">
          <span>What should your voice say?</span>
          <textarea
            value={text}
            maxLength={600}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type here"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void say(text);
              }
            }}
          />
        </label>
        <div className="phrases" aria-label="Quick phrases">
          {QUICK_PHRASES.map((phrase) => (
            <button key={phrase} type="button" className="phrase" disabled={!ready || speaking} onClick={() => void say(phrase)}>
              {phrase}
            </button>
          ))}
        </div>

        <fieldset className="segmented">
          <legend>Pacing</legend>
          {(['like-me', 'clearer'] as Style[]).map((value) => (
            <label key={value} className={style === value ? 'is-on' : ''}>
              <input type="radio" name="style" value={value} checked={style === value} onChange={() => setStyle(value)} />
              {value === 'like-me' ? 'Like my recordings' : 'Steadier'}
            </label>
          ))}
        </fieldset>
        <p className="fine">{STYLE_HELP[style]}</p>

        <button type="button" className="primary" disabled={!ready || speaking || !text.trim()} onClick={() => void say(text)}>
          {speaking ? 'Speaking…' : 'Say it'}
        </button>
        <audio ref={player} src={spoken?.url} controls className={spoken ? '' : 'hidden'} aria-label="Your voice" />
        {spoken && <p className="fine" aria-live="polite">{spoken.note}</p>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <h2>What it learned from</h2>
      {ready && <VoiceStrip voice={voice} playing={playing} onPlay={playPiece} />}
      {ready && (
        <audio controls src={referenceUrl(voice)} aria-label="All the speech this voice learned from" />
      )}
      <audio ref={pieces} onEnded={() => setPlaying(null)} className="hidden" />

      <details className="pieces">
        <summary>Choose which pieces it learns from</summary>
        <p className="fine">
          Clarte picked the clearest {voice.reference.segments.length} of {voice.segments.length} pieces it
          found. Leave out anything that isn't you or sounds unlike you; one to two minutes is ideal.
        </p>
        <ul className="piece-list">
          {voice.segments.map((segment) => (
            <li key={segment.n} className={segment.other_speaker ? 'is-other' : ''}>
              <button type="button" className="secondary small" onClick={() => playPiece(segment.n)} aria-label={`Play piece from ${segment.file} at ${clock(segment.start)}`}>
                {playing === segment.n ? 'Stop' : 'Play'}
              </button>
              <span className="piece-text">
                <span className="piece-quality">{qualityWord(segment)}</span>
                <span className="fine">
                  {segment.file}, {clock(segment.start)}, {segment.duration.toFixed(1)} s
                </span>
              </span>
              <label className="check compact">
                <input
                  type="checkbox"
                  checked={chosen.has(segment.n)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(segment.n);
                    else next.delete(segment.n);
                    setChosen(next);
                  }}
                />
                <span>Use</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="fine">{chosenSeconds.toFixed(1)} s chosen</p>
        <button type="button" className="primary" disabled={!dirty || saving} onClick={saveChoice}>
          {saving ? 'Rebuilding the voice…' : 'Use these pieces'}
        </button>
      </details>

      <label className="drop compact">
        <input type="file" multiple accept="audio/*,video/*" disabled={saving} onChange={(e) => void addMore(e.target.files)} />
        <span className="drop-title">{saving ? 'Listening…' : 'Add more recordings'}</span>
      </label>

      <div className="danger">
        {confirmDelete ? (
          <>
            <p>Delete {voice.name} and every piece of speech it kept? This can't be undone.</p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="destructive"
                onClick={() => deleteVoice(voice.id).then(() => onDeleted(voice.id), (e: Error) => setError(e.message))}
              >
                Delete voice
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="quiet" onClick={() => setConfirmDelete(true)}>
            Delete this voice
          </button>
        )}
      </div>
    </section>
  );
}
