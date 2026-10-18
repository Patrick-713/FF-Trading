# FF Trading

A full-stack fantasy football app for exploring player rankings, linking Sleeper leagues, and comparing hypothetical trades. Built with browser JavaScript, a Node.js API, and Neon Postgres. GitHub pushes deploy to Vercel.

[Open the live app](https://fantasyfootballmarket.app/)

## Start here

- [Code map](docs/CODE-MAP.md): where each feature lives and which files to read first.
- [Backend and data](docs/BACKEND.md): request flow, database tables, and how statistics become values.
- [Data quality](docs/DATA-QUALITY.md): sources, evaluation evidence, and model limitations.
- [Deployment](docs/DEPLOYMENT.md): environment setup, migrations, and releases.

## Project layout

```text
FF-Trading/
  public/             Browser pages, styles, icons, and UI modules
  src/                Backend code
    http/             Routes, request security, and error handling
    auth/             Accounts, email, preferences, and saved stories
    integrations/     Sleeper and news provider clients
    storage/          Database adapters, migrations, and stat preparation
    analysis/         Player values, draft picks, rosters, and trades
  api/                Vercel serverless entry point
  test/               Automated tests
  fixtures/           Synthetic provider responses used by tests
  scripts/            Manual evaluation and database maintenance tools
  resources/          Bundled public demo player data
  reports/            Checked-in model evaluation results
  docs/               Developer documentation
  server.js           Local server entry point
```

Local `data/`, dependencies, environment files, and Vercel credentials are ignored by Git. Production account data lives in Neon.

## Run locally

Use Node.js 24. From the project root:

```sh
npm ci
npm start
```

Open http://127.0.0.1:3000. Local development uses SQLite by default. Production requires a server-only `DATABASE_URL`. See `.env.example` and the deployment guide before connecting a cloud database.

```sh
npm test
npm run evaluate
```

Tests use temporary databases and synthetic data. The cloud integration test is opt-in and must use the isolated preview database. Model evaluation checks intended behavior; it is not proof of prediction accuracy.

## What the app does

- Player Rankings supports search, pagination, player profiles, stat explanations, and game logs.
- My Team imports Sleeper rosters, supported scoring settings, standings, and dynasty pick ownership. FF Score sums modeled player and pick values.
- Trade Simulator compares either side of a hypothetical exchange. The public demo uses redraft; linked leagues use their league format. It never executes a real trade.
- Account handles sign-up, email verification, password resets, Sleeper linking, and saved notes.
- NFL News displays current provider stories and lets users bookmark them.

## Where the numbers come from

Sleeper supplies league and roster context. nflverse supplies weekly statistics and player metadata. The backend prepares compact snapshots and calculates values from those saved inputs, avoiding provider requests during ordinary analysis reads.

The public demo is a dated top-300 statistical sample bundled in `resources/demo-data.json`, not a live expert ranking feed. Linked leagues use their prepared snapshots.

Trade values are relative model units. Current model 2.7 includes scoring and usage, fading last-season context, dynasty age and prospect adjustments, calibrated picks, and separate low kicker values. Actual fantasy points are distinct from trade values. Supported league scoring is documented in the backend guide; unsupported settings are not silently treated as fully modeled.

## Interview walkthrough

Show a player profile, build a trade, and explain one request through `public/app.js`, `src/http/application.js`, `src/analysis/fantasy.js`, and `src/analysis/valuation.js`. Then show `test/kicker-values.test.js` as an example of a reported issue covered by regression tests.

Neon shows stored inputs and saved records. GitHub shows the equations and implementation. Keep authentication tables, secrets, and other users' records off screen.
