# FF Trading

Fantasy football meets a paper stock exchange. Build a roster, buy and sell shares in fantasy teams, and watch their valuations respond to simulated weekly performance.

## Run

Requires Node.js 24 or later. No dependency install or external service is required.

```sh
node server.js
```

Open http://127.0.0.1:3000. `npm run dev` restarts the server on source changes. `node --test` runs the valuation, trade, and lineup tests. Set `PORT`, `HOST`, or `DB_PATH` as environment variables when needed; `.env.example` is documentation and is not automatically loaded.

## First draft

- Responsive dashboard with team quote ticker and season price charts
- Six fantasy teams, a seven-player editable lineup, and a team stock price
- Buy/sell order tickets using demo credits and whole shares
- Portfolio holdings, weighted average cost basis, and unrealized returns
- Persisted order history, cash balances, rosters, and market quotes in SQLite
- Simulated weeks through week 18; reset starts a fresh demo season
- Server validation, atomic trade transactions, and per-browser session isolation
- Link a Sleeper username and select an NFL league for a separate paper market
- Import real starters, bench/IR/taxi players, team names, records, and completed weekly scores
- Manually sync Sleeper without counting the same scoring week twice

## Free user accounts

Open **Account** or **Sign up / Log in**. Sign-up asks for a display name, email identifier, and a 12–128 character password. It claims the current guest portfolio and saved Sleeper leagues without resetting credits or holdings. Logins from another browser on the same server restore the same saved account. Logging in to an existing account does not merge an unrelated guest portfolio.

The authentication implementation runs on our existing Node/SQLite backend, with no paid provider, API keys, dependency installation, or email delivery. Passwords use salted scrypt (`N=131072`, `r=8`, `p=1`); random 256-bit session tokens are stored only as SHA-256 hashes in SQLite and expire after 30 days. Sign-in attempts are throttled per socket IP and email identifier. The server rejects cross-origin mutations and requires JSON requests.

Save the one-time recovery code shown at sign-up in a password manager. **Forgot password? Use a recovery code** resets the password, revokes old login sessions, and issues a replacement recovery code. A recovery code can be used once. Email is not verified and no password-reset emails are sent. There is no account recovery without the password or saved recovery code in this version.

For a public deployment, serve behind HTTPS, set `APP_ORIGIN` to the exact HTTPS origin and `COOKIE_SECURE=true`, keep the database on persistent storage, and back it up. This feature is free to run locally; online hosting and email service pricing are separate. Cross-device access requires the same hosted backend/database, not independent local copies.

Auth endpoints: `POST /api/auth/register` (`name`, `email`, `password`), `/api/auth/login` (`email`, `password`), `/api/auth/logout`, and `/api/auth/recover` (`email`, `recoveryCode`, `password`). Registration and recovery return a recovery code once; normal state responses expose only the signed-in user's name and email.

## Sleeper connection steps

1. Start the app and open **Link Sleeper** in the navigation.
2. Enter your Sleeper username. Optionally enter an older season; blank uses the current NFL season returned by Sleeper.
3. Click **Find my leagues**, then **Link league** beside the league you want.
4. Use **Sync Sleeper** to refresh imported data. Manage lineups, waivers, and player trades in Sleeper itself.

No password or API token is needed. This is a public data import, not Sleeper authentication or verification of team ownership. It supports NFL leagues and their actual starting roster positions, including superflex and defensive slots. A user must have a roster in the selected league. Links and data persist locally in SQLite. This prototype gives each browser its own paper market; it does not connect multiple members to one shared exchange.

Each new linked league gets a separate 25,000-credit portfolio with no seeded shares. **Return to demo** restores your previous demo portfolio. Linking the same league again resumes its saved holdings and trades. Sync does not alter credits or share quantities. The demo reset only resets demo data, preserving saved linked markets.

Requests go from the Node server to the fixed `https://api.sleeper.app/v1` origin, with timeouts and readable errors. A failed import leaves the active league and portfolio unchanged. Requests are cached for 30 seconds; the large player directory is cached in SQLite for 24 hours and survives restarts. Up to three matchup requests run concurrently. There is no background scheduler in this version; sync is manual and the app displays its last-sync time.

Sleeper documents the API at https://docs.sleeper.com/. Its terms permit free non-commercial use and require contacting Sleeper about licensing for commercial use.

The app serves a browser frontend and a Node.js JSON API. SQLite lives at `data/ff-trading.sqlite` and is excluded from Git. A random HttpOnly cookie identifies each browser's demo account. All credit values are stored as integer hundredths; cost basis is rounded to the nearest hundredth. Starting holdings are seeded gifts separate from the 25,000 starting credits.

## Valuation model

Each simulated result varies a team's projection by 80–120%. The owned team's projection uses its saved lineup; other teams use seeded projections. Price movement is `(weekly points - 120) / 120 * 25%`, capped at ±12%. Prices have a 1-credit floor. A score of at least 120 counts as a simulated win. This is a scoring benchmark, not a head-to-head schedule. Trading volume does not affect price in this version.

For **linked leagues**, every team begins at 100 credits (week 0). Each imported completed week moves the price by `(team points - league average) / league average * 25%`, with the same ±12% cap and 1-credit floor. Prices rebuild deterministically from the baseline and score history, so repeated syncs cannot double-apply a week. Commissioner score corrections may revise history and current prices. All-zero scoring weeks leave prices flat; incomplete league scores are skipped and reported. `custom_points` overrides `points` when present. Team records come directly from Sleeper, independently of this valuation model.

During the regular season, the current NFL `leg` is excluded: scores settle after the NFL week advances. Historical/complete seasons request up to week 18, using available matchups. This intentionally does not price ongoing games and does not promise real-time scoring. Historical player names and clubs use the current player directory.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Account, teams, quotes, holdings, roster, and trades |
| POST | `/api/trades` | `{ "team": "grid", "side": "buy", "quantity": 2 }` |
| PUT | `/api/roster` | `{ "roster": ["qb1","rb1","rb2","wr1","wr2","te1","flex1"] }` |
| POST | `/api/simulate` | Advance the demo season one week |
| POST | `/api/reset` | Reset this browser's demo account |
| POST | `/api/sleeper/lookup` | `{ "username": "yourname", "season": "2026" }`; season optional |
| POST | `/api/sleeper/link` | `{ "username": "yourname", "leagueId": "numeric-league-id" }` |
| POST | `/api/sleeper/sync` | Refresh the active linked league |
| POST | `/api/sleeper/disconnect` | Return to demo without deleting the linked portfolio |

## Scope and next milestones

This is a local full-stack prototype with a fictional simulation and a separate Sleeper import mode. Guests have browser-based portfolios; registered users have saved portfolios accessible by signing in on the same server. There is no real-money trading, verified Sleeper ownership, or shared multiplayer market. Keep the default loopback host for local use.

Before a public launch: add shared leagues and ownership rules, appropriate commercial data licensing, HTTPS deployment, account abuse controls and email verification if needed, operational monitoring, and database migration/backup tooling. Node's built-in SQLite API is experimental in Node 24. `fixtures/sleeper-fetch.mjs` is only preloaded explicitly by integration tests, never by the normal server.

Suggested product direction: users manage a fantasy roster while other league members invest in its shares; weekly scoring drives valuation and league standings. Decide share issuance, liquidity, roster trading rules, and whether roster moves require a salary cap before adding multiplayer.
