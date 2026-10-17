# Backend walkthrough

FF Trading is a Node.js HTTP service, a PostgreSQL database in production, SQLite for local development, provider adapters, and a deterministic valuation/trade engine. The browser sends selections and settings; the server computes values and validates ownership.

## Responsibilities

| File                                    | Responsibility                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `application.js`                        | Shared HTTP routing, account context, refresh orchestration and responses      |
| `server.js`, `api/index.js`             | Local listener and Vercel entry point                                          |
| `storage.js`, `postgres.js`             | Driver selection, asynchronous queries and transaction isolation               |
| `migrate-cloud.js`, `import-sqlite.js`  | Cloud schema migration and backup-based local data import                      |
| `database.js`                           | Versioned atomic migrations and transactions                                   |
| `auth.js`                               | Password hashing and single-use email links, login sessions and throttling     |
| `sleeper.js`                            | Fixed-origin public league imports, caching and timeouts                       |
| `fantasy.js`                            | Statistics refresh, frozen analysis inputs, league settings and model assembly |
| `valuation.js`, `prospects.js`          | Production values, dynasty priors, scoring and lineup optimization             |
| `trade-engine.js`                       | Ownership checks, roster consequences and bounded offer discovery              |
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

`league_settings` has a composite primary key `(account, league)`, with `demo-real-2026-v1` for the real-player example rosters. Earlier fictional demo saves remain stored separately and are not reinterpreted as real-player selections. `PUT /api/analysis/settings` is the only HTTP operation that writes valuation settings. Switching leagues loads that league's settings/defaults. Saved scenarios remain scoped to their account and league, and retain selections, waiver setting, complete result, model version, statistics timestamp and analysis-refresh timestamp. Older linked-league scenarios retain their recorded result and can load selections against the current league format.

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

Production uses asynchronous PostgreSQL queries, shared account-scoped state, shared request limits and expiring database refresh leases. Transactions pin one PostgreSQL connection per request. Vercel instances share durable state without sharing uncommitted transactions. Local SQLite remains synchronous, and CPU-bound trade search can still block a single instance. Snapshot storage duplicates some provider data per linked league; dataset deduplication and worker-based calculations are sensible future scale work. Account email uses Resend for verification and expiring password-reset links. Sleeper public imports do not authenticate ownership of a Sleeper account. The model remains heuristic, and custom league scoring is only partially represented. Vercel hosts production and follows the connected GitHub production branch. Centralized alerting and scheduled refresh remain future work. See DEPLOYMENT.md for environment separation, schema migration and persistence verification.

## Dynasty pick anchor, model 2.3.0

Verified first-year rookie selections use the same slot curve as next year’s picks. A 12-team 1.01 is 2,600 model units; a slow start with limited exposure retains 90%, or 2,340. No games means no performance discount. After half a season of games or opportunities, the discount grows toward 35% with sustained poor evidence. Established production may exceed the anchor. The anchor is already priced for league size and superflex and receives no second age or QB premium. It expires after the first NFL season. Unknown or unverified selections retain the existing NFL-capital fallback, without inventing rookie ADP. Redraft and scoring pace are unchanged.

Unknown future picks remain estimates. In the trade builder, First in round simulates 1.01, 2.01 and so on; it does not claim a future draft order is known. All pick tiers now share the same curve as the rookie anchor, so dynasty pick and player comparisons remain consistent. Each additional future year retains the existing 15% discount. Previous saved scenarios retain their original model version and values.

The versioned rookie-benchmarks.js file records explicit owner-supplied assumptions. Jeremiyah Love uses the requested 2026 1.01 benchmark when no verified league selection is available. The UI identifies this source rather than presenting it as Sleeper draft history or consensus ADP.

Schema migration 4 adds verified email records and hashed, expiring email tokens. The former users column is retained only for migration compatibility; no endpoint accepts it. Existing credentials, sessions, and leagues are preserved.

## Data size and historical context

Prepared reads no longer fetch the full Sleeper player catalog. Frozen inputs are reused for up to five minutes per instance, after a small account/league refresh-version query. The cache holds at most four snapshots and is invalidated on local refresh. This is a performance cache; PostgreSQL remains authoritative.

