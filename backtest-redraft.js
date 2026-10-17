/** Offline, reproducible evaluation. Never runs in a page request or calls paid providers. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseCSV, pointsFor, settingsFor } from './valuation.js';
import { compactRows, summarizeHistory } from './stat-inputs.js';
import { scoringSignal } from './redraft-signal.js';
const folder = new URL('./data/validation/', import.meta.url);
await mkdir(folder, { recursive: true });
async function seasonRows(year) {
  const file = new URL(`${year}.json`, folder);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const response = await fetch(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`,
    { signal: AbortSignal.timeout(60000) },
  );
  if (!response.ok) throw new Error(`Historical download failed: ${year} (${response.status})`);
  const rows = compactRows(parseCSV(await response.text()).filter((r) => r.season_type === 'REG'));
  await writeFile(file, JSON.stringify(rows));
  return rows;
}
const seasons = {};
for (const year of [2023, 2024, 2025]) seasons[year] = await seasonRows(year);
function evaluate(year, strength, fadeGames, scoringMode = 'ppr') {
  const previous = summarizeHistory(seasons[year - 1], year - 1).players;
  const scoring = settingsFor({ scoring: scoringMode });
  const players = new Map();
  for (const row of seasons[year]) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(row.position)) continue;
    if (!players.has(row.player_id)) players.set(row.player_id, []);
    players.get(row.player_id).push(row);
  }
  let error = 0,
    baselineError = 0,
    n = 0;
  const positions = {};
  for (let cutoff = 1; cutoff <= 14; cutoff++)
    for (const [id, rows] of players) {
      const past = rows
        .filter((r) => Number(r.week) <= cutoff)
        .sort((a, b) => Number(a.week) - Number(b.week));
      if (!past.length || !past.some((r) => Number(r.week) > cutoff - 4)) continue;
      const future = rows.filter((r) => Number(r.week) > cutoff && Number(r.week) <= cutoff + 4);
      if (!future.length) continue;
      const hist = previous[id];
      const scores = past.map((r) => pointsFor(r, scoring));
      const actual = future.reduce((sum, r) => sum + pointsFor(r, scoring), 0) / future.length;
      const baseline = scoringSignal(scores).current;
      const prediction = scoringSignal(
        scores,
        hist ? pointsFor({ ...hist.averages, position: hist.position }, scoring) : null,
        hist?.games || 0,
        strength,
        fadeGames,
      ).estimate;
      const delta = Math.abs(prediction - actual),
        oldDelta = Math.abs(baseline - actual);
      error += delta;
      baselineError += oldDelta;
      n++;
      const p = (positions[past[0].position] ||= { count: 0, error: 0, baselineError: 0 });
      p.count++;
      p.error += delta;
      p.baselineError += oldDelta;
    }
  return {
    count: n,
    mae: error / n,
    baselineMAE: baselineError / n,
    positions: Object.fromEntries(
      Object.entries(positions).map(([position, p]) => [
        position,
        { count: p.count, mae: p.error / p.count, baselineMAE: p.baselineError / p.count },
      ]),
    ),
  };
}
const candidates = [];
for (const strength of [2, 4, 6, 8])
  for (const fadeGames of [8, 12, 17])
    candidates.push({ strength, fadeGames, training: evaluate(2024, strength, fadeGames) });
candidates.sort((a, b) => a.training.mae - b.training.mae);
const chosen = candidates[0];
const report = {
  method:
    'Train history blend on 2024 using 2023 history; hold out 2025 with 2024 history. At cutoffs 1 to 14, predict PPR points per appearance in the next four NFL weeks.',
  limitations:
    'Conditional on future game appearances; does not predict injury absence, bye-week totals, trade-value accuracy or rank accuracy. Repeated players and overlapping windows are dependent. Historical provider corrections may postdate the cutoff. No 2025 outcomes used to choose weights.',
  chosen: { strength: chosen.strength, fadeGames: chosen.fadeGames },
  training: chosen.training,
  holdoutByScoring: Object.fromEntries(
    ['ppr', 'half', 'standard'].map((scoring) => [
      scoring,
      evaluate(2025, chosen.strength, chosen.fadeGames, scoring),
    ]),
  ),
  holdout: evaluate(2025, chosen.strength, chosen.fadeGames),
  candidates,
};
await writeFile(
  new URL('./redraft-validation.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({ chosen: report.chosen, training: report.training, holdout: report.holdout }),
);
