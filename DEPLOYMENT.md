# Hosting FF Trading

FF Trading uses one dedicated Vercel project, `patricks-projects-6ed2c910/ff-trading`, connected to `Patrick-713/FF-Trading`. No other Vercel project belongs to this app. The production branch is `main`. Pushing to main starts a production build; other branches create previews.

## Request path

The browser loads static files from `public/`. API rewrites go to `api/index.js`, which initializes `application.js` once per warm instance. Application routes identify the account, validate input, and call the existing fantasy services. PostgreSQL stores users, hashed credentials, hashed session tokens, linked leagues, frozen analysis inputs, settings, saved scenarios, provider caches, request limits and refresh leases.

Vercel can replace application instances during a deployment. Account data lives in Neon rather than an instance's filesystem. PostgreSQL transactions pin one client using AsyncLocalStorage so concurrent requests cannot borrow another request's transaction. An unavailable or unconfigured cloud database fails closed; production cannot fall back to a temporary SQLite file.

## Environment separation

The dedicated Neon project is `damp-sea-98648255`, in AWS US East 1. Its `production` and `preview` branches use independent credentials. Vercel's Production DATABASE_URL points to production, and Preview DATABASE_URL points to preview. Preview builds never receive production credentials. All preview deployments currently share the preview branch; use disposable per-PR branches if stronger preview isolation becomes necessary.

DATABASE_URL is a server-only Vercel Secret. Never commit connection URLs or database files. The application uses pooled connections, a small per-instance pool and Vercel's pool lifecycle helper. Migrations use direct connections. Secure HttpOnly cookies are automatic on Vercel. The API rejects cross-origin browser mutations and bounds JSON request sizes.

## Local setup

Run `npm ci`, then `npm start` for local SQLite. Run `npm test` for the normal suite. Test servers stop when each test finishes. No preview server needs to remain running for the live website.

The normal tests use temporary databases and synthetic providers. `cloud.test.js` is opt-in: use only the isolated preview database, set FF_CLOUD_TEST=true, and preload `./fixtures/sleeper-fetch.mjs`. It checks simultaneous accounts, separate settings and saves, rollback, and persistence through a new application instance. It intentionally creates synthetic preview records and must never run against production.

## Schema changes

Schema version 3 adds `account_preferences` for favorite-team personalization. It is additive: existing accounts and saved leagues stay intact, and older deployed code can keep running during the migration. Local SQLite creates the same preference table at startup.

Migrations are explicit release steps, not application startup work. Test an additive migration on preview first. With the direct preview DATABASE_URL in an ignored env file, run:

```sh
node --env-file=.env.preview.local migrate-cloud.js
```

After verification, apply the same schema to production with its direct connection before pushing code that requires it. Keep changes backward compatible with the deployed version. Application startup checks the required schema version and does not mutate the schema. Schema creation uses an advisory transaction lock to serialize migration processes.

## Importing the old local database

The one-time `import-sqlite.js` command takes a SQLite source path. It makes a native consistent backup including WAL data, upgrades only that backup, then imports current account, league and analysis tables in one transaction. It refuses an already-populated target and leaves the original SQLite file unchanged. Old stock archives remain in the local backup. Never copy a raw SQLite file while ignoring its WAL file.

Existing passwords and session hashes are preserved when present. Localhost cookies do not transfer to a new domain. Registered users can sign in on the public domain; guest users need to link their league there and create an account to retain access across browsers.

## Release verification

Confirm the Vercel project ID and team before every infrastructure change. Run tests before pushing. Check the GitHub commit associated with the READY production deployment. GET /api/health must return ok=true and storage=postgres. Verify sign-up, login, account isolation, settings, saved scenarios, and access after a new deployment. Vercel logs contain request IDs and safe error codes rather than credentials or raw provider payloads.

## Current scale limits

The Vercel account already uses Pro; its subscription was not changed. Neon uses its free plan. Usage remains subject to provider quotas and the existing account billing settings. They are not unlimited hosting. Provider downloads and frozen snapshots consume storage and network transfer; fantasy search consumes CPU. Guest creation, authentication, league refresh, lookup, scenario saving and trade finding are bounded. Refresh leases prevent duplicate account refreshes across instances. Recovery codes replace email reset delivery; email addresses are not verified. Monitoring has request logs and a health endpoint, without an external alerting service. Revisit these limits and the providers' terms before commercial use or a large launch.

## Account email

Production requires a Resend sending-only key restricted to the verified `mail.fantasyfootballmarket.app` domain. Set `EMAIL_FROM` to `FF Trading <accounts@mail.fantasyfootballmarket.app>` and `EMAIL_APP_ORIGIN` to `https://fantasyfootballmarket.app`. Keep the key in Vercel secrets. Preview must use a separate test sender or leave email unavailable; do not send production mail from previews. Run schema migration 4 on preview first and production before deploying. Verification links use URL fragments so tokens do not enter HTTP access logs. Password resets revoke existing sessions and require a fresh login.
