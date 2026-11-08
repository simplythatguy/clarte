/**
 * Variants of an enrolment take: the same sound a little faster and slower (±4 %, which also moves
 * its pitch by about ±0.7 semitones). A person never makes their sound exactly the same way twice;
 * the variants let a few takes cover that spread, as data augmentation does for few-shot keyword
 * spotting.
 */
function resample(x: Float32Array, factor: number): Float32Array {
  const n = Math.floor(x.length / factor), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * factor, j = Math.floor(p), f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? 0) * f;
  }
  return out;
}

export function variants(take: Float32Array): Float32Array[] {
  return [take, resample(take, 1.04), resample(take, 0.96)];
}
