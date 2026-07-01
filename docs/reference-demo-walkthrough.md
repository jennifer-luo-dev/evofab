# Reference Demo Walkthrough

This branch is a reference snapshot of the local EvoFab demo loop. It should not
be merged to `main` as one pull request. Use it to recover proven behavior while
rebuilding production features on clean branches.

## What The Demo Proves

The demo proves a mock-first printer workflow:

1. Open `/setup`.
2. Select the seeded mock printer, `Mock Sovol Zero`.
3. Upload a `.gcode` file.
4. Parse slicer settings from the file header.
5. Submit a job.
6. Persist the job in Supabase before sending commands.
7. Upload G-code to the mock Moonraker server.
8. Apply temperature, speed, flow, and fan overrides.
9. Start the print.
10. Open `/monitor/[jobId]`.
11. Poll printer state and show progress, layer, and temperature.
12. Pause, resume, cancel, emergency stop, or restart the mock printer.
13. Inject a simulated MCU fault and recover with firmware restart.

## Main Pieces

- `evofab-app/scripts/mock-moonraker.mjs` runs a loopback Moonraker simulator.
- `evofab-app/app/lib/moonraker/` contains the Moonraker client and safety mode
  checks.
- `evofab-app/app/lib/gcode/analyze.ts` reads common slicer settings from G-code
  headers.
- `evofab-app/supabase/` contains the local database schema, migration, and seed
  data.
- `evofab-app/app/api/jobs/route.ts` owns job creation and the upload/start
  sequence.
- `evofab-app/app/api/printers/[id]/control/route.ts` owns pause, resume,
  cancel, e-stop, restart, and firmware restart.
- `evofab-app/app/components/demo/DemoScenarioBar.tsx` switches mock printer
  states for demos and tests.
- `evofab-app/tests/e2e/upload-to-monitor.spec.ts` proves the browser happy path.

## Local Run

Start Docker Desktop first.

```bash
cd evofab-app
nvm use
npm ci
cp .env.example .env.local
npx supabase start
npm run dev
```

Open `http://127.0.0.1:3000/setup`.

## Verification

```bash
cd evofab-app
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

As of this reference snapshot, these checks passed locally.

## What Is Demo-Only

- Demo state switching belongs in mock/dev mode only.
- `/api/printers` includes temporary mock behavior for alternate printer states.
- The monitor polls the full printer list and filters to one printer.
- The setup page and monitor page do not yet share one final status source of
  truth.
- The fleet connector/aggregator architecture is not implemented.
- Printer onboarding, auto-routing, and per-printer queues are not implemented.

## How To Use This Branch Later

Do not cherry-pick the whole branch into a feature branch. Instead:

1. Start from latest `main`.
2. Create one clean branch for one Notion task.
3. Copy or reimplement only the relevant pieces from this reference branch.
4. Run the full gate.
5. Open one focused PR.

Suggested clean rebuild order:

1. Workflow/tooling.
2. Supabase local fixtures.
3. Moonraker client and safety modes.
4. G-code settings parser.
5. Printer fleet status architecture.
6. Job submit to mock printer.
7. Monitor controls and fault recovery.
8. Results/history.
9. Robot bridge integration.
