# Code map

Use this guide to find a feature before opening individual files. All paths below are relative to the repository root.

## Recommended reading order

1. `public/app.js`: browser state, screen rendering, and user actions.
2. `src/http/application.js`: API routes and account context.
3. `src/analysis/fantasy.js`: prepared inputs, league settings, and assembled analysis.
4. `src/analysis/valuation.js`: fantasy scoring, player values, and lineup assignment.
5. `src/analysis/trade-engine.js`: ownership validation and hypothetical roster comparisons.
6. `test/valuation.test.js` and `test/server.test.js`: calculations and complete HTTP flows.

## Find a responsibility

| Area                      | Files                                                                                            | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Page shell and appearance | `public/index.html`, `public/styles.css`                                                         | Layout, navigation, desktop and mobile styling                     |
| Browser interaction       | `public/app.js`                                                                                  | Views, forms, API calls, temporary ranking mode, and account tabs  |
| Trade and player views    | `public/trade-tools.js`, `public/player-profile.js`                                              | Trade templates, profile stat help, and game logs                  |
| Entry points              | `server.js`, `api/index.js`                                                                      | Local listener and Vercel handler for the same application         |
| HTTP boundary             | `src/http/`                                                                                      | Routing, input limits, safe errors, and request logging            |
| Accounts                  | `src/auth/auth.js`, `src/auth/account-email.js`                                                  | Password hashing, sessions, email verification, and resets         |
| Personalization           | `src/auth/preferences.js`, `src/auth/saved-news.js`                                              | Account-scoped preferences and news bookmarks                      |
| Providers                 | `src/integrations/sleeper.js`, `src/integrations/news.js`                                        | Validated provider requests, timeouts, and caches                  |
| Database                  | `src/storage/storage.js`, `src/storage/postgres.js`, `src/storage/database.js`                   | Storage selection, parameterized queries, transactions, and schema |
| Prepared statistics       | `src/storage/stat-inputs.js`                                                                     | Compact weekly fields and previous-season summaries                |
| Analysis assembly         | `src/analysis/fantasy.js`                                                                        | Refresh preparation, saved snapshots, and analysis responses       |
| Player values             | `src/analysis/valuation.js`, `src/analysis/redraft-signal.js`                                    | Production, scoring history, trade values, and lineup pace         |
| Dynasty                   | `src/analysis/prospects.js`, `src/analysis/rookie-benchmarks.js`, `src/analysis/draft-values.js` | Prospect priors, explicit rookie benchmarks, and pick values       |
| League and player context | `src/analysis/league-format.js`, `src/analysis/player-metadata.js`                               | Imported scoring defaults, overrides, and consistent metadata      |
| Game eligibility          | `src/analysis/game-eligibility.js`                                                               | Evidence-backed injury and non-playing exclusions                  |
| Trades                    | `src/analysis/trade-engine.js`                                                                   | Asset ownership, roster effects, and bounded trade suggestions     |
| Model identity            | `src/analysis/model-version.js`                                                                  | Version saved with analysis results                                |

## Follow a trade request

The browser sends selected asset IDs to the API. `application.js` identifies the account and calls the fantasy service. `fantasy.js` reads saved inputs and league settings, then uses the valuation functions to assemble players and picks. `trade-engine.js` validates ownership and compares the hypothetical rosters. The API returns JSON, and the browser renders the result. No real Sleeper transaction is submitted.

## Tests, fixtures, and reports

`test/` mirrors feature names. Start with the test description, inspect the synthetic inputs, then read the assertions. HTTP tests start temporary servers and stop them when finished. `fixtures/` contains provider replacements explicitly preloaded by those tests.

`scripts/evaluate-model.js` checks synthetic model behavior. `reports/evaluation-report.json` records that result. `scripts/backtest-redraft.js` is a separate manual historical scoring evaluation; its output is `reports/redraft-validation.json`. `reports/dynasty-pick-calibration.json` is a dated calibration record, not a live market feed.

## Maintenance tools

`scripts/migrate-cloud.js` applies cloud schema migrations. `scripts/import-sqlite.js` imports local data. `scripts/compact-data.js` previews stored-input compaction unless explicitly given its apply flag. These tools are separate from request handling and are not run automatically by browsing the app. Follow [Deployment](DEPLOYMENT.md) before running them.

## Editing conventions

Keep browser code in `public/`, backend behavior in the matching `src/` area, and tests in `test/`. Add documentation to `docs/` and link it from the README when it helps a new reader. Use the existing two-space Prettier configuration. Comments should explain a responsibility or constraint rather than repeat the code. User-visible copy uses plain language and avoids long dash punctuation.
