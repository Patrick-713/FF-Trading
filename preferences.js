import { invalid } from './errors.js';
import { favoriteTeam } from './public/nfl-teams.js';

export function validateFavorite(value) {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !favoriteTeam(value))
    throw invalid('Choose an NFL team from the list.');
  return value;
}
export async function readPreferences(db, account) {
  const row = await db.prepare('SELECT data FROM account_preferences WHERE account=?').get(account);
  return row ? JSON.parse(row.data) : { favoriteTeam: null };
}
export async function savePreferences(db, account, input) {
  const data = { favoriteTeam: validateFavorite(input.favoriteTeam) };
  await db
    .prepare(
      'INSERT INTO account_preferences VALUES (?,?) ON CONFLICT(account) DO UPDATE SET data=excluded.data',
    )
    .run(account, JSON.stringify(data));
  return data;
}
