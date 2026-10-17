import { readFileSync } from 'node:fs';
export const DEMO_LEAGUE = 'demo-real-2026-v1';
const demoData = JSON.parse(readFileSync(new URL('./demo-data.json', import.meta.url), 'utf8'));
/** Fantasy application service. Refresh prepares inputs; model reads them without fetching providers. */
import { normalizePlayer } from './player-metadata.js';
import { leagueDefaults, scoringOverrides, SCORING_KEYS } from './league-format.js';
import { provider } from './errors.js';
import {
  compactRows,
  compactInputs,
  summarizeHistory,
  playerMatchKey,
  historyNameIndex,
} from './stat-inputs.js';
import { MODEL_VERSION } from './model-version.js';
import {
  parseCSV,
  settingsFor,
  valuePlayer,
  playerGameLog,
  pickInventory,
  pickValue,
  lineupPace,
} from './valuation.js';
const number = (v) =>
  v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const normal = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(jr|sr|iii|ii|iv)$/, '');
export function createFantasy(db, { fetcher = globalThis.fetch } = {}) {
  // Each table has one storage responsibility: provider cache, inputs, settings or saved results.
  if (!db.remote)
    db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_snapshots (
      account TEXT NOT NULL REFERENCES accounts(id),
      league TEXT NOT NULL,
      data TEXT NOT NULL,
      refreshed TEXT NOT NULL,
      PRIMARY KEY (account, league)
    );
    CREATE TABLE IF NOT EXISTS fantasy_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS league_settings (
      account TEXT NOT NULL REFERENCES accounts(id),
      league TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (account, league)
    );
    CREATE TABLE IF NOT EXISTS trade_scenarios (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL REFERENCES accounts(id),
      data TEXT NOT NULL,
      created TEXT NOT NULL
    );
  `);
  const inFlight = new Map();
  const inputCache = new Map();
  async function frozenInputs(account, league) {
    const key = account + ':' + league;
    const stamp = await db
      .prepare('SELECT refreshed FROM analysis_snapshots WHERE account=? AND league=?')
      .get(account, league);
    if (!stamp) return null;
    const saved = inputCache.get(key);
    if (saved?.refreshed === stamp.refreshed && Date.now() - saved.loaded < 5 * 60000) return saved;
    const row = await db
      .prepare('SELECT data,refreshed FROM analysis_snapshots WHERE account=? AND league=?')
      .get(account, league);
    const result = { inputs: JSON.parse(row.data), refreshed: row.refreshed, loaded: Date.now() };
    if (inputCache.size >= 4) inputCache.delete(inputCache.keys().next().value);
    inputCache.set(key, result);
    return result;
  }
  /** Prior-year data is summarized once and shared, with a 30-day freshness window. */
  async function history(season) {
    const key = 'history:' + season;
    if (inFlight.has(key)) return inFlight.get(key);
    const job = (async () => {
      const cached = await db
        .prepare('SELECT data,fetched FROM fantasy_cache WHERE key=?')
        .get(key);
      const cachedData = cached ? JSON.parse(cached.data) : null;
      if (cached && Date.now() - cached.fetched < (cachedData.warning ? 15 * 60000 : 30 * 86400000))
        return cachedData;
      try {
        const response = await fetcher(
          `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
          { signal: AbortSignal.timeout(20000) },
        );
        if (!response.ok) throw new Error('History unavailable');
        const text = await response.text();
        if (text.length > 20000000) throw new Error('History too large');
        const rows = parseCSV(text).filter(
          (r) => r.season_type === 'REG' && (!r.season || Number(r.season) === season),
        );
        if (!rows.length || !rows[0].player_id) throw new Error('Invalid history');
        const result = summarizeHistory(rows, season);
        await db
          .prepare(
            'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',
          )
          .run(key, JSON.stringify(result), Date.now());
        return result;
      } catch {
        if (cachedData && !cachedData.warning) return cachedData;
        const unavailable = {
          season,
          players: {},
          warning: 'Last-season context is unavailable; using current-season data only.',
        };
        await db
          .prepare(
            'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',
          )
          .run(key, JSON.stringify(unavailable), Date.now());
        return unavailable;
      }
    })();
    inFlight.set(key, job);
    try {
      return await job;
    } finally {
      inFlight.delete(key);
    }
  }
  /** Refresh the NFL metadata cache, retaining saved metadata during provider outages. */
  async function metadata() {
    const cached = await db
      .prepare('SELECT * FROM fantasy_cache WHERE key=?')
      .get('player-metadata-v2');
    const legacy = await db
      .prepare('SELECT * FROM fantasy_cache WHERE key=?')
      .get('player-metadata');
    if (cached && Date.now() - cached.fetched < 86400000) return JSON.parse(cached.data);
    try {
      const r = await fetcher(
        'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',
        { signal: AbortSignal.timeout(20000) },
      );
      if (!r.ok) throw new Error();
      const text = await r.text();
      if (text.length > 20000000) throw new Error();
      const result = Object.fromEntries(
        parseCSV(text)
          .filter((p) => p.gsis_id)
          .map((p) => [
            p.gsis_id,
            {
              draftRound: number(p.draft_round),
              birth: p.birth_date,
              draftPick: number(p.draft_number) || number(p.draft_pick),
              draftYear: number(p.draft_year),
            },
          ]),
      );
      await db
        .prepare(
          'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',
        )
        .run('player-metadata-v2', JSON.stringify(result), Date.now());
      return result;
    } catch (error) {
      if (error?.code === 'ERR_SQLITE_ERROR') throw error;
      return cached ? JSON.parse(cached.data) : legacy ? JSON.parse(legacy.data) : {};
    }
  }
  /** Refresh one season of regular-season statistics and coalesce concurrent requests. */
  async function stats(season) {
    if (inFlight.has(season)) return inFlight.get(season);
    const job = (async () => {
      const cached = await db
        .prepare('SELECT * FROM fantasy_cache WHERE key=?')
        .get(`stats:${season}`);
      if (cached && Date.now() - cached.fetched < 6 * 3600000)
        return { ...JSON.parse(cached.data), fetched: cached.fetched };
      try {
        const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
        const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) {
          throw new Error('Stats provider unavailable');
        }
        const text = await response.text();
        if (text.length > 20000000) throw new Error('Stats file too large');
        const rawRows = parseCSV(text).filter(
          (r) => r.season_type === 'REG' && (!r.season || Number(r.season) === season),
        );
        if (!rawRows.length || !rawRows[0].player_id || !('targets' in rawRows[0]))
          throw new Error('Invalid stats file');
        const rows = compactRows(rawRows);
        const data = { season, rows, source: 'nflverse weekly player statistics', url };
        const fetched = Date.now();
        await db
          .prepare(
            'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',
          )
          .run(`stats:${season}`, JSON.stringify(data), fetched);
        return { ...data, fetched };
      } catch (error) {
        if (error?.code === 'ERR_SQLITE_ERROR') throw error;
        if (cached)
          return {
            ...JSON.parse(cached.data),
            fetched: cached.fetched,
            warning: 'Using cached statistics because the stats provider is unavailable.',
          };
        return {
          season,
          rows: [],
          source: 'Stats unavailable',
          warning:
            'Advanced statistics could not load. Values shown are metadata estimates; refresh stats before analyzing trades.',
        };
      }
    })();
    inFlight.set(season, job);
    try {
      return await job;
    } finally {
      inFlight.delete(season);
    }
  }
  /** Assemble player values and roster summaries from saved inputs and league settings. */
  async function model(account, snapshot, catalog, input, profilePlayer = null) {
    const league = snapshot?.league.id || DEMO_LEAGUE;
    const savedSnapshot = snapshot ? await frozenInputs(account, league) : null;
    const inputs = savedSnapshot?.inputs || null;
    const metadataTime = inputs?.asOf ? new Date(inputs.asOf).getTime() : Date.now(),
      metadataYear = new Date(metadataTime).getUTCFullYear();
    if (inputs) {
      catalog = inputs.catalog;
      snapshot = { ...snapshot, analysisRefreshedAt: savedSnapshot.refreshed };
    }
    const stored = await db
      .prepare('SELECT data FROM league_settings WHERE account=? AND league=?')
      .get(account, league);
    const imported = leagueDefaults(snapshot);
    const overrides = scoringOverrides(stored ? JSON.parse(stored.data) : null, snapshot);
    const settings = settingsFor(input, { ...imported.settings, ...overrides });
    settings.mode = imported.settings.mode;
    const season = Number(snapshot?.league.season || demoData.season);
    let data,
      teams,
      allPlayers,
      slots,
      picks,
      historical = null;
    if (snapshot) {
      const statistics = inputs?.statistics || (await readStats(season)),
        meta = inputs?.metadata || (await readMetadata());
      historical =
        inputs?.history ||
        (statistics.season === season - 1 ? summarizeHistory(statistics.rows, season - 1) : null);
      data =
        statistics.season === season
          ? statistics
          : {
              season,
              rows: [],
              source: 'Current-season stats unavailable',
              warning: 'Last-season data is context only, not current-season production.',
            };
      const through = data.season === season ? snapshot.settledWeek : 18;
      data = { ...data, rows: data.rows.filter((r) => Number(r.week) <= through) };
      teams = snapshot.teams.map((t) => ({ ...t, playerIds: t.playerIds || [] }));
      slots = snapshot.slots;
      const buildPlayer = (id, owner) => {
        const player = catalog[id] || snapshot.players.find((player) => player.id === id) || {};
        return normalizePlayer(id, owner, player, meta[player.gsis_id] || {}, {
          observedAt: metadataTime,
          metadataYear,
          season,
          rookieDraft: snapshot.rookieDrafts?.players?.[id],
        });
      };
      allPlayers = teams.flatMap((team) => team.playerIds.map((id) => buildPlayer(id, team.id)));
      const rostered = new Set(allPlayers.map((p) => p.id)),
        withStats = new Set([
          ...data.rows.map((r) => r.player_id),
          ...Object.keys(historical?.players || {}),
        ]);
      for (const [id, p] of Object.entries(catalog))
        if (
          !rostered.has(id) &&
          p.active &&
          ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position) &&
          (withStats.has(p.gsis_id) || Number(p.years_exp) <= 1)
        ) {
          allPlayers.push(buildPlayer(id, 'free_agent'));
        }
      picks = pickInventory(snapshot);
    } else {
      teams = demoData.teams;
      slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'];
      allPlayers = demoData.players.map((p) => ({
        ...p,
        age: p.birth
          ? Math.floor((new Date(demoData.asOf) - new Date(p.birth)) / (365.2425 * 86400000))
          : null,
      }));
      data = {
        season,
        rows: demoData.rows,
        source: demoData.source,
        url: demoData.url,
        fetched: new Date(demoData.asOf).getTime(),
      };
      picks = [];
    }
    if (
      settings.superflex &&
      !slots.includes('SUPER_FLEX') &&
      slots.filter((s) => s === 'QB').length < 2
    ) {
      slots = [...slots];
      const flex = slots.indexOf('FLEX');
      if (flex >= 0) slots[flex] = 'SUPER_FLEX';
      else slots.push('SUPER_FLEX');
    }
    if (!settings.superflex) {
      let qb = 0;
      slots = slots.map((s) => (s === 'SUPER_FLEX' ? 'FLEX' : s === 'QB' && ++qb > 1 ? 'FLEX' : s));
    }
    const byGSIS = new Map(),
      byName = new Map();
    for (const r of data.rows) {
      if (!byGSIS.has(r.player_id)) byGSIS.set(r.player_id, []);
      byGSIS.get(r.player_id).push(r);
      const k = normal(r.player_display_name) + ':' + r.position;
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(r.player_id);
    }
    const pastNames = historyNameIndex(historical?.players);
    const players = allPlayers.map((p) => {
      let rows = p.gsis ? byGSIS.get(p.gsis) : null;
      if (!rows) {
        const ids = byName.get(normal(p.name) + ':' + p.position);
        if (ids?.size === 1) rows = byGSIS.get([...ids][0]);
      }
      let past = historical?.players?.[p.gsis] || historical?.players?.[rows?.[0]?.player_id];
      if (!past) {
        const ids = pastNames.get(playerMatchKey(p.name, p.position));
        if (ids?.size === 1) past = historical.players[[...ids][0]];
      }
      const valued = valuePlayer(
        p,
        (rows || []).sort((a, b) => Number(a.week) - Number(b.week)),
        settings,
        season,
        past && p.experience !== 0 && p.draftYear !== season
          ? { ...past, season: historical.season }
          : null,
      );
      if (profilePlayer === p.id)
        return { ...valued, gameLog: playerGameLog(p, rows || [], settings, season) };
      return valued;
    });
    // Profile reads return before team aggregation and saved-scenario queries.
    if (profilePlayer !== null) {
      const player = players.find((player) => player.id === profilePlayer);
      return player
        ? { gameLog: player.gameLog, position: player.position, season, settings }
        : null;
    }
    picks = picks.map((p) => ({
      ...p,
      value: pickValue(p, settings, season),
      low: pickValue(p, settings, season, 'late'),
      high: pickValue(p, settings, season, 'early'),
    }));
    teams = teams.map((t) => {
      const roster = players.filter((p) => p.owner === t.id),
        ownedPicks = picks.filter((p) => p.owner === t.id);
      return {
        id: t.id,
        name: t.name,
        manager: t.manager,
        wins: t.wins ?? null,
        losses: t.losses ?? null,
        ties: t.ties ?? null,
        pointsFor: t.pointsFor ?? null,
        pointsAgainst: t.pointsAgainst ?? null,
        rosterLimit: snapshot?.rosterLimit || (!snapshot ? demoData.rosterLimit : null),
        protectedIds: t.protectedIds || [],
        playerValue: roster.reduce((s, p) => s + p.value, 0),
        pickValue: settings.mode === 'dynasty' ? ownedPicks.reduce((s, p) => s + p.value, 0) : 0,
        pace: data.rows.length
          ? lineupPace(
              roster.filter((p) => !(t.protectedIds || []).includes(p.id)),
              slots,
            )
          : null,
        playerCount: roster.length,
      };
    });
    const leagueExpression = db.remote ? "data::jsonb->>'league'" : "json_extract(data,'$.league')";
    const saved = (
      await db
        .prepare(
          'SELECT id,data,created FROM trade_scenarios WHERE account=? AND ' +
            leagueExpression +
            '=? ORDER BY created DESC LIMIT 20',
        )
        .all(account, snapshot?.league.id || DEMO_LEAGUE)
    ).map((r) => ({ id: r.id, ...JSON.parse(r.data), created: r.created }));
    const productionAvailable = data.rows.length > 0;
    const hasProspect = players.some(
      (player) => player.prospect && player.prospect.source !== 'Limited metadata prior',
    );
    const prospectOnly = Boolean(
      snapshot &&
        inputs &&
        settings.mode === 'dynasty' &&
        !productionAvailable &&
        (hasProspect || picks.length),
    );
    const ready = (!snapshot || Boolean(inputs)) && (productionAvailable || prospectOnly);
    return {
      modelVersion: MODEL_VERSION,
      settings,
      leagueSettings: {
        imported: imported.settings,
        overrides: Object.fromEntries(
          SCORING_KEYS.filter((key) => settings[key] !== imported.settings[key]).map((key) => [
            key,
            settings[key],
          ]),
        ),
        slots: snapshot?.slots || [],
      },
      season,
      ownTeam: snapshot?.ownTeam || 'demo_a',
      teams,
      players,
      picks: settings.mode === 'dynasty' ? picks : [],
      slots,
      data: {
        source: data.source,
        season: data.season,
        throughWeek: Math.max(0, ...data.rows.map((r) => Number(r.week))),
        fetched: data.fetched || null,
        url: data.url || null,
        warning:
          [
            data.warning,
            historical?.warning,
            snapshot && inputs && !inputs.history
              ? 'Refresh league data to add last-season context.'
              : null,
            snapshot?.rookieDrafts?.warning,
            imported.warning,
            prospectOnly
              ? 'Prospect and pick comparison only. No completed-game production is available, so starter pace cannot be estimated.'
              : null,
            ...(!snapshot?.analysisRefreshedAt && snapshot
              ? ['Refresh league data to prepare an analysis snapshot.']
              : []),
          ]
            .filter(Boolean)
            .join(' ') || null,
        ready,
        productionAvailable,
        prospectOnly,
        refreshedAt: snapshot?.analysisRefreshedAt || null,
        stale: Boolean(
          snapshot &&
            (!snapshot.analysisRefreshedAt ||
              Date.now() - new Date(snapshot.analysisRefreshedAt).getTime() > 6 * 3600000 ||
              !data.fetched ||
              Date.now() - data.fetched > 6 * 3600000),
        ),
        matched: players.filter((p) => p.games > 0).length,
        total: players.length,
        historySeason: historical?.season || null,
        historyMatched: players.filter((p) => p.history?.games).length,
        historyRefreshNeeded: Boolean(snapshot && inputs && !inputs.history),
      },
      saved,
      linked: Boolean(snapshot),
      picksAvailable: picks.length > 0,
      methodology: `Redraft combines current scoring and usage with a fading last-season baseline. Dynasty also considers age, draft capital and rookie pick value. Starter pace uses current-season scoring only. Model ${MODEL_VERSION}; estimates, not expert consensus.`,
    };
  }
  async function readMetadata() {
    const cached = await db
      .prepare(
        'SELECT data FROM fantasy_cache WHERE key IN (?,?) ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END LIMIT 1',
      )
      .get('player-metadata-v2', 'player-metadata', 'player-metadata-v2');
    return cached ? JSON.parse(cached.data) : {};
  }
  /** Read available saved history, with an explicit warning for stale or prior-season data. */
  async function readStats(season) {
    const current = await db
      .prepare('SELECT * FROM fantasy_cache WHERE key=?')
      .get('stats:' + season);
    const previous = current
      ? null
      : await db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get('stats:' + (season - 1));
    const cached = current || previous;
    if (!cached)
      return {
        season,
        rows: [],
        source: 'Stats unavailable',
        warning: 'No saved statistics. Use Refresh league data before analyzing trades.',
      };
    return {
      ...JSON.parse(cached.data),
      fetched: cached.fetched,
      ...(!current
        ? {
            warning: 'Using saved prior-season history; current-season statistics are unavailable.',
          }
        : Date.now() - cached.fetched > 6 * 3600000
          ? { warning: 'Saved statistics are stale. Refresh league data to update them.' }
          : {}),
    };
  }
  async function saveSettings(account, snapshot, input) {
    const league = snapshot?.league.id || DEMO_LEAGUE,
      stored = await db
        .prepare('SELECT data FROM league_settings WHERE account=? AND league=?')
        .get(account, league);
    const defaults = leagueDefaults(snapshot).settings;
    const overrides = scoringOverrides(stored ? JSON.parse(stored.data) : null, snapshot);
    const settings = settingsFor(input, { ...defaults, ...overrides });
    for (const key of SCORING_KEYS)
      if (settings[key] === defaults[key]) delete overrides[key];
      else if (Object.hasOwn(input, key)) overrides[key] = settings[key];
    settings.mode = defaults.mode;
    await db
      .prepare(
        'INSERT INTO league_settings VALUES (?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data',
      )
      .run(account, league, JSON.stringify({ version: 1, overrides }));
    return settings;
  }
  async function resetSettings(account, snapshot) {
    await db
      .prepare('DELETE FROM league_settings WHERE account=? AND league=?')
      .run(account, snapshot?.league.id || DEMO_LEAGUE);
  }
  /** Build the frozen provider inputs that a successful league refresh will save. */
  async function prepareSnapshot(snapshot, catalog) {
    const season = Number(snapshot.league.season);
    const [, , previous] = await Promise.all([stats(season), metadata(), history(season - 1)]);
    const slim = Object.fromEntries(
      Object.entries(catalog).map(([id, p]) => [
        id,
        Object.fromEntries(
          [
            'full_name',
            'name',
            'first_name',
            'last_name',
            'position',
            'team',
            'club',
            'injury_status',
            'injury',
            'birth_date',
            'age',
            'draft_round',
            'draft_year',
            'draft_pick',
            'gsis_id',
            'years_exp',
            'active',
          ]
            .filter((k) => p[k] !== undefined)
            .map((k) => [k, p[k]]),
        ),
      ]),
    );
    const statistics = await readStats(Number(snapshot.league.season));
    if (!statistics.rows.length)
      throw provider('Statistics are unavailable. Your previous analysis snapshot is unchanged.');
    return {
      statistics,
      history: previous,
      metadata: await readMetadata(),
      catalog: slim,
      asOf: new Date().toISOString(),
    };
  }
  /** Persist inputs inside the caller's league-import transaction. */
  async function storeSnapshot(account, snapshot, inputs) {
    await db
      .prepare(
        'INSERT INTO analysis_snapshots VALUES (?,?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data,refreshed=excluded.refreshed',
      )
      .run(
        account,
        snapshot.league.id,
        JSON.stringify(
          compactInputs(
            inputs,
            snapshot.teams.flatMap((t) => t.playerIds || []),
          ),
        ),
        snapshot.analysisRefreshedAt,
      );
    inputCache.delete(account + ':' + snapshot.league.id);
  }
  return { model, saveSettings, resetSettings, prepareSnapshot, storeSnapshot };
}
