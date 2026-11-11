// phrase prediction model implementation and file using that model
/**
 * Multinomial logistic regression with a one-hot previous-phrase feature.
 * Each class is a saved phrase; the fixed intercept is its smoothed personal frequency.
 * Context coefficients minimise weighted cross-entropy + L2/2, using transition counts as
 * sufficient statistics. Independent context rows can be fitted on demand without keeping
 * a chronological transcript or introducing a model runtime. Scores are not calibrated confidence.
 */
export function predictNextPhrases(rows) {
  if (!rows.length) return [];
  const mass = rows.map((p) => p.uses + p.prior + 0.25);
  const total = mass.reduce((a, b) => a + b, 0);
  const intercept = mass.map((v) => Math.log(v / total));
  const counts = rows.map((p) => p.follows);
  const samples = counts.reduce((a, b) => a + b, 0);
  const weights = rows.map(() => 0);
  const l2 = 0.1;
  const softmax = () => {
    const logits = intercept.map((v, i) => v + weights[i]);
    const max = logits.reduce((a, b) => Math.max(a, b), -Infinity);
    const exps = logits.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
  };
  if (samples) for (let step = 0; step < 250; step++) {
    const probabilities = softmax();
    let largest = 0;
    weights.forEach((w, i) => {
      const update = (samples * probabilities[i] - counts[i] + l2 * w) / (samples + l2);
      weights[i] -= update;
      largest = Math.max(largest, Math.abs(update));
    });
    if (largest < 1e-7) break;
  }
  return softmax();
}
