import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_FORMAT, readCandidate } from '../src/lab/candidate';
import { ESTIMATOR_SHAPES, readLearnedCalibration } from '../src/core/saved-calibration';

// Candidates written by `node analysis/rerun_head.mjs <session> --export "<variant>"` must load through the same readers
// the Setup screen and the shadow worker use, and carry the session's own face width and geometric state.
const LAB = path.resolve(__dirname, '..');
const sessions = path.join(LAB, 'sessions');
const exported = existsSync(sessions)
  ? readdirSync(sessions).flatMap(id => { const dir = path.join(sessions, id); return existsSync(path.join(dir, 'calibration.json')) ? readdirSync(dir).filter(f => /^candidate-.+\.json$/.test(f)).map(f => ({ id, dir, file: path.join(dir, f) })) : []; })
  : [];

/** One tensor of the shipped pretrained model, read from its single weight shard (all entries are 4-byte dtypes). */
function pretrainedTensor(name: string): Float32Array {
  const dir = path.join(LAB, 'public/vendor/webeyetrack/web');
  const manifest = JSON.parse(readFileSync(path.join(dir, 'model.json'), 'utf8')).weightsManifest as { paths: string[]; weights: { name: string; shape: number[]; dtype: string }[] }[];
  for (const group of manifest) {
    let offset = 0;
    for (const w of group.weights) {
      const size = w.shape.reduce((a, b) => a * b, 1);
      if (w.name === name) { const buf = readFileSync(path.join(dir, group.paths[0])); return new Float32Array(buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + size * 4)); }
      offset += size * 4;
    }
  }
  throw new Error(`${name} not in the model manifest`);
}

describe.skipIf(exported.length === 0)('rerun_head --export candidates', () => {
  it.each(exported.map(e => [e.id + '/' + path.basename(e.file), e] as const))('%s loads as a head candidate faithful to its session', (_, e) => {
    const raw = JSON.parse(readFileSync(e.file, 'utf8'));
    const calibration = JSON.parse(readFileSync(path.join(e.dir, 'calibration.json'), 'utf8'));
    const c = readCandidate(raw);
    expect(c.format).toBe(CANDIDATE_FORMAT);
    expect(c.name).toMatch(/^rerun_head · recorded · /);
    expect(c.createdFrom).toBe(e.id);
    expect(c.geometric).toBeNull(); expect(c.correction).toBeNull();
    expect(c.head).not.toBeNull();
    const head = readLearnedCalibration(raw.head);
    // The exporter leaves `blend` null; the parent sets it to the head's geometric share so the candidate's `final` stream mirrors the shipped blend instead of a 50/50 average.
    const share = head.geometric?.weight ?? null;
    expect(c.blend === null || (share !== null && c.blend.x === share && c.blend.y === share)).toBe(true);
    expect(head.weights.map(w => w.length)).toEqual(ESTIMATOR_SHAPES.map(s => s.reduce((a, b) => a * b, 1)));
    expect(head.affine).toHaveLength(6);
    expect(head.faceWidthCm).toBe(calibration.learned.faceWidthCm);
    expect(head.geometric ?? null).toEqual(calibration.learned.geometric ?? null);
    // A retrained head: not the shipped run's tensors. With the pose columns frozen, the first kernel's rows 512-517 (head
    // vector + face origin inputs) must still be the pretrained values from the shipped model shard, bit for bit.
    expect(head.weights.some((w, i) => w.some((v, j) => v !== calibration.learned.weights[i][j]))).toBe(true);
    if (raw.variant.freezePose) {
      const pretrained = pretrainedTensor('dense/kernel');
      expect(pretrained).toHaveLength(518 * 16);
      for (let k = 512 * 16; k < 518 * 16; k++) expect(head.weights[0][k]).toBe(pretrained[k]);
      expect(head.weights[0].slice(0, 512 * 16).some((v, k) => v !== pretrained[k])).toBe(true);
    }
    expect(raw.exportFidelity.calibrationStrips).toBeLessThan(1e-6);
    expect(raw.exportFidelity.recordStrips).toBeLessThan(1e-6);
    expect(typeof raw.trainingReport.heldOutAfter).toBe('number');
  });
});
