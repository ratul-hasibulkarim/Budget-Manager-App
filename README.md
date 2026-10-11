# Budget Manager

Offline-first money manager for **group projects** (trips, events, teams) and **personal** money.
Bangla and English, five themes (Light, Black, Maroon, Blue, Green).

- Feature specs: [group](docs/group-project-spec.md), [personal](docs/personal-project-spec.md)
- How it works, sync guarantees, hosting: [docs/architecture.md](docs/architecture.md)
- Screenshots: [docs/screenshots](docs/screenshots)

## Run it

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm server                  # sync server on http://localhost:8787 (SQLite file budget-manager.sqlite)
cd apps/mobile && npx expo start   # then press w for web, or scan the QR code with a dev build
```

The app talks to `http://localhost:8787` by default. To use another server, set
`EXPO_PUBLIC_SERVER_URL` or change it in the app's Settings → Sync server.
For production, set `AUTH_SECRET` (at least 32 random characters) on the server.

## Tests

```bash
pnpm -r typecheck
pnpm -r test                       # rules, money, splits, sync simulation, server
cd apps/mobile && pnpm e2e         # builds the web app and clicks through it in Chromium
```
