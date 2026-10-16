# FF Trading

Fantasy roster valuation and hypothetical trade analysis for **redraft and dynasty**. There are no tokens to buy, no share market, and no real-money transactions in the product.

## Run

Requires Node.js 24. Install the pinned dependencies first.

```sh
npm ci
node server.js
```

Open http://127.0.0.1:3000. Run `node --test` for validation. `PORT`, `HOST`, and `DB_PATH` configure the server; `.env.example` documents these variables and is not automatically loaded. Production runs on Vercel with durable Neon PostgreSQL. Local development uses SQLite unless `DATABASE_URL` is set. Deployment setup and migration steps are in [DEPLOYMENT.md](DEPLOYMENT.md).

For a guided reading order and file responsibilities, see [CODE-MAP.md](CODE-MAP.md).

## Workspace

- **My Team:** player value, dynasty draft capital, optimized starter scoring pace, roster breakdown, and league roster comparisons.
- **Player Values:** rostered league players plus active offensive free agents with stats or rookie status. Search by name/team, filter positions, and inspect statistics, confidence, and model components.
- **Trade Simulator:** search for a player across the league or choose a team, then select players and dynasty picks. Compare both time horizons, lineup assignments, cuts, waiver replacements, and bench depth. Adjust assumptions and save the whole scenario.
- **Trade Finder:** inside the simulator, choose a positional upgrade, younger roster, draft capital, current starters, or long-term value. Review offers that show a measurable modeled benefit for each manager, then open any idea in the builder.
- **Saved Scenarios:** store hypothetical comparisons under the current account and league. Loading selections uses the scenario's settings; analyze again against current values.
- **Link Sleeper:** import rosters, team identities, completed-week results, and dynasty traded picks.
- **Account:** email/password login with recovery codes; existing leagues remain saved.

The **Redraft / Dynasty** switch changes valuation, not the real league. Scoring options include PPR/half/standard, one QB/superflex, 4/6-point passing TDs, and 0/0.5/1 TE reception bonuses. Switching clears an unsaved trade selection to prevent mixing asset values from different modes.

## Data and valuation model v1

Sleeper supplies league rosters, player IDs, positions, age/status metadata, scoring context, and traded-pick ownership. nflverse supplies weekly player statistics and NFL player metadata, matched primarily by GSIS ID. An exact normalized name/position match is used only when unambiguous. Refresh requests use a six-hour statistics cache and a 24-hour NFL metadata/player-catalog cache. League imports save frozen analysis inputs; reads and trade calculations never fetch providers. Historical seasons can use metadata from the refresh date; this is not a historical age-at-season replay. Metadata age/experience calculations use the snapshot date until refreshed.

Stats include fantasy points/game, recent points/game, targets and carries/game, target share, WOPR, average depth of target, yards/touch, EPA per opportunity, and a consistency estimate. Only completed imported weeks are used for the selected season. A previous-season file may be used if a current-season file is unavailable, and the UI identifies that source season. The demo uses explicitly fictional statistics.

Values are **relative model units, not currency, token prices, consensus rankings, or calibrated forecasts**. Model v1 is a transparent heuristic:

- Redraft uses 60% recent four-game scoring pace and 40% season pace, positional replacement baselines, opportunity/usage, target share, WOPR, efficiency, and consistency.
- Dynasty adds position-specific age curves, NFL draft capital, fading prospect priors, and superflex QB scarcity. Missing metadata is labeled; players without matched weekly statistics have low-confidence estimates.
- Listed injury statuses apply a simple availability discount; this does not predict injury duration.
- Starter scoring pace uses a maximum-weight slot assignment, never counting a player twice. It reflects past weekly production under the selected scoring settings, **not a rest-of-season projection**.
- League-specific yardage/first-down/long-play bonuses, exact team D/ST scoring, schedules, route participation, snap counts, and opponent adjustments are not modeled. D/ST and other unmatched assets are explicitly estimates; don't treat their estimated values or pace as stats-backed rankings.

## Dynasty draft picks

### Young-player valuation

Players in their first three NFL seasons are identified by NFL draft year or season-adjusted experience, never age alone. Prospect starting values use overall NFL selection when available (top 10: 2,400; other first round: 2,100), otherwise round (2: 1,650; 3: 1,200; 4: 750; 5: 500; 6: 325; 7: 225), or a clearly labeled limited-metadata prior of 350. These are model units, not consensus rankings.

