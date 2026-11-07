import type { Screen } from '../App';

export function Choose({ go }: { go: (screen: Screen) => void }) {
  return (
    <section className="stack">
      <h1 tabIndex={-1}>What can the voice learn from?</h1>
      <div className="choices">
        <button type="button" className="choice" onClick={() => go({ name: 'make', source: 'past' })}>
          <span className="choice-title">Recordings from before</span>
          <span className="choice-body">
            Home videos, voicemails, a talk or a toast. Anything where you speak clearly for a few
            seconds at a time. Other people in them are fine; you can leave them out.
          </span>
        </button>
        <button type="button" className="choice" onClick={() => go({ name: 'make', source: 'current' })}>
          <span className="choice-title">How I speak today</span>
          <span className="choice-body">
            Read short sentences aloud at your own pace, about a minute in all. In a 2026 study of
            voices affected by voice disorders, voices cloned this way still sounded like the
            speaker but were easier to understand than the recordings they learned from.
          </span>
        </button>
      </div>
      <p className="fine">
        You can add recordings from before to a voice made today, or make one of each and compare.
      </p>
    </section>
  );
}
