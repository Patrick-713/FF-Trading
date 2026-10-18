/** Manual maintenance only. Dry run by default; --apply backs up inputs before a transaction. */
import { transaction } from '../src/storage/database.js';
import { openDatabase } from '../src/storage/storage.js';
import { compactInputs, compactRows, summarizeHistory } from '../src/storage/stat-inputs.js';
import { pointsFor, settingsFor } from '../src/analysis/valuation.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const apply = process.argv.includes('--apply');
const db = await openDatabase();
async function readText(table, where, params) {
  const size = await db
    .prepare(`SELECT length(data) AS size FROM ${table} WHERE ${where}`)
    .get(...params);
  if (!size) return null;
  const parts = [];
  for (let start = 1; start <= Number(size.size); start += 262144) {
    const row = await db
      .prepare(
        `SELECT substr(data,CAST(? AS INTEGER),CAST(? AS INTEGER)) AS part FROM ${table} WHERE ${where}`,
      )
      .get(start, 262144, ...params);
    parts.push(row.part);
  }
  return parts.join('');
}
try {
  const links = await db.prepare('SELECT account,league,data FROM sleeper_links').all();
  const updates = [],
    cacheUpdates = [],
    history = new Map();
  const sourceBytes = {
    snapshotBytes: 0,
    compactSnapshotBytes: 0,
    statBytes: 0,
    compactStatBytes: 0,
  };
  for (const link of links) {
    const snapshot = JSON.parse(link.data);
    const row = await db
      .prepare('SELECT refreshed FROM analysis_snapshots WHERE account=? AND league=?')
      .get(link.account, link.league);
    if (!row) continue;
    row.data = await readText('analysis_snapshots', 'account=? AND league=?', [
      link.account,
      link.league,
    ]);
    const input = JSON.parse(row.data),
      year = Number(snapshot.league.season) - 1;
    if (!history.has(year)) {
      try {
        const rows = JSON.parse(
          await readFile(new URL(`../data/validation/${year}.json`, import.meta.url), 'utf8'),
        );
        history.set(year, summarizeHistory(rows, year));
      } catch {
        history.set(year, null);
      }
    }
    const packed = compactInputs(
      { ...input, ...(history.get(year) ? { history: history.get(year) } : {}) },
      snapshot.teams.flatMap((t) => t.playerIds || []),
    );
    const data = JSON.stringify(packed);
    for (const scoring of ['ppr', 'half', 'standard']) {
      const s = settingsFor({ scoring });
      assert.deepEqual(
        input.statistics.rows.map((r) => pointsFor(r, s)),
        packed.statistics.rows.map((r) => pointsFor(r, s)),
      );
    }
    sourceBytes.snapshotBytes += Buffer.byteLength(row.data);
    sourceBytes.compactSnapshotBytes += Buffer.byteLength(data);
    updates.push({
      account: link.account,
      league: link.league,
      original: row.data,
      refreshed: row.refreshed,
      data,
    });
  }
  const caches = await db
    .prepare("SELECT key,fetched FROM fantasy_cache WHERE key LIKE 'stats:%'")
    .all();
  for (const row of caches) {
    row.data = await readText('fantasy_cache', 'key=?', [row.key]);
    const value = JSON.parse(row.data);
    const data = JSON.stringify({ ...value, rows: compactRows(value.rows) });
    sourceBytes.statBytes += Buffer.byteLength(row.data);
    sourceBytes.compactStatBytes += Buffer.byteLength(data);
    cacheUpdates.push({ ...row, original: row.data, data });
  }
  if (apply) {
    const backupFolder = new URL('../data/backups/', import.meta.url);
    await mkdir(backupFolder, { recursive: true });
    await writeFile(
      new URL(`inputs-before-2.4-${Date.now()}.json`, backupFolder),
      JSON.stringify({ updates, cacheUpdates }),
    );
    await transaction(db, async () => {
      for (const row of updates) {
        const updated = await db
          .prepare(
            'UPDATE analysis_snapshots SET data=? WHERE account=? AND league=? AND refreshed=?',
          )
          .run(row.data, row.account, row.league, row.refreshed);
        if (updated.changes !== 1)
          throw new Error('Snapshot changed during compaction; transaction rolled back. Retry.');
      }
      for (const row of cacheUpdates)
        await db
          .prepare('UPDATE fantasy_cache SET data=? WHERE key=? AND fetched=?')
          .run(row.data, row.key, row.fetched);
      for (const [year, value] of history)
        if (value)
          await db
            .prepare('INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO NOTHING')
            .run('history:' + year, JSON.stringify(value), Date.now());
    });
  }
  console.log(
    JSON.stringify({
      applied: apply,
      snapshots: updates.length,
      historySeasons: [...history].filter(([, value]) => value).map(([year]) => year),
      ...sourceBytes,
    }),
  );
} finally {
  await db.close();
}
