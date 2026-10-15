# Backend walkthrough

FF Trading is a Node.js HTTP service, a SQLite database, provider adapters, and a deterministic valuation/trade engine. The browser sends selections and settings; the server computes values and validates ownership.

## Responsibilities

| File                                    | Responsibility                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `server.js`                             | HTTP routing, account context, refresh orchestration, responses                |
| `database.js`                           | Versioned atomic migrations and transactions                                   |
| `auth.js`                               | Password/recovery hashing, login sessions and throttling                       |
| `sleeper.js`                            | Fixed-origin public league imports, caching and timeouts                       |
| `fantasy.js`                            | Statistics refresh, frozen analysis inputs, league settings and model assembly |
| `valuation.js`, `prospects.js`          | Production values, dynasty priors, scoring and lineup optimization             |
| `trade-engine.js`                       | Ownership checks, roster consequences, assumptions and bounded offer discovery |
| `model-version.js`, `evaluate-model.js` | Explicit model identity and repeatable behavioral evaluation                   |
| `errors.js`                             | Public error policy and allowlisted request logging                            |

## Read versus refresh

`GET /api/analysis` reads the account's active league, its saved analysis snapshot and its league-specific settings. It performs no provider fetches and does not write settings. An initial guest visit can create a guest account/session; this is separate from analysis/model reads.

`POST /api/sleeper/link`, `/api/sleeper/sync` or `/api/analysis/refresh` imports league data and prepares statistics/metadata. Cache TTLs avoid unnecessary upstream downloads. The compact player catalog, statistics, metadata and metadata observation date are saved as frozen inputs. The connection and inputs are committed in one transaction after required data is prepared. A failed initial refresh returns 503 and does not commit a partial link. Existing snapshots remain available; stale cached statistics can be retained with a warning. Optional rookie-draft history can fail without discarding the rest of the snapshot.

Trade/save/finder requests compute from frozen inputs and settings; they never wait for providers. Another account refreshing a shared cache does not change these inputs. The UI displays the refresh time and a refresh recommendation after six hours. Existing pre-migration links need **Refresh league data** once before trade analysis is enabled. Refresh is explicit, not a scheduler or background worker.

## Scoring defaults and player normalization

The `league-format.js` helper imports only supported scoring controls, including TE reception premium. Unsupported premium values produce a warning. The `player-metadata.js` helper gives rostered players and free agents the same valuation inputs; ownership does not change prospect protection.

Analysis exposes three separate flags: `ready` for a usable prepared model, `productionAvailable` for completed-game history, and `prospectOnly` for a dynasty comparison using prospect/pick estimates. In prospect-only mode, current-production and starter-pace result fields are null and the UI labels them unavailable. Unverified players and starter-improvement goals are excluded from that mode. A missing saved snapshot remains blocked.

## Settings and saved results

`league_settings` has a composite primary key `(account, league)`, with `demo` as the fictional league. `PUT /api/analysis/settings` is the only HTTP operation that writes valuation settings. Switching leagues loads that league's settings/defaults. Saved scenarios remain scoped to their account and league, and retain selections, assumptions, waiver setting, complete result, model version, statistics timestamp and analysis-refresh timestamp. Old scenarios are labeled legacy/unversioned and remain loadable.

## Data migrations

Before the first migration of an existing database, startup creates a native SQLite backup under `data/backups/before-backend-v3-<timestamp>.sqlite` (or `backups/` beside a custom `DB_PATH`). This captures WAL contents as well. Startup stops if backup or migration fails.

Migration 1 archives the former stock-table rows and old account/link/settings representations in `legacy_archive`, removes stock tables and obsolete account/link columns, and moves account-wide settings into the league active at migration time. Other leagues start with their own defaults. Accounts, user credentials, sessions, links and saved scenarios are retained. Foreign-key verification runs before commit. A migration error rolls back the schema/data changes and foreign-key enforcement is restored. The archive is inert and has no HTTP endpoint. Backup/restore should be done with the server stopped; never commit database files or backups.

The removed `/api/trades`, `/api/roster`, `/api/simulate` and `/api/reset` routes return 404. No runtime code creates cash balances, share holdings, quotes or price histories. Empty historical internal account identities are retained to avoid guessing which identities are safe to delete.

## Model evaluation

Run `node evaluate-model.js` (or `npm run evaluate` with a working npm installation). The JSON report includes model version, ten synthetic archetypes, production-only comparisons and eight pass/fail behavioral checks. It covers elite/late rookies, preseason prospects, breakouts, second/third-year players, productive/aging veterans, QB and TE development. `node --test` includes this evaluation and independent scoring, roster, settings, snapshot, authentication and migration tests.

This evaluates intended behavior, **not predictive accuracy**. There is no invented real-player ground truth, consensus feed or accuracy percentage. A future historical evaluation must freeze date-stamped inputs, reserve unseen outcomes and avoid future-data leakage before making accuracy claims. Bump `MODEL_VERSION` when valuation behavior changes; saved results remain attributable to their original version.

## Errors and observability

Every response has an `X-Request-ID`. Error JSON includes `error`, stable `code` and matching `requestId`.

| Status    | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| 400       | Invalid selections, settings, credentials format or JSON |
| 401 / 403 | Failed authentication / rejected cross-origin mutation   |
| 404 / 405 | Missing resource or removed route / wrong HTTP method    |
| 409       | Refresh already running or analysis snapshot not ready   |
| 413 / 415 | Oversized body / incorrect content type                  |
| 429       | Authentication throttled or password hashing busy        |
| 503       | Required provider data unavailable                       |
| 500       | Unexpected internal failure; generic public message      |

Completed requests produce JSON logs containing only request ID, method, fixed route name, status, duration and optional error code. Unknown routes log as `unknown`. Bodies, queries, cookies, credentials, email addresses, provider identities and raw exceptions are excluded. Use the request ID shown by the UI to locate a failed request. Logs establish where/when a failure occurred; they do not include raw stack traces.

## Remaining limits

This is a single-process prototype: synchronous SQLite queries and CPU-bound trade search can block other requests. Snapshot storage duplicates some provider data per linked league; dataset deduplication and worker-based calculations are sensible future scale work. Authentication has recovery codes rather than verified email/reset delivery. Sleeper public imports do not authenticate ownership of a Sleeper account. The model remains heuristic, and custom league scoring is only partially represented. Public hosting, centralized monitoring and scheduled refresh are separate deployment work.