Current provider rows retain only scoring and usage fields. Last-season data is one per-player summary rather than another weekly file in every account. Current stats keep their six-hour cache; successful historical summaries share a 30-day cache and failed history lookups back off for 15 minutes. No scheduled polling or paid feed is added. Reads and scoring changes remain offline. Missing historical data degrades to the current model without losing the previous prepared snapshot on a failed current-stat import.

`node compact-data.js` previews an existing-input compaction. After testing in preview, `node compact-data.js --apply` creates an ignored backup and updates inputs atomically. It checks that PPR, half PPR and standard historical row scores are unchanged. Local historical validation files can seed prior-year summaries. Account identities, roster links, refresh timestamps and saved trade results are retained.

## NFL news

`news.js` reads ESPN's public NFL RSS feed. `GET /api/news` is public and never creates an account or reads a user's league. The browser checks on opening News and every ten minutes while the tab is visible. A manual check respects the same shared cache.

The service stores up to 20 headlines in `fantasy_cache`, with a ten-minute freshness window. A separate expiring cache lease coordinates cloud instances; a process-local promise coalesces requests and a one-minute memory cache reduces database reads. Failed provider requests back off for ten minutes and retain the last successful timestamp. Stories older than seven days are hidden. Empty and delayed feeds are described in the interface rather than filled with sample news.

Requests have a ten-second timeout and a 256 KB body limit. XML declarations of external entities are rejected. Only valid publication dates and HTTPS links on ESPN's allowed hosts are accepted, and the browser escapes feed text. Headlines stay unchanged, credit ESPN and link to the publisher. News is independent of valuations and does not trigger league refreshes. This adds no API key, paid service, scheduled job or database migration.

Each news card has a native Quick summary disclosure containing the publisher-provided preview. Preview text is preserved and escaped before rendering, never inserted as HTML. Missing or oversized previews show an unavailable message. Previews travel in the same cached feed response, with no extra article requests or AI calls.

League format comes from the linked Sleeper league type and cannot be changed by settings overrides. Unlinked requests always use redraft. `demo-data.json` bundles 300 real players across 20 example rosters of 15 and completed-game public nflverse statistics with source and capture time. `sleeper.js` normalizes fractional season point totals separately from weekly matchup scores. Legacy imports can read those standings from the existing cached roster response without a provider call. Trade simulations accept any two league roster IDs; changing the comparison team never changes the user’s actual linked roster or account.

League standings order teams by record (win percentage, counting a tie as half a win), then wins and season points. FF Score displays the existing combined playerValue and pickValue without changing the ordering or making provider calls.

`customTeams` is allowed only when `model.linked === false`. The trade engine creates a temporary selected-player comparison and disables waiver additions. It rejects duplicate/unknown assets and never mutates the original model. Linked leagues reject this flag and continue to validate every asset against its actual owner. Saved comparisons retain the flag for replay. Public comparison results omit inferred lineup and roster-consequence displays.

Manual value adjustments are removed. The engine rejects nonempty legacy `assumptions` input, normalizes standard model values and unknown pick slots, and no longer generates sensitivity variants. The browser does not restore legacy adjustment or waiver settings; new analyses disable hypothetical waiver additions. Historical saved results remain stored, while loading their players recalculates against current standard values.

Model 2.5.0 uses one calibrated draft-values curve for future picks and verified rookie pick context. NFL draft metadata priors in prospects.js are expressed on the corresponding lower scale; this avoids an unverified generic rookie exceeding a verified 1.01 merely because of obsolete units. Values and FF Scores recalculate from saved inputs without a provider refresh, schema migration or additional service. Historical saved results retain their original model version.

### Game eligibility and injury exclusions

Model 2.6.0 filters game samples through `game-eligibility.js` before calculating PPG, recent form, usage, consistency, and player values. Raw provider rows remain intact. Missing weeks are not synthesized as zero-point games. A real zero-point appearance remains in the sample unless game-specific evidence confirms non-participation or injury.

The reviewed evidence ledger is keyed by season, season type, week, and GSIS player ID. Kyler Murray's 2026 Week 1 concussion is confirmed by the Vikings and excluded from both reference and linked-league calculations. His missed Week 2 has no stats row and never contributes a zero. The reference sample changes from four recorded appearances (9.9 PPG) to three included games (13.4 PPG) under default scoring. Player details show the removed week, reason, source, and original recorded PPG.

