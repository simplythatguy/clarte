interface Props {
  name: string;
  onName: (name: string) => void;
  consent: boolean;
  onConsent: (consent: boolean) => void;
}

export function NameAndConsent({ name, onName, consent, onConsent }: Props) {
  return (
    <div className="stack-tight">
      <label className="field">
        <span>Name for this voice</span>
        <input
          value={name}
          maxLength={60}
          onChange={(e) => onName(e.target.value)}
          placeholder="My voice"
          autoComplete="off"
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} />
        <span>
          These recordings are of my own voice, or I'm authorized to make this voice for the person
          speaking in them. I agree that the clearest speech is sent to ElevenLabs to make the
          voice.
        </span>
      </label>
    </div>
  );
}