Completed rookie-only Sleeper drafts add league context when **every pick** can be verified as a rookie and no keeper picks are present. Startup/mixed/unknown drafts are excluded. Up to four drafts from the selected league season are checked. Rookie draft position is normalized to 12 teams: 1st 2,600; 2 to 3 2,300; 4 to 6 1,950; 7 to 12 1,550; 13 to 24 850; 25 to 36 450; later 250. When NFL capital is known, league context contributes only 25% of the prospect prior. When it is missing, the verified league selection contributes 80% and the limited-metadata prior 20%. This is not a global rookie ADP feed. Unavailable draft history never blocks league analysis or invents a 1.01 ranking.

The prospect weight is `tenure × (0.90 − 0.55 × exposure)`, with tenure multipliers 1.0, 0.55 and 0.20 in NFL seasons one, two and three. Exposure is the larger of games/17 or opportunities/threshold, capped at one. Thresholds are 450 QB attempts, 200 RB carries+targets, and 150 WR/TE carries+targets. The dynasty base is the larger of the established-production estimate and its weighted blend with the prospect prior, then receives the existing age/QB-format adjustment. A breakout can exceed the prior; a slow start does not erase draft capital. Protection fades with sustained NFL evidence and tenure, disappearing in year four. Redraft values and starter pace remain production-based.