Normalized `game_participation=injury_exit` rows require an HTTPS `game_evidence_source`; `did_not_play` excludes a non-playing row. Compaction preserves these fields and newly built historical summaries apply the same eligibility function. Existing frozen historical summaries cannot be reclassified without their original weekly evidence and a refresh. Current injury status affects availability separately and does not retroactively erase healthy games.

Coverage is deliberately incomplete: nflverse weekly scoring rows are not a comprehensive in-game injury-event feed. The application does not automatically generate these flags from news, pregame designations, or low snap counts. Each new reviewed ledger entry needs a primary source. This release adds no provider requests, background tasks, paid APIs, or database migration. Do not describe this sample as guaranteed healthy/full games or claim every league injury is automatically detected.

### Saved stories and trade participants

Saved Notes renders both trade sides from the saved result's `sent` and `received` assets, preserving names and draft picks at save time. Older entries without those arrays fall back to their input IDs and the current model, with an explicit unavailable label for missing assets. Historical values are not recalculated by viewing a save.

`GET/POST/DELETE /api/news/saved` stores up to 50 small account-scoped ESPN bookmarks in the existing `account_preferences` JSON record. POST accepts only a URL and resolves title/date from the validated shared news feed; it never fetches caller-supplied URLs. GET and DELETE work after a headline expires from the feed. No article bodies or previews are copied. Guest bookmarks belong to their guest workspace; registered accounts can access theirs across devices. Responses use the existing private API cache policy.

`preferences.updatePreferences` uses bounded compare-and-swap updates to preserve concurrent favorite-team changes and story saves across instances. Saving a favorite team no longer replaces the entire preferences document. This reuses schema 4 without a migration or new scheduled/provider work. News saving uses the existing shared feed cache, rate limits mutations, deduplicates URLs, validates HTTPS ESPN links, and bounds storage. `saved-news.test.js` covers storage/isolation/concurrency and `server.test.js` covers the feed-to-bookmark API flow.

### Player stat help and game logs

`public/player-profile.js` keeps each displayed statistic next to its plain-language explanation. Native details disclosures work on touchscreens and keyboards without hover-only tooltips. Consistency is a clamped 0 to 100 inverse coefficient-of-variation score from included fantasy game scores; it measures steadiness, not player quality or a probability.

`GET /api/analysis/player?id=...` resolves a player within the requesting account's active analysis and returns a compact current-season weekly log plus position, season and scoring settings. The service reuses frozen weekly inputs and stops before team aggregation or saved-scenario reads. Logs never enter the general 300-player response or saved-trade assets. Fantasy points use the same pointsFor function as valuation, and injury exclusions remain visible with their reasons. Missing weeks are not synthesized into games. Opponents and dates are omitted because those fields are not retained in these inputs.

Opening a profile requests its log on demand. A small eight-entry, five-minute browser cache is keyed by account, league, scoring settings, model version and data freshness. It clears on account reload; a request sequence prevents older responses from replacing a newer profile. Errors offer retry. This adds a small first-open API read, but no provider request, paid service, schema change, scheduled job or extra weekly-data storage. Last-season context remains a summary; these logs show the available current-season weekly rows only.

### Imported scoring and manual overrides

Superflex detection reads Sleeper starting slots: SUPER_FLEX or multiple QB slots. `league-format.scoringOverrides` distinguishes new explicit overrides from legacy rows that copied a complete settings snapshot. A legacy copied QB flag no longer overrides a linked league's imported QB format. Existing legacy non-QB scoring choices remain readable. New settings documents use `{ version: 1, overrides: { ... } }` in the existing text column, so no schema migration is needed.

The client now sends only the control that changed. Saving reception scoring does not also pin QB format, passing TD points and TE premium to their old values. Overrides equal to imported defaults are dropped. New explicit QB overrides remain supported and visible. `leagueSettings` in the analysis response contains imported supported rules, active differences and original starting slots; these are distinct from the adjusted lineup slots used for a manual simulation.

Use Sleeper settings resets only the current account's active league settings row, then recomputes from the stored import. It does not change the Sleeper league, reimport providers, or touch another league's overrides. Account → Sleeper → View league settings opens the controls and imported-rule details. Full Sleeper sync remains the way to update changed upstream league settings. `league-format.test.js` and the API regression test cover Superflex, 2QB, legacy recovery, scoped overrides and reset.
