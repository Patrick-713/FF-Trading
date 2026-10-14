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

The app serves a browser frontend and a Node.js JSON API. SQLite lives at `data/ff-trading.sqlite` and is excluded from Git. A random HttpOnly cookie identifies each browser's demo account. All credit values are stored as integer hundredths; cost basis is rounded to the nearest hundredth. Starting holdings are seeded gifts separate from the 25,000 starting credits.

## Valuation model

Each simulated result varies a team's projection by 80–120%. The owned team's projection uses its saved lineup; other teams use seeded projections. Price movement is `(weekly points - 120) / 120 * 25%`, capped at ±12%. Prices have a 1-credit floor. A score of at least 120 counts as a simulated win. This is a scoring benchmark, not a head-to-head schedule. Trading volume does not affect price in this version.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Account, teams, quotes, holdings, roster, and trades |
| POST | `/api/trades` | `{ "team": "grid", "side": "buy", "quantity": 2 }` |
| PUT | `/api/roster` | `{ "roster": ["qb1","rb1","rb2","wr1","wr2","te1","flex1"] }` |
| POST | `/api/simulate` | Advance the demo season one week |
| POST | `/api/reset` | Reset this browser's demo account |

## Scope and next milestones

This is a local full-stack prototype, with fictional athletes and simulated results. Each browser has an isolated exchange. There is no real-money trading, live NFL data, shared league, login, or account recovery. Clearing cookies creates a new account. Keep the default loopback host for local use.

Before a public launch: add authenticated accounts and account recovery, shared leagues and ownership rules, a licensed player/stats integration, real fantasy scoring and matchup scheduling, production sessions/HTTPS, rate limiting and operational monitoring, and database migration/backup tooling. Node's built-in SQLite API is experimental in Node 24.

Suggested product direction: users manage a fantasy roster while other league members invest in its shares; weekly scoring drives valuation and league standings. Decide share issuance, liquidity, roster trading rules, and whether roster moves require a salary cap before adding multiplayer.
