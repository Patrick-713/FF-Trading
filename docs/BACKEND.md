# Backend and data

FF Trading has a browser frontend, a shared Node.js HTTP application, and a database. Vercel runs the API in production; `server.js` runs the same application locally. Neon Postgres stores production data, while SQLite supports local development and tests.

## Request flow

1. The browser loads static files from `public/`.
2. A user action sends an HTTP request to `/api/...`.
3. `api/index.js` passes the request to `src/http/application.js`.
4. The application identifies the account, validates the input, and calls the relevant service.
5. Services read or write through `src/storage/` and return structured results.
6. The API returns JSON for the browser to display.

## Statistics and valuation flow

Linking or refreshing a Sleeper league imports public league settings, teams, rosters, and supported draft-pick ownership. Provider requests use fixed origins, caching, timeouts, and validation. A refresh prepares compact weekly statistics, player metadata, and previous-season summaries before committing the new snapshot. A failed refresh retains the previous usable snapshot.

Ordinary analysis reads use those frozen inputs. `src/analysis/fantasy.js` combines them with the account's league settings. `src/analysis/valuation.js` calculates scoring and player values, and `src/analysis/trade-engine.js` evaluates hypothetical exchanges. Viewing analysis does not refresh the providers.

## What is stored in Neon

Several `data` columns contain JSON stored as text. The database therefore shows one snapshot record containing many player records rather than a separate SQL row for every statistic.

| Table                                | Stored information                                                          |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `analysis_snapshots`                 | Per-account, per-league prepared analysis inputs and refresh time           |
| `sleeper_links`                      | Imported league and roster snapshot                                         |
| `active_links`                       | The account's selected linked league                                        |
| `league_settings`                    | Explicit account and league scoring overrides                               |
| `fantasy_cache`                      | Shared statistics and metadata provider cache                               |
| `sleeper_cache`                      | Shared Sleeper provider cache                                               |
| `trade_scenarios`                    | Saved trade selections and historical results                               |
| `account_preferences`                | Favorite team and saved news metadata                                       |
| `accounts` and authentication tables | Account identity, hashed credentials, sessions, and single-use email tokens |

`analysis_snapshots.data` includes `statistics.rows`, `catalog`, `metadata`, and optional `history`. Weekly rows retain fields used by scoring and matching. Previous-season data is summarized by player to reduce storage and transfer.

Current trade values are calculated by backend code. Saved trade results retain the model version and values that produced them. Updating the equations can change current values without changing the raw weekly statistics or rewriting historical saved results.

## Where the equations live

| Calculation                                | Implementation                               |
| ------------------------------------------ | -------------------------------------------- |
| Fantasy points from weekly statistics      | `pointsFor` in `src/analysis/valuation.js`   |
| Current and fading previous-season scoring | `src/analysis/redraft-signal.js`             |
| Redraft and dynasty player values          | `valuePlayer` in `src/analysis/valuation.js` |
| Dynasty prospects and rookie protection    | `src/analysis/prospects.js`                  |
| Dynasty draft picks                        | `src/analysis/draft-values.js`               |
| Best eligible lineup by observed pace      | `lineup` in `src/analysis/valuation.js`      |
| Hypothetical roster consequences           | `src/analysis/trade-engine.js`               |

Current model 2.7 uses relative units, not currency or consensus market prices. Dynasty adds age, prospect, and draft context. Kickers use a separate low-value scale. Fantasy scoring and trade valuation are distinct calculations. See [Data quality](DATA-QUALITY.md) for evidence and limitations.

## League settings and game logs

Supported settings are reception scoring, QB format, passing touchdown points, and selected TE reception bonuses. Sleeper starter slots determine Superflex or multi-QB defaults. Explicit overrides apply only to the account and league and can be reset to imported settings. Unsupported scoring is labeled rather than presented as fully modeled.

Player profiles request game logs on demand from the same saved weekly rows. Confirmed injury-exit or non-playing exclusions require explicit evidence; zero points alone do not justify excluding a game. Coverage is incomplete and documented in `src/analysis/game-eligibility.js`.

## Account and database boundaries

An FF Trading login is separate from a Sleeper username lookup. Account identity scopes league selections, overrides, bookmarks, and saved trades. Passwords and email tokens are hashed; sessions use cookies. Verification and reset emails are sent through the existing configured email provider.

Queries use parameters. Postgres transactions pin a separate client so concurrent operations cannot share another request's transaction. Production requires durable database configuration and cannot silently fall back to an instance-local SQLite file. Runtime secrets are configured outside GitHub.

## Demonstrating the backend

Show a player profile first, then trace `/api/analysis` in the browser Network panel and the corresponding source files. In Neon, show a small selection of league refresh dates or player statistics from your own snapshot. Keep authentication records and connection strings off screen.

Read [Code map](CODE-MAP.md) for file navigation and [Deployment](DEPLOYMENT.md) for maintenance and release procedures.
