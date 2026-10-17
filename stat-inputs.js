/** Only retain provider fields that our scoring, matching and usage calculations read. */
export const SCORING_FIELDS = [
  'passing_yards',
  'passing_tds',
  'passing_interceptions',
  'rushing_yards',
  'rushing_tds',
  'receiving_yards',
  'receiving_tds',
  'receptions',
  'rushing_fumbles_lost',
  'receiving_fumbles_lost',
  'sack_fumbles_lost',
  'passing_2pt_conversions',
  'rushing_2pt_conversions',
  'receiving_2pt_conversions',
  'special_teams_tds',
  'fg_made',
  'pat_made',
  'def_tackles_solo',
  'def_tackle_assists',
  'def_sacks',
  'def_interceptions',
  'def_pass_defended',
  'def_tds',
  'def_fumbles_forced',
];
const fields = [
  ...SCORING_FIELDS,
  'targets',
  'carries',
  'attempts',
  'target_share',
  'wopr',
  'receiving_air_yards',
  'passing_epa',
  'rushing_epa',
  'receiving_epa',
];
export function compactRows(rows) {
  return rows.map((row) => {
    const result = Object.fromEntries(
      ['player_id', 'player_display_name', 'position', 'week', 'team', 'season', 'season_type']
        .filter((key) => row[key] != null)
        .map((key) => [key, row[key]]),
    );
    for (const key of fields) {
      const value = row[key];
      if (value === '' || value == null || !Number.isFinite(Number(value))) continue;
      if (Number(value) !== 0 || ['target_share', 'wopr'].includes(key))
        result[key] = Number(value);
    }
    return result;
  });
}
/** One small per-player record instead of another full season of weekly rows per league. */
export function summarizeHistory(rows, season) {
  const players = {};
  for (const row of rows) {
    if (!row.player_id || !['QB', 'RB', 'WR', 'TE', 'K'].includes(row.position)) continue;
    const p = (players[row.player_id] ||= {
      games: 0,
      position: row.position,
      name: row.player_display_name,
      team: row.team || row.recent_team,
      totals: {},
      available: {},
    });
    p.games++;
    for (const key of fields)
      if (row[key] !== '' && row[key] != null && Number.isFinite(Number(row[key]))) {
        p.totals[key] = (p.totals[key] || 0) + Number(row[key]);
        p.available[key] = (p.available[key] || 0) + 1;
      }
  }
  for (const p of Object.values(players)) {
    p.averages = Object.fromEntries(
      Object.entries(p.totals).map(([key, value]) => [
        key,
        value / (['target_share', 'wopr'].includes(key) ? p.available[key] : p.games),
      ]),
    );
    delete p.totals;
    delete p.available;
  }
  return { season, players };
}
export function compactInputs(inputs, rostered = []) {
  const observed = new Set([
    ...(inputs.statistics?.rows || []).map((row) => row.player_id),
    ...Object.keys(inputs.history?.players || {}),
  ]);
  const catalog = Object.fromEntries(
    Object.entries(inputs.catalog || {}).filter(
      ([id, p]) =>
        rostered.includes(id) ||
        (p.active &&
          ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position) &&
          (observed.has(p.gsis_id) || Number(p.years_exp) <= 1)),
    ),
  );
  const ids = new Set(
    Object.values(catalog)
      .map((p) => p.gsis_id)
      .filter(Boolean),
  );
  return {
    ...inputs,
    ...(inputs.history
      ? {
          history: {
            ...inputs.history,
            players: Object.fromEntries(
              Object.entries(inputs.history.players || {}).filter(([id]) => ids.has(id)),
            ),
          },
        }
      : {}),
    statistics: { ...inputs.statistics, rows: compactRows(inputs.statistics?.rows || []) },
    catalog,
    metadata: Object.fromEntries(
      Object.entries(inputs.metadata || {}).filter(([id]) => ids.has(id)),
    ),
  };
}
