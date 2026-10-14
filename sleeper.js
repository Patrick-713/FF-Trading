import { nextPrice } from './market.js';

const BASE = 'https://api.sleeper.app/v1';
export function validUsername(value) {
  const name = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) throw new Error('Enter a Sleeper username, not an email or password.');
  return name;
}
export function validLeague(value) {
  if (typeof value !== 'string' || !/^\d{6,30}$/.test(value)) throw new Error('Choose a valid Sleeper league.');
  return value;
}
export function validSeason(value) {
  const season = String(value);
  if (!/^20\d{2}$/.test(season) || Number(season) < 2017 || Number(season) > 2100) throw new Error('Choose a season from 2017 onward.');
  return season;
}
export function completedWeeks(league, nfl) {
  if (['pre_draft', 'drafting'].includes(league.status)) return 0;
  if (Number(league.season) < Number(nfl.season)) return 18;
  if (Number(league.season) > Number(nfl.season) || nfl.season_type === 'pre') return 0;
  if (nfl.season_type === 'post') return 18;
  // Avoid pricing a partial game week. Settlement happens after the NFL week advances.
  return Math.min(18, Math.max(0, Number(nfl.leg ?? nfl.week ?? 1) - 1));
}
export function buildSnapshot(user, league, rosters, members, catalog, weeks, nfl) {
  if (!Array.isArray(rosters) || !rosters.length || !Array.isArray(members)) throw new Error('Sleeper has not created rosters for this league yet.');
  if (rosters.length > 100 || rosters.some(r => !Number.isSafeInteger(r.roster_id) || r.roster_id < 1) || new Set(rosters.map(r => r.roster_id)).size !== rosters.length) throw new Error('Sleeper returned invalid roster identifiers.');
  if (!members.some(m => String(m.user_id) === String(user.user_id))) throw new Error('That username is not a member of this league.');
  const own = rosters.find(r => String(r.owner_id) === String(user.user_id) || r.co_owners?.map(String).includes(String(user.user_id)));
  if (!own) throw new Error('This user has no team roster in the selected league.');
  const slots = (league.roster_positions || []).filter(p => !['BN', 'IR', 'TAXI'].includes(p));
  const imported = rosters.map(r => {
    const member = members.find(m => String(m.user_id) === String(r.owner_id));
    const name = String(member?.metadata?.team_name || member?.display_name || member?.username || `Team ${r.roster_id}`).slice(0, 100);
    return { id: `sl_${r.roster_id}`, ticker: `TM${r.roster_id}`, name, manager: String(member?.display_name || member?.username || 'Unclaimed team').slice(0, 80), rosterId: r.roster_id, playerIds: [...new Set([...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])])],
      wins: Number(r.settings?.wins || 0), losses: Number(r.settings?.losses || 0), ties: Number(r.settings?.ties || 0),
      price: 10000, previous: 10000, points: 0, history: [{ week: 0, price: 10000 }] };
  });
  let settledWeek = 0;
  const skippedWeeks = [];
  for (const { week, matchups } of weeks.sort((a, b) => a.week - b.week)) {
    if (!Array.isArray(matchups) || !matchups.length) continue;
    const scores = imported.map(t => {
      const m = matchups.find(m => Number(m.roster_id) === Number(t.rosterId));
      const raw = m?.custom_points ?? m?.points;
      return raw === null || raw === undefined ? null : Number(raw);
    });
    if (scores.some(s => s === null || !Number.isFinite(s))) { skippedWeeks.push(week); continue; }
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    imported.forEach((t, i) => {
      t.previous = t.price;
      t.price = average > 0 ? nextPrice(t.price, scores[i], average) : t.price;
      t.points = scores[i];
      t.history.push({ week, price: t.price });
    });
    settledWeek = week;
  }
  const playerIds = [...new Set([...(own.players || []), ...(own.starters || []), ...(own.reserve || []), ...(own.taxi || [])])].filter(id => id && id !== '0');
  const players = playerIds.map(id => {
    const p = catalog[id];
    return { id, name: String(p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || `Player ${id}`).slice(0, 100),
      position: String(p?.position || '?'), club: String(p?.team || 'FA'), injury: p?.injury_status ? String(p.injury_status) : null };
  });
  return { user: { id: String(user.user_id), username: String(user.username || user.user_id), name: String(user.display_name || user.username || user.user_id) },
    league: { id: String(league.league_id), name: String(league.name || 'Sleeper league').slice(0, 120), season: String(league.season), status: league.status, type: Number(league.settings?.type||0), draftRounds: Number(league.settings?.draft_rounds||0), scoring: league.scoring_settings||{} },
    ownTeam: `sl_${own.roster_id}`, roster: own.starters || [], bench: playerIds.filter(id => !(own.starters || []).includes(id)), players, slots,
    teams: imported, settledWeek, currentWeek: Number(nfl.week || 0), skippedWeeks, syncedAt: new Date().toISOString() };
}
export function createSleeperClient({ fetcher = globalThis.fetch, cache = new Map(), clock = Date.now } = {}) {
  const pending = new Map();
  async function get(path, ttl = 30000) {
    const cached = cache.get(path);
    if (cached && cached.expires > clock()) return cached.data;
    if (pending.has(path)) return pending.get(path);
    const work = (async () => {
      let response;
      try { response = await fetcher(`${BASE}/${path}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' }, redirect: 'error' }); }
      catch { throw new Error('Sleeper is unreachable right now. Try again shortly; your saved market is unchanged.'); }
      if (response.status === 429) throw new Error('Sleeper is receiving too many requests. Wait a minute and try again.');
      if (!response.ok) throw new Error(`Sleeper could not load this data (${response.status}). Try again shortly.`);
      let data; try { data = await response.json(); } catch { throw new Error('Sleeper returned an unreadable response. Try again shortly.'); }
      cache.set(path, { data, expires: clock() + ttl });
      return data;
    })();
    pending.set(path, work);
    try { return await work; } finally { pending.delete(path); }
  }
  async function userFor(username) {
    const user = await get(`user/${encodeURIComponent(validUsername(username))}`);
    if (!user?.user_id) throw new Error('Sleeper username not found. Check the spelling and try again.');
    return user;
  }
  async function lookup(username, season) {
    const user = await userFor(username), nfl = await get('state/nfl');
    const year = validSeason(season || nfl.season);
    const leagues = await get(`user/${user.user_id}/leagues/nfl/${year}`);
    if (!Array.isArray(leagues)) throw new Error('Sleeper could not list leagues for this user.');
    return { user: { id: String(user.user_id), username: user.username, name: user.display_name || user.username }, season: year,
      leagues: leagues.filter(l => l.sport === 'nfl').map(l => ({ id: String(l.league_id), name: String(l.name), season: String(l.season), teams: l.total_rosters, status: l.status })) };
  }
  async function snapshot(username, leagueId) {
    validLeague(leagueId);
    const [user, league, nfl] = await Promise.all([userFor(username), get(`league/${leagueId}`), get('state/nfl')]);
    if (!league || league.sport !== 'nfl' || String(league.league_id) !== leagueId) throw new Error('This is not an NFL league on Sleeper.');
    const [rosters, members] = await Promise.all([get(`league/${leagueId}/rosters`), get(`league/${leagueId}/users`)]);
    if (!Array.isArray(members) || !members.some(m => String(m.user_id) === String(user.user_id))) throw new Error('That username is not a member of this league.');
    const catalog = await get('players/nfl', 86400000);
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('Sleeper player data is unavailable.');
    const weeks = [], limit = completedWeeks(league, nfl);
    for (let start = 1; start <= limit; start += 3) {
      const batch = await Promise.all(Array.from({ length: Math.min(3, limit - start + 1) }, async (_, index) => {
        const week = start + index;
        return { week, matchups: await get(`league/${leagueId}/matchups/${week}`) };
      }));
      weeks.push(...batch);
    }
    return buildSnapshot(user, league, rosters, members, catalog, weeks, nfl);
  }
  return { lookup, snapshot, get };
}