Player details show the prior's source, starting value, retained weight, opportunities and verified league selection when present. Current league draft history is read through Sleeper's documented [draft and pick endpoints](https://docs.sleeper.com/#drafts). NFL metadata now includes overall selection and draft year where supplied by nflverse, with the previous metadata cache available as a fallback. Historical experience is adjusted to the selected season; age remains current as documented above.

For Sleeper dynasty leagues (`settings.type=2`), pick inventory starts with original picks using the league's configured draft-round count for the next three seasons. Known traded-pick entries override the owner and can extend the horizon to five years. Unknown pick slots use mid-round estimates with early/late ranges; no exact future pick number is claimed. If draft rounds are unavailable, no pick inventory is fabricated.

Heuristic mid-round values: 1st 1,050; 2nd 500; 3rd 250; 4th 125; 5th 65. Early slots are +30%, late -25%; additional future years discount 15%; superflex adds 15%. These assumptions are visible in **How values work**. Picks disappear from the redraft trade builder and are excluded from redraft totals.

## Supported league defaults and preseason analysis

League defaults include PPR, half PPR or standard reception scoring, QB format, passing TD points, and supported TE reception bonuses of 0, 0.5 or 1. Explicit per-league overrides remain in place. Unsupported TE bonuses are labeled in the data warning instead of being silently rounded to a supported value.

Rostered players and free agents share the same metadata normalization. Experience, NFL selection and verified rookie-draft context affect a player identically across ownership states.

A prepared dynasty snapshot can support prospect and pick trades without completed games. Current-production comparisons and starter pace are then unavailable, and players lacking both verified prospect metadata and game history cannot be selected. Missing snapshots and empty-history redraft analysis still require usable data. Model version 2.2.0 records these changes in new saved results.

## Trade analysis

The server validates team ownership and rejects duplicate assets, empty sides, and redraft pick trades. Searching an opponent's player selects their actual team; switching partners clears the previous receive selection. Free agents are labeled and can be inspected; they cannot be represented as another manager's trade assets.

Both managers receive separate current-production and dynasty-value comparisons, plus an optimized lineup before/after and bench depth/value. These are alternative heuristic perspectives, not comparable currencies or calibrated projections. A contender/rebuilder explanation highlights when starter pace and dynasty value move in opposite directions.

Active capacity comes from Sleeper's starter/bench slot configuration. IR/taxi players are excluded from active starters and automatic cuts. Incoming players default to active spots; real IR/taxi eligibility needs review. For an over-capacity roster the engine suggests cuts that minimize starter-pace loss, breaking ties by lowest model value. Trade-created openings can receive suggested replacements from the imported free-agent pool; unrelated pre-existing openings are not auto-filled. Replacements are conditional on availability and waiver rules. Disable them to see the trade without assumed additions. If capacity is missing or no replacement exists, the report says so. Net roster changes include these cuts/additions; exchange value is shown separately. Cuts and waiver suggestions are automatic planning assumptions and are not submitted anywhere.

Selected players accept workload and dynasty-development multipliers from 50 to 150%. Workload scales current value and starter pace, while development scales dynasty value only. Future picks accept early/mid/late assumptions. The report compares the unadjusted model with the user's scenario and two stress cases: incoming workload ±15%, development ±10%, and pick slots early/late, with the opposite adjustments to outgoing assets. These cases are illustrative bounds, not probabilities. The exchange-value verdict uses a ±10% balanced band and shows whether the verdict changes in a tested case. Saved scenarios retain assumptions and the waiver setting; reloading recalculates only when the user analyzes again.

Trade Finder searches singles and two-for-one exchanges, using up to 28 assets per team, the top 14 for paired packages, and up to 12 targets. It filters to exchanges within 20% value, prefilters for the selected goal, and evaluates up to 100 candidates with per-team quotas. Results require goal progress and a benefit to the partner in starter pace, current value, or dynasty value, with no modeled roster-value loss greater than 25% of the exchange (minimum allowance 100 units). It shows up to eight ideas, at most two per partner. This is a bounded search, not an exhaustive optimizer or a prediction of manager acceptance; an empty result does not mean no good trade exists.

Nothing is submitted to Sleeper or applied to the imported roster. Multiple modest players can still add up to a star's model value; roster-aware consequences add context without guaranteeing fairness.

## Free accounts

Sign-up claims the current guest workspace and Sleeper links. Email is a sign-in identifier, not verified email. Passwords use salted scrypt (`N=131072,r=8,p=1`); sessions use random 256-bit tokens stored as SHA-256 hashes, HttpOnly SameSite cookies, and 30-day expiry. Login attempts are throttled. Save the recovery code displayed once at sign-up; successful recovery rotates the code and revokes earlier sessions. No emailed password resets or paid authentication provider is needed.

For online access, host the same server and persistent database behind HTTPS, set `APP_ORIGIN` to the exact HTTPS origin and `COOKIE_SECURE=true`, and back up the database. Independent local copies don't share accounts. Hosting costs are separate from the free login implementation.

## Analysis API

| Method | Endpoint                  | Purpose                                                                                                                                                          |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/analysis`           | Player values, teams, picks, settings, data coverage, saved scenarios                                                                                            |
| PUT    | `/api/analysis/settings`  | `mode`, `scoring`, `superflex`, `tePremium`, `passTD`                                                                                                            |
| POST   | `/api/analysis/trade`     | `teamA`, `teamB`, `sendA`, `sendB` asset IDs; optional `assumptions` keyed by selected asset ID (`workload`, `development`, `tier`) and `includeWaivers` boolean |
| POST   | `/api/analysis/find`      | `goal`: `WR`, `RB`, `QB`, `TE`, `younger`, `picks`, `contend`, or `rebuild`; optional `includeWaivers`                                                           |
| POST   | `/api/analysis/refresh`   | Explicitly refresh the active league and freeze its analysis inputs                                                                                              |
| POST   | `/api/analysis/save`      | Same selections plus optional `title`                                                                                                                            |
| POST   | `/api/sleeper/lookup`     | `username`, optional `season`                                                                                                                                    |
| POST   | `/api/sleeper/link`       | `username`, `leagueId`                                                                                                                                           |
| POST   | `/api/sleeper/sync`       | Refresh active league                                                                                                                                            |
| POST   | `/api/sleeper/activate`   | Select an already-linked `leagueId` owned by the current account, without fetching providers                                                                     |
| POST   | `/api/sleeper/disconnect` | Return to the fictional demo                                                                                                                                     |

Account endpoints are `/api/auth/register`, `/login`, `/logout`, and `/recover`. `/api/state` returns the current account identity, user profile and active league connection. Stock trading routes, tables and runtime calculations have been removed. See [BACKEND.md](BACKEND.md) for migrations, refresh behavior, model evaluation and errors. SQLite files and backups under `data/` are ignored by Git.

## Sources and limits

- Sleeper API: https://docs.sleeper.com/ , read-only; free non-commercial use, commercial licensing requires contacting Sleeper.
- nflverse player stats: https://github.com/nflverse/nflverse-data/releases/tag/stats_player
- nflverse player metadata: https://github.com/nflverse/nflverse-data/releases/tag/players

This is a first model, with heuristic weights that need evaluation against real fantasy decisions before claiming predictive accuracy. ESPN is not connected. No verified Sleeper team ownership, shared trading exchange, or external trade execution is included. Node's built-in SQLite API is experimental in Node 24. Test fixtures are only explicitly preloaded by integration tests.
