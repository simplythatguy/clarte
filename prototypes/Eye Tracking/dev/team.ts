import { parseReplayFile, type ReplayFile } from '../src/core/replay-file';
import { TeamTrainer, type TeamRun } from './team-training';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (text: string) => { $('status').textContent = text; };
const cell = (text: string) => { const td = document.createElement('td'); td.textContent = text; return td; };
const row = (...cells: (string | HTMLElement)[]) => { const tr = document.createElement('tr'); cells.forEach(c => tr.append(typeof c === 'string' ? cell(c) : c)); return tr; };

type Loaded = { file: string; replay: ReplayFile; person: HTMLInputElement };
let loaded: Loaded[] = [];
let lastRun: TeamRun | null = null;

$<HTMLInputElement>('files').addEventListener('change', async event => {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  const rows = $('session-rows'); rows.textContent = ''; loaded = [];
  for (const [i, file] of files.entries()) {
    try {
      const replay = await parseReplayFile(file);
      const person = document.createElement('input'); person.type = 'text'; person.value = `Person ${i + 1}`; person.setAttribute('aria-label', `Person for ${file.name}`);
      const kinds = replay.manifest.entries.reduce((n, e) => { n[e.kind]++; return n; }, { calibration: 0, check: 0 });
      const td = document.createElement('td'); td.append(person);
      rows.append(row(file.name, td, `${kinds.calibration} / ${kinds.check}`));
      loaded.push({ file: file.name, replay, person });
    } catch (error) { rows.append(row(file.name, `Unreadable: ${error instanceof Error ? error.message : error}`, '')); }
  }
  $('sessions').hidden = !files.length;
  $<HTMLButtonElement>('train').disabled = loaded.length < 2;
  status(loaded.length < 2 ? 'Load at least two recordings, from at least two people.' : `${loaded.length} recordings loaded. Check the names, then Train.`);
});

$('train').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('train'); button.disabled = true; $('results').hidden = true; $<HTMLButtonElement>('download').disabled = true;
  try {
    status('Loading model…');
    const trainer = new TeamTrainer(); await trainer.load();
    const sessions = [];
    for (const item of loaded) sessions.push(await trainer.encode(item.replay, item.person.value.trim() || item.file, item.file, status));
    const run = await trainer.run(sessions, status);
    lastRun = run;
    const people = $('person-rows'); people.textContent = '';
    run.best.perPerson.forEach((p, i) => {
      const change = (p.teamPx / p.pretrainedPx - 1) * 100;
      people.append(row(`${p.label} (stored as Person ${i + 1})`, String(p.frames), `${Math.round(p.pretrainedPx)}`, `${Math.round(p.teamPx)}`, `${change > 0 ? '+' : ''}${change.toFixed(0)}%`));
    });
    const configs = $('config-rows'); configs.textContent = '';
    run.results.forEach(r => configs.append(row(String(r.config.steps), String(r.config.lr), String(r.config.l2), `${Math.round(r.meanTeamPx)}${r === run.best ? ' ★' : ''}`)));
    const e = run.model.evaluation, verdict = $('verdict'), change = (e.meanTeamPx / e.meanPretrainedPx - 1) * 100;
    verdict.className = e.improves ? 'verdict' : 'verdict is-bad';
    verdict.textContent = e.improves
      ? `It helps: on people it was not trained on, median error goes from ${Math.round(e.meanPretrainedPx)} to ${Math.round(e.meanTeamPx)} px (${change.toFixed(0)}%), and nobody gets more than 10% worse. The app will turn it on by default.`
      : `It does not help enough: ${Math.round(e.meanPretrainedPx)} → ${Math.round(e.meanTeamPx)} px (${change > 0 ? '+' : ''}${change.toFixed(0)}%), or someone got more than 10% worse. You can still download it; the app will keep it off by default. More recordings per person usually help.`;
    $<HTMLTextAreaElement>('json').value = JSON.stringify({ ...run.model, weights: `[${run.model.weights.length} tensors]` }, null, 1);
    $('results').hidden = false; $<HTMLButtonElement>('download').disabled = false;
    status('Done.');
  } catch (error) { status(`Failed: ${error instanceof Error ? error.message : error}`); console.error(error); }
  finally { button.disabled = loaded.length < 2; }
});

$('download').addEventListener('click', () => {
  if (!lastRun) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastRun.model)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'team-estimator.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
