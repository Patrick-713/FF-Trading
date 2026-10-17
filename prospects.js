// Explicit prospect priors, not consensus rankings. Never infer a rookie from age alone.
import { slotBase } from './draft-values.js';
import { rookieBenchmark } from './rookie-benchmarks.js';
const finite = (v) =>
  v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v))
    ? Number(v)
    : null;
export function prospectProfile(player, rows, season) {
  const experience = finite(player.experience),
    draftYear = finite(player.draftYear);
  const years = draftYear !== null && Number.isInteger(season) ? season - draftYear : experience;
  const eligible =
    ['QB', 'RB', 'WR', 'TE'].includes(player.position) &&
    Number.isInteger(years) &&
    years >= 0 &&
    years <= 2;
  if (!eligible) return null;
  const round = finite(player.draftRound),
    pick = finite(player.draftPick);
  let capital =
    pick !== null && pick >= 1 && pick <= 10
      ? 800
      : pick !== null && pick <= 32 && pick >= 1
        ? 700
        : ({ 1: 700, 2: 550, 3: 400, 4: 250, 5: 165, 6: 110, 7: 75 }[round] ?? 115);
  const rookie = player.rookieDraft || rookieBenchmark(player);
  const rookiePick = finite(rookie?.overall),
    teams = finite(rookie?.teams);
  let leaguePrior = null;
  if (
    (rookie?.verified === true || rookie?.benchmark === true) &&
    Number.isInteger(rookiePick) &&
    Number.isInteger(teams) &&
    teams <= 100 &&
    rookiePick >= 1 &&
    teams >= 2 &&
    Number(rookie.season) === season - years
  ) {
    // Rookie context uses the same calibrated curve as future picks.
    leaguePrior = slotBase(rookiePick, teams);
    capital =
      round !== null || pick !== null
        ? capital * 0.75 + leaguePrior * 0.25
        : leaguePrior * 0.8 + capital * 0.2;
  }
  const opportunities = rows.reduce(
    (n, r) =>
      n +
      (player.position === 'QB'
        ? Number(r.attempts) || 0
        : (Number(r.carries) || 0) + (Number(r.targets) || 0)),
    0,
  );
  const threshold = player.position === 'QB' ? 450 : player.position === 'RB' ? 200 : 150;
  const exposure = Math.max(Math.min(rows.length / 17, 1), Math.min(opportunities / threshold, 1));
  // Prior fades with both NFL tenure and observed opportunities, including sustained poor production.
  const tenure = [1, 0.55, 0.2][years],
    priorWeight = Math.max(0, tenure * (0.9 - 0.55 * exposure));
  return {
    years,
    capital: Math.round(capital),
    priorWeight: Math.round(priorWeight * 1000) / 1000,
    opportunities,
    leaguePrior,
    source:
      leaguePrior !== null
        ? rookie.benchmark
          ? 'Configured rookie pick benchmark'
          : 'NFL draft capital + verified league rookie draft'
        : round !== null || pick !== null
          ? 'NFL draft capital'
          : 'Limited metadata prior',
    rookieDraft: leaguePrior !== null ? rookie : null,
  };
}

export async function loadRookieDrafts(get, league, season, catalog) {
  const result = { players: {}, warning: null };
  if (league.type !== 2) return result;
  try {
    const drafts = await get(`league/${league.id}/drafts`, 3600000);
    if (!Array.isArray(drafts)) throw new Error('Invalid draft list');
    const current = drafts
      .filter(
        (d) =>
          Number(d.season) === season &&
          d.sport === 'nfl' &&
          d.status === 'complete' &&
          /^\d{6,30}$/.test(String(d.draft_id)),
      )
      .slice(0, 4);
    for (const draft of current) {
      const picks = await get(`draft/${draft.draft_id}/picks`, 86400000);
      if (!Array.isArray(picks) || picks.length < 2) continue;
      // Verify actual rookie-only contents instead of guessing from a draft's title or 1st pick.
      const rookie = (p) => {
        const exp = finite(catalog[p.player_id]?.years_exp);
        return exp !== null && exp + season - new Date().getUTCFullYear() === 0 && !p.is_keeper;
      };
      if (!picks.every(rookie)) continue;
      const teams = Number(draft.settings?.teams);
      if (!Number.isInteger(teams) || teams < 2 || teams > 100) continue;
      for (const p of picks) {
        const overall = Number(p.pick_no);
        if (Number.isInteger(overall) && overall > 0 && overall <= 1000)
          result.players[String(p.player_id)] = {
            overall,
            teams,
            season,
            verified: true,
            source: 'Sleeper rookie-only draft',
            draftId: String(draft.draft_id),
          };
      }
    }
  } catch {
    result.warning =
      'Rookie draft history is unavailable. Prospect values use available NFL draft capital and metadata; no rookie rank is assumed.';
  }
  return result;
}
