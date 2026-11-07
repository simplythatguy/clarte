import { parseSessionFile, type SessionFile } from '../src/core/session-file';
import { MODEL_LABELS } from '../src/core/check-report';
import { replaySession, type SessionScore } from './session-runner';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (text: string) => { $('status').textContent = text; };
const px = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : String(Math.round(v)));
declare global { interface Window { __sessionResults?: { done: boolean; scores: (SessionScore | { file: string; error: string })[] } } }

let sessions: { file: string; session: SessionFile }[] = [];
$<HTMLInputElement>('files').addEventListener('change', async event => {
  sessions = [];
  const files = [...((event.target as HTMLInputElement).files ?? [])], problems: string[] = [];
  for (const file of files) {
    try { sessions.push({ file: file.name, session: await parseSessionFile(file) }); }
    catch (error) { problems.push(`${file.name}: ${error instanceof Error ? error.message : error}`); }
  }
  $<HTMLButtonElement>('run').disabled = !sessions.length;
  status(`${sessions.length} session${sessions.length === 1 ? '' : 's'} loaded: ${sessions.map(s => `${s.session.manifest.tester} #${s.session.manifest.sample}`).join(', ')}${problems.length ? `. Unreadable: ${problems.join('; ')}` : ''}`);
});

function row(score: SessionScore): HTMLTableRowElement {
  const tr = document.createElement('tr'), check = score.check;
  const region = (name: string) => px(check?.regions.find(r => r.name === name)?.medianPx);
  const measured = check?.corrections?.scores.filter(s => s.medianPx !== null) ?? [];
  const best = measured.length ? measured.reduce((a, b) => (b.medianPx! < a.medianPx! ? b : a)) : null;
  const cells = [
    `${score.tester} #${score.sample}`, `${score.durationS} s`, `${score.frames.withFace} / ${score.frames.processed}`, `${score.labels.collected} / ${score.labels.recorded}${score.training ? ` · ${score.training.bestStep}/${score.training.stepsUsed} steps` : ''}`,
    px(score.live?.medianPx), px(check?.medianPx), px(check?.p90Px), region('center'), region('edges'), region('corners'),
    check ? `${px(check.bias.dx)}, ${px(check.bias.dy)}` : '—', best ? `${MODEL_LABELS[best.model]} (${px(best.medianPx)})` : '—',
    check?.estimators ? `${px(check.estimators.networkMedian)} / ${px(check.estimators.geometricMedian)}${check.estimators.blend ? ` / ${px(check.estimators.blend.median)} at ${Math.round(check.estimators.blend.weight * 100)}%` : ''}` : '—',
  ];
  cells.forEach(text => { const td = document.createElement('td'); td.textContent = text; tr.append(td); });
  const notes = document.createElement('td'); notes.className = 'notes'; notes.textContent = score.notes.join(' '); tr.append(notes);
  return tr;
}

$('run').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('run'); button.disabled = true;
  const rows = $('rows'); rows.textContent = '';
  const results: NonNullable<Window['__sessionResults']> = { done: false, scores: [] };
  window.__sessionResults = results;
  // ?training={"steps":0} replays with other calibration training settings, for A/B against the defaults.
  let training: Record<string, unknown> | null = null;
  try { const raw = new URLSearchParams(location.search).get('training'); training = raw ? JSON.parse(raw) : null; } catch { status('Ignoring invalid ?training= JSON.'); }
  // ?normalize=1 takes the eye strips from a pose-normalized view.
  const normalizedCrop = new URLSearchParams(location.search).get('normalize') === '1';
  for (const { file, session } of sessions) {
    try {
      const score = await replaySession(session, { onProgress: status, training, normalizedCrop });
      results.scores.push(score); rows.append(row(score));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.scores.push({ file, error: message });
      const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 14; td.textContent = `${file}: ${message}`; tr.append(td); rows.append(tr);
    }
  }
  $<HTMLTextAreaElement>('json').value = JSON.stringify(results.scores, null, 1);
  results.done = true;
  status(`Done: ${results.scores.length} session${results.scores.length === 1 ? '' : 's'} replayed.`);
  button.disabled = false;
});
