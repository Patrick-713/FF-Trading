import { invalid } from '../http/errors.js';
import { favoriteTeam } from '../../public/nfl-teams.js';

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
  const favoriteTeam = validateFavorite(input.favoriteTeam);
  return updatePreferences(db, account, (data) => ({ ...data, favoriteTeam }));
}

/** Compare-and-swap preserves other account settings when devices save concurrently. */
export async function updatePreferences(db, account, update) {
  await db
    .prepare('INSERT INTO account_preferences VALUES (?,?) ON CONFLICT(account) DO NOTHING')
    .run(account, JSON.stringify({ favoriteTeam: null }));
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db
      .prepare('SELECT data FROM account_preferences WHERE account=?')
      .get(account);
    const next = update(JSON.parse(row.data));
    const result = await db
      .prepare('UPDATE account_preferences SET data=? WHERE account=? AND data=?')
      .run(JSON.stringify(next), account, row.data);
    if (result.changes) return next;
  }
  throw invalid('Your account changed on another device. Please try again.');
}
