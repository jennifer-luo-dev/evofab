# Local development and iteration

## Repository baseline

Local work begins from the complete `origin/main` repository. The
`origin/robot-arm-status` reference is fetched for visibility but is not merged
or modified during the Klipper-wrapper foundation work.

At the start of this work, TypeScript passed and ESLint reported six errors.
Those baseline errors are fixed independently of printer behavior.

## First-time setup

1. Install Node 22 and Docker.
2. From `evofab-app`, run `nvm use` and `npm ci`.
3. Run `npx playwright install chromium` once for browser tests.
4. Copy `.env.example` to `.env.local`.
5. Run `npx supabase start` and copy its local URL and anon key into `.env.local`.
6. Run `npx supabase db reset` to apply migrations and deterministic seed data.
7. Run `npm run dev` and open <http://127.0.0.1:3000/setup>.

Never place a shared Supabase URL, service-role key, or lab printer address in
`.env.example`, migrations, seed files, test fixtures, screenshots, or logs.

## Development modes

### Mock (default)

`npm run dev` starts both Next.js and `scripts/mock-moonraker.mjs`. The client
enforces a loopback URL, so database printer addresses are ignored. Change the
simulator state without restarting it:

```bash
curl -X POST http://127.0.0.1:7125/__mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"shutdown"}'
```

Supported scenarios are `ready`, `printing`, `paused`, `busy`, `offline`,
`timeout`, `shutdown`, `malformed`, and `command-failure`.

### Local

`npm run dev:local` runs the application with Moonraker disabled. Use it for
database and non-printer UI work where even simulated commands are undesirable.

### Hardware

`npm run dev:hardware` is the only development command that resolves printer
addresses from the database. Run it only on lab Wi-Fi with a supervisor when a
test involves heating, movement, restart, raw G-code, or emergency stop.

## Requirement iteration loop

1. Choose one requirement ID from the Klipper wrapper specification.
2. Add a failing unit or contract test.
3. Implement against mock mode.
4. Keep `npm run test:watch` open while iterating.
5. Run `npm run check` before a local commit.
6. Run the relevant Playwright flow with local Supabase.
7. If hardware is necessary, complete the safety checklist and record results
   using `docs/hardware-test-log-template.md`.
8. Commit a small reversible change, such as `FR-5: add pause contract`.

## Test layers

- Unit/contract: typed client, safety configuration, parsers, and state logic.
- Integration: real mock-server process and local Supabase boundaries.
- E2E: browser workflows against seeded local services.
- Hardware: supervised physical verification, excluded from all default checks.

Run hardware tests only with both gates:

```bash
RUN_HARDWARE_TESTS=true \
HARDWARE_CONFIRMATION=I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE \
npm run test:hardware
```

## Reset and troubleshooting

```bash
npx supabase db reset       # recreate local schema and deterministic data
rm -rf .next                # clear only generated Next.js output
npm ci                      # restore locked dependencies
npm run check               # reproduce the complete local gate
```

- If no printer becomes ready, check `http://127.0.0.1:7125/__mock/health`.
- If the setup page cannot load, verify local Supabase is running and the two
  public Supabase values in `.env.local` match its status output.
- If port 7125 is occupied, stop the stale simulator before restarting; do not
  point mock mode at another host.
- If hardware mode cannot connect, return to mock mode first. Do not weaken the
  confirmation or loopback checks to diagnose lab networking.
