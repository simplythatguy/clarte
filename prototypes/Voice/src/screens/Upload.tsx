import { useState } from 'react';
import { createVoice, type Voice } from '../api';
import { NameAndConsent } from '../components/Consent';

const MAX_BYTES = 300 * 1024 * 1024;

export function Upload({ onMade }: { onMade: (voice: Voice) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = files.reduce((sum, f) => sum + f.size, 0);

  const add = (list: FileList | null) => {
    if (!list) return;
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    setFiles([...files, ...Array.from(list).filter((f) => !known.has(`${f.name}:${f.size}`))]);
  };

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      onMade(await createVoice(name.trim() || 'My voice', 'past', files));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h1 tabIndex={-1}>Add recordings from before</h1>
      <p className="lede">
        Aim for a few minutes in total. Clarte keeps the clearest minute or two of you, leaves out
        other people, and deletes the files themselves once it has listened.
      </p>

      <label className="drop">
        <input type="file" multiple accept="audio/*,video/*" onChange={(e) => add(e.target.files)} />
        <span className="drop-title">Choose recordings</span>
        <span className="drop-body">Audio or video files: phone videos, voicemails, MP3s.</span>
      </label>

      {files.length > 0 && (
        <ul className="file-list" aria-label="Chosen recordings">
          {files.map((file) => (
            <li key={`${file.name}:${file.size}`}>
              <span>{file.name}</span>
              <span className="file-size">{(file.size / 1e6).toFixed(1)} MB</span>
              <button
                type="button"
                className="quiet"
                onClick={() => setFiles(files.filter((f) => f !== file))}
                aria-label={`Remove ${file.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <NameAndConsent name={name} onName={setName} consent={consent} onConsent={setConsent} />

      {total > MAX_BYTES && <p className="error">Those files are larger than 300 MB together.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={busy || !files.length || !consent || total > MAX_BYTES}
        onClick={make}
      >
        {busy ? 'Listening to your recordings…' : 'Make my voice'}
      </button>
      {busy && (
        <p className="fine" aria-live="polite">
          This takes about as long as the recordings themselves.
        </p>
      )}
    </section>
  );
}
