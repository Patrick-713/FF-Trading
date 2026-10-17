# Reading the FF Trading code

Start with one user action and follow it through the files. The existing folder layout is preserved so familiar paths and imports continue to work.

## A trade request, from screen to result

1. `public/app.js` reads the selected assets and sends JSON to the trade endpoint.
2. `application.js` identifies the account and asks the fantasy service for its saved league analysis.
3. `fantasy.js` reads the frozen inputs and that league's settings. It does not fetch providers during analysis.
4. `player-metadata.js` builds the same player record for rostered players and free agents.
5. `valuation.js` calculates values. `prospects.js` supplies the fading dynasty prospect prior.
6. `trade-engine.js` validates asset ownership and compares each team's hypothetical roster.
7. `public/trade-tools.js` describes the returned results on screen.

## Where each responsibility lives

**Personalization:** `preferences.js` validates and saves account-scoped favorite NFL teams. `public/nfl-teams.js` is the shared list of team identifiers and display accents. `PUT /api/preferences` updates the current account only, and `/api/state` returns that preference after login on any device. Team styling does not affect valuations. The Sleeper lookup uses the provider's current NFL season automatically.

**The browser:** `public/index.html` provides the page shell. `public/styles.css` controls its appearance. `public/app.js` owns view state and event handling. `public/trade-tools.js` contains the trade-related view templates. Dynamic names and descriptions are escaped before they are inserted into HTML.

**The HTTP boundary:** `application.js` routes requests, applies account context, coordinates refreshes and returns JSON. Look at `session`, `analysis` and `importLeague` before reading the route handler.

**Hosting and storage:** `server.js` starts the local listener. `api/index.js` is the Vercel entry point and shares the same application handler. `storage.js` selects PostgreSQL for production and SQLite for local development. `postgres.js` adapts parameterized queries and pins a separate client for each transaction. `migrate-cloud.js` applies the versioned cloud schema. `security.js` contains shared request limits and client address handling. Read [DEPLOYMENT.md](DEPLOYMENT.md) for infrastructure and release instructions.

**Data preparation:** `sleeper.js` imports public league data. Inside `fantasy.js`, `metadata` and `stats` refresh provider caches, `prepareSnapshot` prepares saved inputs, and `storeSnapshot` writes them during the caller's transaction. The `model` function reads prepared inputs and assembles the response.

**Shared player fields:** `player-metadata.js` resolves names, age, experience, NFL draft information and verified rookie draft context. Ownership is a separate field, so moving a player between a roster and free agency does not change the valuation inputs.

**League scoring:** `league-format.js` reads supported imported defaults. `settingsFor` in `valuation.js` validates model settings. Explicit saved overrides remain specific to the current account and league.

**Calculations:** `valuePlayer` in `valuation.js` combines production and prospect information. `lineup` assigns players to eligible slots. In `trade-engine.js`, `rosterReport` calculates one team's consequences, `analyzeTrade` handles a complete exchange and `findTrades` searches a bounded group of offers. These functions do not execute real trades.

**Authentication:** `auth.js` stores password hashes, issues session cookies, throttles authentication attempts and handles email verification and password resets through `account-email.js`. An FF Trading login is separate from a public Sleeper username lookup.

**Storage and errors:** `database.js` owns migrations and transactions. `errors.js` distinguishes expected request/provider problems from unexpected failures, and logs only approved request fields.

## Understanding preseason results

A prepared snapshot and completed-game production are different things. A dynasty snapshot can be ready for prospect and pick comparisons even when it contains no completed games. Such results label current production and starter pace as unavailable. Players with neither verified prospect metadata nor production history are excluded from these comparisons. A missing snapshot still requires a refresh, and empty-history redraft analysis remains unavailable.

## Reading the tests

Read a test's description first, then its synthetic inputs, then the assertions. `fantasy-regression.test.js` covers ownership-independent player values, imported TE bonuses and preseason readiness. `trade-engine.test.js` covers roster consequences and assumptions. `server.test.js` verifies the HTTP flow. `auth.test.js` checks account isolation and email password resets. `database.test.js` checks preservation and rollback during migration. `site-copy.test.js` checks the punctuation rule for site templates.

`evaluate-model.js` produces a repeatable model behavior report. It is separate from a historical forecast-accuracy study. `model-version.js` identifies which model produced a saved result.

## Formatting and comments

The source uses two-space indentation and the settings in `.prettierrc.json`. Long HTML views use joined fragments without extra output whitespace. Comments describe a function's responsibility or an important constraint. They do not repeat every line of code. Formatting, explanatory comments and this map preserve the existing project structure and visual design.

CSS custom property prefixes, JavaScript operators and command-line flags are technical syntax. They are not displayed prose. Site wording uses ordinary punctuation and words such as "to" for ranges.

## Dynasty pick anchor, model 2.3.0

Verified first-year rookie selections use the same slot curve as next year’s picks. A 12-team 1.01 is 2,600 model units; a slow start with limited exposure retains 90%, or 2,340. No games means no performance discount. After half a season of games or opportunities, the discount grows toward 35% with sustained poor evidence. Established production may exceed the anchor. The anchor is already priced for league size and superflex and receives no second age or QB premium. It expires after the first NFL season. Unknown or unverified selections retain the existing NFL-capital fallback, without inventing rookie ADP. Redraft and scoring pace are unchanged.

Unknown future picks remain estimates. In the trade builder, First in round simulates 1.01, 2.01 and so on; it does not claim a future draft order is known. All pick tiers now share the same curve as the rookie anchor, so dynasty pick and player comparisons remain consistent. Each additional future year retains the existing 15% discount. Previous saved scenarios retain their original model version and values.

The versioned rookie-benchmarks.js file records explicit owner-supplied assumptions. Jeremiyah Love uses the requested 2026 1.01 benchmark when no verified league selection is available. The UI identifies this source rather than presenting it as Sleeper draft history or consensus ADP.
