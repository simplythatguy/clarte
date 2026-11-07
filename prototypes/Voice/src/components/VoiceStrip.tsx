import type { Voice } from '../api';
import { RECOMMENDED_S, TRACK_S, stripBlocks } from '../strip';

interface Props {
  voice: Voice;
  playing: number | null;
  onPlay: (n: number) => void;
}

// The one picture of what the voice is made from: the chosen pieces of speech
// laid end to end on a two-minute track, clearest first, against the minute
// of speech ElevenLabs recommends.
export function VoiceStrip({ voice, playing, onPlay }: Props) {
  const blocks = stripBlocks(voice);
  const marker = (RECOMMENDED_S / TRACK_S) * 100;
  const short = voice.reference.seconds < RECOMMENDED_S;
  return (
    <figure className="strip">
      <div className="strip-track" role="group" aria-label="Speech the voice was made from">
        {blocks.map((block, i) => (
          <button
            key={block.n}
            type="button"
            className={`strip-block${playing === block.n ? ' is-playing' : ''}`}
            style={{
              left: `${block.left * 100}%`,
              width: `${block.width * 100}%`,
              ['--q' as string]: block.quality.toFixed(2),
            }}
            aria-label={`Play piece ${i + 1}`}
            onClick={() => onPlay(block.n)}
          />
        ))}
        <span className="strip-marker" style={{ left: `${marker}%` }} aria-hidden="true" />
      </div>
      <figcaption className="strip-caption">
        <span>{Math.round(voice.reference.seconds)} s of speech, clearest first</span>
        <span className="strip-caption-marker" style={{ left: `${marker}%` }}>
          1 minute recommended
        </span>
      </figcaption>
      {short && (
        <p className="fine">More speech, up to about two minutes, usually makes the voice more like you.</p>
      )}
    </figure>
  );
}
