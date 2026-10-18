/** Reviewed game-level evidence, never inferred from a low fantasy score or today's status. */
const reviewed = new Map([
  [
    '2026:REG:1:00-0035228',
    {
      reason: 'Left the game with a concussion',
      source:
        'https://www.vikings.com/news/kyler-murray-quarterback-injury-concussion-evaluation-week-1-packers',
    },
  ],
]);

export function gameExclusion(row, player = {}, season) {
  const key = `${row.season || season}:${row.season_type || 'REG'}:${Number(row.week)}:${row.player_id || player.gsis || ''}`;
  if (reviewed.has(key)) return reviewed.get(key);
  // These are normalized game-specific inputs, not pregame questionable/out designations.
  // An injury flag requires a source so unverified provider guesses cannot erase games.
  if (row.game_participation === 'did_not_play')
    return { reason: 'Did not play', source: row.game_evidence_source || null };
  if (
    row.game_participation === 'injury_exit' &&
    /^https:\/\//.test(row.game_evidence_source || '')
  )
    return { reason: 'Confirmed in-game injury', source: row.game_evidence_source };
  return null;
}

export function eligibleGames(rows, player, season) {
  const included = [],
    excluded = [];
  for (const row of rows) {
    const evidence = gameExclusion(row, player, season);
    if (evidence)
      excluded.push({ season: Number(row.season || season), week: Number(row.week), ...evidence });
    else included.push(row);
  }
  return { included, excluded };
}
