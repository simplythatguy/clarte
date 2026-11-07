import { parseReplayFile, type ReplayFile } from '../src/core/replay-file';
import { EXPERIMENTS, Harness, type Score } from './experiments';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (text: string) => { $('status').textContent = text; };
const round = (v: number | null) => (v === null || Number.isNaN(v) ? '—' : String(Math.round(v)));

let replay: ReplayFile | null = null;
$<HTMLInputElement>('file').addEventListener('change', async event => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    replay = await parseReplayFile(file);
    const m = replay.manifest, kinds = m.entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {} as Record<string, number>);
    const dots = new Set(m.entries.filter(e => e.kind === 'calibration').map(e => e.label.join(','))).size;
    status(`Loaded ${m.entries.length} frames: ${kinds.calibration ?? 0} calibration on ${dots} dots, ${kinds.check ?? 0} check. Viewport ${m.viewport.width}×${m.viewport.height}, camera ${m.camera ? `${m.camera.width}×${m.camera.height}` : 'unknown'}, recorded ${new Date(m.createdAt).toLocaleString()}.`);
    $<HTMLButtonElement>('run').disabled = false;
    // Drawn, not linked: the page's CSP allows no blob: images.
    const strip = $<HTMLCanvasElement>('strip'), bitmap = await createImageBitmap(replay.images[0]);
    strip.width = bitmap.width; strip.height = bitmap.height; strip.getContext('2d')?.drawImage(bitmap, 0, 0); bitmap.close(); strip.hidden = false;
  } catch (error) { status(`Could not read file: ${error instanceof Error ? error.message : error}`); }
});

$('run').addEventListener('click', async () => {
  if (!replay) return;
  $<HTMLButtonElement>('run').disabled = true;
  const rows = $('rows'); rows.textContent = '';
  try {
    status('Loading model…');
    const harness = new Harness(replay.manifest.viewport);
    await harness.load();
    status('Encoding eye strips…');
    const frames = await harness.encode(replay, (done, total) => status(`Encoding eye strips… ${done}/${total}`));
    const scores: Score[] = [];
    for (const experiment of EXPERIMENTS) {
      status(`Running: ${experiment.name}`);
      const score = await harness.run(experiment, frames);
      scores.push(score);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${score.name}</td><td>${round(score.fitMedianPx)}</td><td>${round(score.lodoMedianPx)}</td><td>${round(score.lodoP90Px)}</td><td>${round(score.checkMedianPx)}</td><td>${round(score.checkP90Px)}</td>`;
      rows.append(tr);
    }
    const best = scores.filter(s => s.checkMedianPx !== null).sort((a, b) => a.checkMedianPx! - b.checkMedianPx!)[0] ?? scores.filter(s => s.lodoMedianPx !== null).sort((a, b) => a.lodoMedianPx! - b.lodoMedianPx!)[0];
    status(`Done. Best: ${best?.name ?? '—'}. Copy the JSON below and paste it back.`);
    $<HTMLTextAreaElement>('json').value = JSON.stringify({ manifest: { ...replay.manifest, entries: replay.manifest.entries.length }, scores }, null, 1);
  } catch (error) { status(`Failed: ${error instanceof Error ? error.message : error}`); console.error(error); }
  finally { $<HTMLButtonElement>('run').disabled = false; }
});
