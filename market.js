export const players = [
  { id: 'qb1', name: 'Miles Carter', position: 'QB', club: 'SEA', projection: 23.4 },
  { id: 'rb1', name: 'Jayden Brooks', position: 'RB', club: 'PHI', projection: 19.8 },
  { id: 'rb2', name: 'Eli Rivers', position: 'RB', club: 'DET', projection: 17.2 },
  { id: 'wr1', name: 'Noah Chase', position: 'WR', club: 'CIN', projection: 21.1 },
  { id: 'wr2', name: 'Amari Stone', position: 'WR', club: 'DAL', projection: 16.6 },
  { id: 'te1', name: 'Cole Bennett', position: 'TE', club: 'KC', projection: 13.5 },
  { id: 'flex1', name: 'Darius Lane', position: 'WR', club: 'BAL', projection: 14.8 },
  { id: 'qb2', name: 'Leo Walker', position: 'QB', club: 'BUF', projection: 22.1 },
  { id: 'rb3', name: 'Jordan West', position: 'RB', club: 'SF', projection: 18.2 },
  { id: 'wr3', name: 'Tyler Reed', position: 'WR', club: 'MIN', projection: 18.7 },
  { id: 'te2', name: 'Finn Hayes', position: 'TE', club: 'LV', projection: 12.2 }
];
export const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'];
export const initialRoster = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'flex1'];
export const teams = [
  { id: 'grid', ticker: 'GRID', name: 'Gridiron Capital', manager: 'You', price: 12450, previous: 11920, points: 126.4, wins: 5, losses: 2, color: '#bbef49' },
  { id: 'blitz', ticker: 'BLTZ', name: 'Blitz Syndicate', manager: 'Alex R.', price: 14820, previous: 14290, points: 142.8, wins: 6, losses: 1, color: '#99b7ff' },
  { id: 'red', ticker: 'REDZ', name: 'Red Zone Royals', manager: 'Jamie K.', price: 10860, previous: 11270, points: 108.2, wins: 4, losses: 3, color: '#f39c7a' },
  { id: 'fourth', ticker: '4TH', name: 'Fourth & Fortune', manager: 'Sam T.', price: 9320, previous: 9000, points: 119.6, wins: 4, losses: 3, color: '#c2a6f2' },
  { id: 'waiver', ticker: 'WAVR', name: 'Waiver Wire Wolves', manager: 'Chris M.', price: 7850, previous: 8100, points: 98.1, wins: 3, losses: 4, color: '#70cfbb' },
  { id: 'end', ticker: 'ENDZ', name: 'End Zone Equity', manager: 'Morgan L.', price: 11240, previous: 10940, points: 122.9, wins: 5, losses: 2, color: '#e8c979' }
];
export function validateRoster(ids) {
  if (!Array.isArray(ids) || ids.length !== slots.length || new Set(ids).size !== ids.length) throw new Error('Select seven different players.');
  ids.forEach((id, i) => {
    const player = players.find(p => p.id === id);
    if (!player || (slots[i] === 'FLEX' ? !['RB', 'WR', 'TE'].includes(player.position) : player.position !== slots[i])) throw new Error('Player does not fit this roster slot.');
  });
  return ids;
}
export function tradeAmounts(side, quantity, price, cash, owned) {
  if (!['buy', 'sell'].includes(side) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Choose buy or sell and 1–10,000 whole shares.');
  const total = price * quantity;
  if (side === 'buy' && total > cash) throw new Error('Not enough available credits.');
  if (side === 'sell' && quantity > owned) throw new Error('You cannot sell more shares than you own.');
  return { total, cash: cash + (side === 'buy' ? -total : total), shares: owned + (side === 'buy' ? quantity : -quantity) };
}
// Transparent demo valuation: relative score changes price, capped at +/-12% a week.
export function nextPrice(price, points, benchmark = 120) {
  const movement = Math.max(-0.12, Math.min(0.12, (points - benchmark) / benchmark * 0.25));
  return Math.max(100, Math.round(price * (1 + movement)));
}
