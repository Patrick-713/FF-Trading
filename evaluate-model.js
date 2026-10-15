import { valuePlayer, settingsFor } from './valuation.js';
import { MODEL_VERSION } from './model-version.js';
import { fileURLToPath } from 'node:url';
const settings = settingsFor({ mode: 'dynasty' });
const weeks = (position, kind, n = 6) =>
  Array.from({ length: n }, () => ({
    position,
    attempts: position === 'QB' ? 32 : 0,
    passing_yards: position === 'QB' ? 260 : 0,
    passing_tds: position === 'QB' ? 2 : 0,
    carries: position === 'RB' ? (kind === 'breakout' ? 23 : kind === 'slow' ? 5 : 15) : 0,
    targets: position === 'QB' ? 0 : kind === 'slow' ? 1 : 8,
    receptions: kind === 'slow' ? 1 : 5,
    rushing_yards: position === 'RB' ? (kind === 'breakout' ? 150 : kind === 'slow' ? 15 : 70) : 0,
    rushing_tds: kind === 'breakout' ? 2 : 0,
    receiving_yards: position === 'RB' ? 20 : kind === 'slow' ? 10 : 80,
    receiving_tds: kind === 'breakout' ? 1 : 0,
  }));
export function evaluateModel() {
  // Synthetic, named archetypes evaluate behavior. No invented real-player labels or accuracy scores.
  const cases = [
    ['elite-rookie-slow', 'RB', 21, 2026, 1, 8, 'slow', 4],
    ['late-rookie-slow', 'RB', 21, 2026, 7, 240, 'slow', 4],
    ['elite-rookie-no-games', 'RB', 21, 2026, 1, 8, 'slow', 0],
    ['rookie-breakout', 'RB', 21, 2026, 1, 8, 'breakout', 6],
    ['second-year-slow', 'RB', 22, 2025, 1, 8, 'slow', 6],
    ['third-year-slow', 'RB', 23, 2024, 1, 8, 'slow', 6],
    ['veteran-producer', 'WR', 26, 2021, 2, 40, 'normal', 10],
    ['aging-producer', 'WR', 34, 2013, 2, 40, 'normal', 10],
    ['young-qb', 'QB', 23, 2026, 1, 3, 'normal', 6],
    ['young-te', 'TE', 22, 2026, 1, 20, 'slow', 4],
  ].map(([id, position, age, draftYear, draftRound, draftPick, kind, n]) => {
    const player = {
      id,
      position,
      age,
      draftYear,
      draftRound,
      draftPick,
      experience: 2026 - draftYear,
    };
    const rows = weeks(position, kind, n),
      result = valuePlayer(player, rows, settings, 2026);
    const productionOnly = valuePlayer(
      { ...player, draftYear: 2020, experience: 6 },
      rows,
      settings,
      2026,
    );
    return {
      id,
      currentValue: result.redraft,
      dynastyValue: result.dynasty,
      productionOnlyDynasty: productionOnly.dynasty,
      priorWeight: result.prospect?.priorWeight || 0,
      redraftUnchanged: result.redraft === productionOnly.redraft,
      pace: result.pace,
    };
  });
  const by = (id) => cases.find((c) => c.id === id);
  const checks = [
    [
      'elite capital exceeds late capital',
      by('elite-rookie-slow').dynastyValue > by('late-rookie-slow').dynastyValue,
    ],
    [
      'slow elite rookie retains more than production-only estimate',
      by('elite-rookie-slow').dynastyValue > by('elite-rookie-slow').productionOnlyDynasty * 2,
    ],
    ['prospect has value without NFL games', by('elite-rookie-no-games').dynastyValue > 1000],
    [
      'breakout exceeds preseason prior',
      by('rookie-breakout').dynastyValue > by('elite-rookie-no-games').dynastyValue,
    ],
    [
      'tenure reduces protection',
      by('second-year-slow').priorWeight > by('third-year-slow').priorWeight,
    ],
    [
      'age matters at equal production',
      by('veteran-producer').dynastyValue > by('aging-producer').dynastyValue,
    ],
    ['redraft is independent of prospect protection', cases.every((c) => c.redraftUnchanged)],
    ['veteran receives no prospect protection', by('veteran-producer').priorWeight === 0],
  ].map(([name, passed]) => ({ name, passed }));
  return {
    modelVersion: MODEL_VERSION,
    evaluationType: 'Synthetic behavioral regression; not predictive validation',
    cases,
    checks,
    passed: checks.every((c) => c.passed),
    limitations: [
      'No held-out historical outcomes or independently licensed consensus rankings are included.',
      'Passing checks confirms intended model behavior, not forecasting accuracy.',
      'Future calibration should use date-stamped inputs and unseen future outcomes to prevent look-ahead bias.',
    ],
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = evaluateModel();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
