# EvoFab Dashboard

Next.js dashboard for EvoFab printer setup, job monitoring, and results review.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Mock Printer Status

The dashboard reads live printer state from Supabase `printer_status`. For local
development without hardware, run the deterministic mock status producer in a
separate terminal:

```bash
MOONRAKER_MODE=mock npm run status:mock
```

Useful environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for local script writes when RLS requires it
- `MOONRAKER_MODE=mock`
- `MOCK_STATUS_SEED` for deterministic scenario changes
- `MOCK_STATUS_INTERVAL_MS`, default `2000`

The producer only runs in mock mode. It writes one status row per active printer
every two seconds by default. If the producer stops, the server read helper
synthesizes offline status after the 30 second stale threshold.

## Moonraker Safety Modes

Read-side Moonraker status calls use an explicit mode:

```bash
MOONRAKER_MODE=mock      # default; only loopback mock URLs are allowed
MOONRAKER_MODE=local     # Moonraker calls are disabled
MOONRAKER_MODE=hardware  # real printer IP/port calls require confirmation
```

Hardware mode requires:

```bash
HARDWARE_CONFIRMATION=I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE
```

The safe status connector normalizes Moonraker `/printer/objects/query`
responses into the existing `printer_status` shape. Local/demo status
development should still prefer `npm run status:mock`.

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Run the local Supabase integration test only when Docker/Supabase are available:

```bash
RUN_LOCAL_SUPABASE_TESTS=1 npm run test:integration
```
