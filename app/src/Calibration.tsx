/**
 * The calibration page's text. While the run goes there is none: the orb is the point to look at
 * (GuideOrb.tsx), and the onboarding card slides off to the right. When the camera fails or a run
 * does not train, the page says why; App puts Try again (Q4–Q8) and a way out (Q1) on the board.
 */
export function Calibration({ failure }: { failure: string | null }) {
  if (!failure) return null;
  return (
    <section className="thread thread-title" aria-label="Calibration">
      <p className="page-title cal-message">{failure}</p>
    </section>
  );
}
