# evofab-app

The EvoFab web dashboard: a Next.js (App Router) frontend backed by a FastAPI
server that bridges lab hardware (UR7e robot arm, depth camera, Arduino
solenoid controller) to the browser, plus a Supabase Postgres database for
job/result persistence.

## Stack

- **Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind 4
- **Job/result storage** — Supabase (Postgres + Realtime subscriptions)
- **Hardware bridge** — FastAPI (Python), serving robot arm + camera
  WebSocket streams and Arduino/robot HTTP control endpoints
- **3D printers** — Klipper, controlled via Moonraker's HTTP/WebSocket API
  (called directly from the Next.js server, not through FastAPI)

## Getting started

Install JS dependencies:

```bash
npm install
```

Install Python dependencies for the FastAPI server (requires Python 3.11,
since `pyorbbecsdk` does not yet support 3.14):

```bash
pip install -r app/api/python/requirements.txt
```

Copy `.env.local.example` to `.env.local` and fill in your Supabase project
URL and anon key:

```bash
cp .env.local.example .env.local
```

Run both the Next.js dev server and the FastAPI hardware bridge together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:web   # Next.js only, http://localhost:3000
npm run dev:api   # FastAPI only, http://localhost:8001
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`.

## Architecture

### Frontend (`app/`)

- `setup/`, `monitor/`, `results/`, `history/` — the core job pipeline pages
  (submit a job → watch it print and run → view curvature results → browse
  past results)
- `robot-test/`, `actuation-test/`, `classification-test/`, `camera-test/`,
  `calibration/` — manual hardware diagnostic pages, used to exercise the
  robot arm, solenoids, and camera independently of a full job run
- `components/` — organized by feature area (`setup/`, `monitor/`,
  `results/`, `history/`, `layout/`, `ui/`)
- `contexts/` — React Context providers for job state (`JobContext`),
  printer setup state (`PrinterContext`), and live robot arm status
  (`RobotContext`, backed by a WebSocket to the FastAPI server)
- `lib/` — Supabase client factories, the Moonraker API client, and G-code
  header parsing
- `api/` — Next.js Route Handlers that talk to Supabase and Moonraker
  directly (job CRUD, printer status, results)
- `api/python/` — the FastAPI hardware bridge (see below); not part of the
  Next.js route tree, run as a separate process

### Hardware bridge (`app/api/python/`)

A FastAPI server (`main.py`) that:

- Maintains a background RTDE connection to the UR7e robot arm and streams
  live status (position, safety state, mode) to the browser over
  `/ws/robot`
- Captures frames from the Orbbec depth camera, runs the curvature
  characterization pipeline (`analyzer.py`, `geometry.py`), and streams
  annotated frames plus metrics over `/ws/camera` and `/camera/stream`
- Exposes HTTP endpoints for one-off robot moves, gripper control, and
  Arduino solenoid pulses, used by the manual diagnostic pages
- Enforces robot safety planes (defined in `main.py`) on every commanded
  move

Run standalone with `uvicorn main:app --reload --port 8001 --app-dir
app/api/python`. Configure the robot's IP via the `ROBOT_IP` environment
variable (default `192.168.50.100`).

### Job pipeline

A job moves through: `upload` → `printing` → `transfer` → `experiment` →
`photobooth` → `ml` → `complete` (see `PIPE_STEPS` in `app/types/job.ts`).
Print progress and printer status come from Moonraker; robot, camera, and
experiment status come from the FastAPI bridge and Supabase Realtime.
