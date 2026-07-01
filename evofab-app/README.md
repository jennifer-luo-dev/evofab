# EvoFab App

Next.js dashboard for printer setup, Moonraker/Klipper control, monitoring, and
EvoFab experiment records.

## Quick start

Requirements: Node 22, npm 10+, Docker, and the Supabase CLI.

```bash
nvm use
npm ci
cp .env.example .env.local
npx supabase start
```

Copy the local Supabase URL and anon key printed by `supabase start` into
`.env.local`, then run:

```bash
npm run dev
```

This starts Next.js and a loopback-only Moonraker simulator. Open
<http://127.0.0.1:3000/setup> and select **Mock Sovol Zero**.

## Operating modes

| Command                | Moonraker behavior               | Intended use                       |
| ---------------------- | -------------------------------- | ---------------------------------- |
| `npm run dev`          | Loopback simulator               | Default feature development        |
| `npm run dev:local`    | Printer commands disabled        | UI/database work without a printer |
| `npm run dev:hardware` | Real addresses from the database | Supervised work on lab Wi-Fi       |

Hardware mode prints a warning and requires the explicit command. Automated
hardware tests have an additional environment gate and never run under
`npm test` or `npm run check`.

## Verification

```bash
npm run format:check
npm run test:watch
npm run test:integration
npm run test:e2e
npm run check
```

`npm run check` runs lint, TypeScript, unit tests, and a production build. E2E
tests require local Supabase to be running. See
[`docs/local-development.md`](./docs/local-development.md) for the complete
iteration and troubleshooting process.

Run `npm run format` before committing code changes. Contribution workflow and
PR requirements live in [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
