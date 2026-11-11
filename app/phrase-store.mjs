// phrase prediction model implementation and file using that model
import { DatabaseSync } from 'node:sqlite';
import { predictNextPhrases } from './phrase-regression.mjs';
import { STARTERS } from './src/phrase-defaults.ts';
import { phraseIdentity } from './src/phrase-identity.ts';

export { STARTERS };
const keyOf = phraseIdentity;
const familyOf = phraseIdentity;

/** One local file; starter weights are priors, never measured population percentages. */
export function openPhrases(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS phrases (key TEXT PRIMARY KEY, text TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, prior INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS transitions (previous TEXT NOT NULL, next TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(previous, next));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS context (id INTEGER PRIMARY KEY CHECK(id=1), previous TEXT NOT NULL);`);
  const insert = db.prepare('INSERT OR IGNORE INTO phrases(key,text,prior) VALUES(?,?,?)');
  STARTERS.forEach((text) => insert.run(keyOf(text), text, 1));
  return {
    list() { return db.prepare('SELECT * FROM phrases ORDER BY key').all(); },
    record(text, id) {
      if (typeof text !== 'string' || !keyOf(text) || text.length > 2000 || typeof id !== 'string' || !id || id.length > 100) throw new Error('Invalid phrase or event id');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('INSERT OR IGNORE INTO events VALUES(?)').run(id).changes) {
          const typedKey = keyOf(text);
          // Resolve by original wording as well as old keys, preserving historical records.
          const key = db.prepare('SELECT key, text FROM phrases ORDER BY key').all()
            .find((p) => familyOf(p.text) === typedKey)?.key ?? typedKey;
          const previous = db.prepare('SELECT previous FROM context WHERE id=1').get()?.previous;
          insert.run(key, text.trim(), 0);
          db.prepare('UPDATE phrases SET uses=uses+1 WHERE key=?').run(key);
          if (previous) db.prepare('INSERT INTO transitions VALUES(?,?,1) ON CONFLICT(previous,next) DO UPDATE SET uses=uses+1').run(previous, key);
          db.prepare('INSERT INTO context VALUES(1,?) ON CONFLICT(id) DO UPDATE SET previous=excluded.previous').run(key);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    snapshot() {
      const previous = db.prepare('SELECT previous FROM context WHERE id=1').get()?.previous ?? '';
      const entries = db.prepare('SELECT * FROM phrases ORDER BY key').all();
      const familyByKey = new Map(entries.map((p) => [p.key, familyOf(p.text)]));
      const previousFamily = familyByKey.get(previous) ?? familyOf(previous);
      const transitions = [];
      const edges = db.prepare('SELECT next, uses FROM transitions WHERE previous=?');
      for (const p of entries) if (familyByKey.get(p.key) === previousFamily) transitions.push(...edges.all(p.key));
      const follows = new Map();
      for (const edge of transitions) {
        const family = familyByKey.get(edge.next) ?? familyOf(edge.next);
        follows.set(family, (follows.get(family) ?? 0) + edge.uses);
      }
      const families = new Map();
      for (const p of entries) {
        const family = familyByKey.get(p.key);
        const grouped = families.get(family);
        if (grouped) { grouped.uses += p.uses; grouped.prior += p.prior; }
        else families.set(family, { text: p.text, uses: p.uses, prior: p.prior, follows: follows.get(family) ?? 0 });
      }
      const rows = [...families.values()];
      const probabilities = predictNextPhrases(rows);
      return rows.map((p, i) => ({ ...p, previous, probability: probabilities[i] }));
    },
    close() { db.close(); },
  };
}
