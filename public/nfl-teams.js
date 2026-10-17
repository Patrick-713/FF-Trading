/** Shared team identifiers keep saved preferences and browser choices consistent. */
export const NFL_TEAMS = [
  ['ARI', 'Arizona Cardinals', '#ef667e'],
  ['ATL', 'Atlanta Falcons', '#ee6b77'],
  ['BAL', 'Baltimore Ravens', '#b5a1f2'],
  ['BUF', 'Buffalo Bills', '#76aaff'],
  ['CAR', 'Carolina Panthers', '#56c6f2'],
  ['CHI', 'Chicago Bears', '#ffad74'],
  ['CIN', 'Cincinnati Bengals', '#ff9b67'],
  ['CLE', 'Cleveland Browns', '#f59a67'],
  ['DAL', 'Dallas Cowboys', '#a6c6ee'],
  ['DEN', 'Denver Broncos', '#ffa16f'],
  ['DET', 'Detroit Lions', '#73bff0'],
  ['GB', 'Green Bay Packers', '#f3cc6b'],
  ['HOU', 'Houston Texans', '#ec7d8d'],
  ['IND', 'Indianapolis Colts', '#86aef5'],
  ['JAX', 'Jacksonville Jaguars', '#67d3cf'],
  ['KC', 'Kansas City Chiefs', '#ff8998'],
  ['LV', 'Las Vegas Raiders', '#c8d0dc'],
  ['LAC', 'Los Angeles Chargers', '#7dceff'],
  ['LAR', 'Los Angeles Rams', '#f1cf6d'],
  ['MIA', 'Miami Dolphins', '#6ee2d4'],
  ['MIN', 'Minnesota Vikings', '#bca1f5'],
  ['NE', 'New England Patriots', '#9abbe5'],
  ['NO', 'New Orleans Saints', '#e4d1a0'],
  ['NYG', 'New York Giants', '#83aff7'],
  ['NYJ', 'New York Jets', '#78cfac'],
  ['PHI', 'Philadelphia Eagles', '#71cfbf'],
  ['PIT', 'Pittsburgh Steelers', '#f4cf65'],
  ['SF', 'San Francisco 49ers', '#f18a91'],
  ['SEA', 'Seattle Seahawks', '#9bd87b'],
  ['TB', 'Tampa Bay Buccaneers', '#f58d92'],
  ['TEN', 'Tennessee Titans', '#8ec9ee'],
  ['WAS', 'Washington Commanders', '#e9b873'],
].map(([id, name, color]) => ({ id, name, color }));

export function favoriteTeam(id) {
  return NFL_TEAMS.find((team) => team.id === id) || null;
}
