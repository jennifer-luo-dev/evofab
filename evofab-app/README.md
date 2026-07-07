# EvoFab Dashboard

Next.js dashboard for EvoFab printer setup, job monitoring, and results review.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

Copy `.env.local.example` to `.env.local` and fill values from the local
Supabase project or William's hosted project. Keep `.env.local` private.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for server-side/local script writes and
  integration tests
- `SUPABASE_PROJECT_REF` for `supabase link --project-ref "$SUPABASE_PROJECT_REF"`
- `MOONRAKER_MODE=mock` for local Phase F work
- `SLICER_MODE=mock` for local Phase F work
- `SLICER_TOKEN` only when `SLICER_MODE=real`

To initialize a fresh hosted Supabase project after the environment is set:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
```

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

## Cloud Slicer

The dashboard talks to the Phase A slicer service through server-side proxy
routes, so the browser never receives the bearer token. Local development
defaults to mock mode:

```bash
SLICER_MODE=mock
```

Real mode requires the running slicer service and the shared token in
`.env.local`:

```bash
SLICER_MODE=real
SLICER_URL=http://localhost:8055
SLICER_TOKEN=<shared bearer token>
```

Health checks target `/health`; the service root intentionally returns 404.
The dashboard does not hard-code the engine version or localhost. Moving the
service to another host should require only a `SLICER_URL` change. Mock mode
returns fixture G-code with `START_PRINT` and extruding `G1` moves so the UI
and print handoff match real slicer output markers.

Prepare-stage mock mode also echoes the additive `rotation` quaternion and
`supports` boolean returned by `POST /slice`. The Cloud Slicer form exposes one
`Add supports` switch; the `/inspect` proxy drives the overhang nudge and can
enable that switch without adding support-type controls.

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
