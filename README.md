# FF Trading

Fantasy roster valuation and hypothetical trade analysis for **redraft and dynasty**. There are no tokens to buy, no share market, and no real-money transactions in the product.

## Run

Requires Node.js 24 or later; no dependency installation is needed.

```sh
node server.js
```

Open http://127.0.0.1:3000. Run `node --test` for validation. `PORT`, `HOST`, and `DB_PATH` configure the server; `.env.example` documents these variables and is not automatically loaded. The app is currently local, not publicly hosted.

## Workspace

- **My Team:** player value, dynasty draft capital, optimized starter scoring pace, roster breakdown, and league roster comparisons.
- **Player Values:** rostered league players plus active offensive free agents with stats or rookie status. Search by name/team, filter positions, and inspect statistics, confidence, and model components.
- **Trade Simulator:** choose a league partner, select players and dynasty picks on both sides, and compare value, positional depth, and starter pace before/after.
- **Saved Scenarios:** store hypothetical comparisons under the current account and league. Loading selections uses the scenario's settings; analyze again against current values.
- **Link Sleeper:** import rosters, team identities, completed-week results, and dynasty traded picks.
- **Account:** free local email/password login with recovery codes; existing leagues remain saved.

The **Redraft / Dynasty** switch changes valuation, not the real league. Scoring options include PPR/half/standard, one QB/superflex, 4/6-point passing TDs, and 0/0.5/1 TE reception bonuses. Switching clears an unsaved trade selection to prevent mixing asset values from different modes.

## Data and valuation model v1

Sleeper supplies league rosters, player IDs, positions, age/status metadata, scoring context, and traded-pick ownership. nflverse supplies weekly player statistics and NFL player metadata, matched primarily by GSIS ID. An exact normalized name/position match is used only when unambiguous. Weekly statistics are cached in SQLite for six hours; NFL player metadata and Sleeper's player catalog for 24 hours. Historical seasons can use the current player metadata; this is not a historical age-at-season replay.

Stats include fantasy points/game, recent points/game, targets and carries/game, target share, WOPR, average depth of target, yards/touch, EPA per opportunity, and a consistency estimate. Only completed imported weeks are used for the selected season. A previous-season file may be used if a current-season file is unavailable, and the UI identifies that source season. The demo uses explicitly fictional statistics.

Values are **relative model units, not currency, token prices, consensus rankings, or calibrated forecasts**. Model v1 is a transparent heuristic:

- Redraft uses 60% recent four-game scoring pace and 40% season pace, positional replacement baselines, opportunity/usage, target share, WOPR, efficiency, and consistency.
- Dynasty adds position-specific age curves, NFL draft-round priors, and superflex QB scarcity. Missing metadata uses neutral adjustments; players without matched weekly statistics have low-confidence estimates.
- Listed injury statuses apply a simple availability discount; this does not predict injury duration.
- Starter scoring pace uses a maximum-weight slot assignment, never counting a player twice. It reflects past weekly production under the selected scoring settings, **not a rest-of-season projection**.
- League-specific yardage/first-down/long-play bonuses, exact team D/ST scoring, schedules, route participation, snap counts, and opponent adjustments are not modeled. D/ST and other unmatched assets are explicitly estimates; don't treat their estimated values or pace as stats-backed rankings.

## Dynasty draft picks

For Sleeper dynasty leagues (`settings.type=2`), pick inventory starts with original picks using the league's configured draft-round count for the next three seasons. Known traded-pick entries override the owner and can extend the horizon to five years. Unknown pick slots use mid-round estimates with early/late ranges; no exact future pick number is claimed. If draft rounds are unavailable, no pick inventory is fabricated.

Heuristic mid-round values: 1st 1,050; 2nd 500; 3rd 250; 4th 125; 5th 65. Early slots are +30%, late -25%; additional future years discount 15%; superflex adds 15%. These assumptions are visible in **How values work**. Picks disappear from the redraft trade builder and are excluded from redraft totals.

## Trade analysis

The server validates team ownership and rejects duplicate assets, empty sides, and redraft pick trades. It reports additive asset value, roster value change, position depth, and optimized starter pace for **both teams**. Nothing is submitted to Sleeper or applied to the imported roster. Multiple modest players can add up to a star's value; consider lineup impact, roster limits, consolidation, and confidence rather than treating the sum as an automatic recommendation.

## Free accounts

Sign-up claims the current guest workspace and Sleeper links. Email is a sign-in identifier, not verified email. Passwords use salted scrypt (`N=131072,r=8,p=1`); sessions use random 256-bit tokens stored as SHA-256 hashes, HttpOnly SameSite cookies, and 30-day expiry. Login attempts are throttled. Save the recovery code displayed once at sign-up; successful recovery rotates the code and revokes earlier sessions. No emailed password resets or paid authentication provider is needed.

For online access, host the same server and persistent database behind HTTPS, set `APP_ORIGIN` to the exact HTTPS origin and `COOKIE_SECURE=true`, and back up the database. Independent local copies don't share accounts. Hosting costs are separate from the free login implementation.

## Analysis API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/analysis` | Player values, teams, picks, settings, data coverage, saved scenarios |
| PUT | `/api/analysis/settings` | `mode`, `scoring`, `superflex`, `tePremium`, `passTD` |
| POST | `/api/analysis/trade` | `teamA`, `teamB`, `sendA`, `sendB` asset IDs |
| POST | `/api/analysis/save` | Same selections plus optional `title` |
| POST | `/api/sleeper/lookup` | `username`, optional `season` |
| POST | `/api/sleeper/link` | `username`, `leagueId` |
| POST | `/api/sleeper/sync` | Refresh active league |
| POST | `/api/sleeper/disconnect` | Return to the fictional demo |

Account endpoints are `/api/auth/register`, `/login`, `/logout`, and `/recover`. Existing `/api/state` and old paper-market data are retained for migration compatibility; the product UI does not expose share trading. SQLite files in `data/` are ignored by Git. All added tables are additive, preserving existing accounts, sessions, and league links.

## Sources and limits

- Sleeper API: https://docs.sleeper.com/ — read-only; free non-commercial use, commercial licensing requires contacting Sleeper.
- nflverse player stats: https://github.com/nflverse/nflverse-data/releases/tag/stats_player
- nflverse player metadata: https://github.com/nflverse/nflverse-data/releases/tag/players

This is a first model, with heuristic weights that need evaluation against real fantasy decisions before claiming predictive accuracy. ESPN is not connected. No verified Sleeper team ownership, shared trading exchange, or external trade execution is included. Node's built-in SQLite API is experimental in Node 24. Test fixtures are only explicitly preloaded by integration tests.
