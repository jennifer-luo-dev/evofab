# evofab-app

The EvoFab web dashboard: a Next.js (App Router) frontend backed by a FastAPI
server that bridges lab hardware (UR7e robot arm, Orbbec Gemini 335L camera,
Arduino solenoid controller) to the browser, plus a Supabase Postgres
database for job/result persistence.

## Stack

- **Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind 4
- **Job/result storage** — Supabase (Postgres + Realtime subscriptions)
- **Hardware bridge** — FastAPI (Python), serving robot arm status over
  WebSocket, camera frames over polled HTTP endpoints, and Arduino/robot
  HTTP control endpoints
- **3D printers** — Klipper, controlled via Moonraker's HTTP/WebSocket API
  (called directly from the Next.js server, not through FastAPI)

## Getting started

Install JS dependencies:

```bash
npm install
```

Install Python dependencies for the FastAPI server:

```bash
pip install -r app/api/python/requirements.txt
```

The camera uses plain OpenCV (`cv2.VideoCapture` + `CAP_AVFOUNDATION` on
macOS) rather than the Orbbec SDK — `pyorbbecsdk` has no PyPI wheel, and even
where it has been built from source it failed to detect this hardware, while
`cv2`/AVFoundation works reliably. So there's no Python-version constraint
from that anymore. `npm run dev` / `npm run dev:api` do hardcode a specific
Python interpreter path in `package.json` (this machine's Python 3.11
framework install, which already has all of `requirements.txt` installed) —
point that at your own interpreter, or run `uvicorn` yourself against
whichever Python has the requirements installed.

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

- `setup/`, `monitor/`, `results/` — the original job pipeline pages (submit
  a job → watch it print and run → view curvature results), still backed by
  the real `jobs`/`printers`/`results` Supabase tables
- `(themed)/pipelines/`, `(themed)/history/`, `(themed)/machine-settings/` —
  a route group (doesn't affect the URL) previewing the interface's target
  shape: building a pipeline from arbitrary technology steps, a merged run
  history + progress view, and machine inventory management. Currently
  **mock-data-only**, ahead of the `machines`/`pipelines`/`pipeline_steps`
  schema (`supabase/schema.sql`) being wired up to an API. The `(themed)`
  layout also scopes a light/dark theme toggle to just these three pages —
  every other page stays on the single dark theme in `globals.css`
- `robot-test/`, `actuation-test/`, `classification-test/` — manual hardware
  diagnostic pages, used to exercise the robot arm, solenoids, and camera
  independently of a full job run. `actuation-test/` also hosts the live
  camera preview and actuation-synced capture (see below) — there is no
  separate camera-test page
- `components/` — organized by feature area (`setup/`, `monitor/`,
  `results/`, `history/`, `pipelines/`, `machine-settings/`, `theme/`,
  `layout/`, `ui/`)
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
- Owns the Arduino solenoid control board over USB serial, and exposes HTTP
  endpoints for one-off robot moves, gripper control, and solenoid pulses,
  used by the manual diagnostic pages
- Runs a background camera reader (`camera_manager.py`) and, on request,
  actuation-synced curvature capture (`analyzer.py` + `geometry.py`) — see
  below
- Enforces robot safety planes (defined in `main.py`) on every commanded
  move

Run standalone with `uvicorn main:app --reload --port 8001 --app-dir
app/api/python`. Configure the robot's IP via the `ROBOT_IP` environment
variable (default `192.168.50.100`).

#### Camera (`camera_manager.py`)

`CameraManager` runs a background thread that continuously reads frames from
the Orbbec Gemini 335L over plain OpenCV (`cv2.VideoCapture` +
`CAP_AVFOUNDATION`), RGB only — no depth. Frames land in a single
atomically-reassigned tuple, mirroring the `_rtde_reader` pattern, so no
reader ever sees a torn frame.

**This machine has two cameras** — the MacBook's built-in FaceTime HD Camera
and the external Orbbec — and macOS assigns `cv2` device indices by USB
enumeration order, which reshuffles on every replug or reboot. A hardcoded
index has already once silently redirected capture to the laptop's own
webcam after a replug. To stay correct, `CameraManager` auto-detects the
Orbbec by its native (pre-resize) resolution, **1280×800**, which is
distinct from the FaceTime camera's 1920×1080 default and is a property of
the physical sensor rather than of enumeration order. `test_camera.py` is a
standalone script that probes for it the same way — useful for confirming
the camera is reachable at all, independent of the FastAPI server.

Endpoints: `GET /camera/status`, `GET /camera/snapshot` (single JPEG, meant
to be polled with a cache-busting query param for a live preview — not an
MJPEG stream).

#### Actuation-synced capture + curvature characterization

`POST /actuation/pulse` accepts a `capture: bool` field. When true, it arms
a capture request; `_serial_reader()` (already draining every line the
Arduino sends) watches for `STATUS:BUSY:CH<n>` — the Arduino's own hardware
timestamp for the instant a solenoid physically opens — and resolves the
capture off of that, rather than a client-side timer. There's a deliberate
~0.5 s delay (`CAPTURE_DELAY_S`) between seeing that line and actually
grabbing the frame, since the actuator takes time to visibly inflate/bend
after the valve opens — capturing immediately caught it still at rest. If
`STATUS:BUSY` never arrives within `CAPTURE_TIMEOUT_S` (2 s — Arduino
disconnected, wrong channel, etc.), a fallback frame is captured anyway and
marked `synced: false`.

The resolved frame is run through the existing vision pipeline
(`_annotate_curvature()` in `main.py`):

1. `ActuatorAnalyzer.generate_mask()` (`analyzer.py`) — brightness-threshold
   mask (RGB-only input never has depth data, so this always takes the
   8-bit grayscale branch, not the depth-gated one)
2. Restricted to the mask's **largest connected contour** before
   skeletonizing — `main.py`-side logic, not part of `analyzer.py`. Added
   after discovering that the test rig's reflective enclosure also clears
   the brightness threshold in scattered patches; without this restriction,
   the skeleton (and the circle fit built from it) tracked background noise
   instead of the actuator.
3. `ActuatorAnalyzer.extract_spine()` (`analyzer.py`) — skeletonization via
   `cv2.ximgproc.thinning`
4. `compute_spine_curvature()` (`geometry.py`) — least-squares circle fit to
   the skeleton, returning curvature (`K`, 1/m), bend angle (deg, assuming a
   fixed 66 mm actuator length), and radius (`R`, mm)

The mask, skeleton, fitted arc, and metrics are drawn directly onto the
captured image before it's saved, so the fit can be visually checked
against the frame it came from. **Nothing is persisted to disk** — this is
a live/latency-check view, not a stored result; `_last_capture_meta` /
`_last_capture_jpeg` hold only the most recent capture, in memory.

Endpoints: `GET /camera/last-capture` (metadata: channel, synced, latency,
timestamp, curvature fields), `GET /camera/last-capture/image` (the
annotated JPEG).

The pixels-per-metre scale factor (`PPM = 2800.0` in `main.py`) is an
**uncalibrated** carryover default — `mean_curvature`/`radius_mm` are only
as accurate as that number; the fitted arc's shape/position on the drawn
image doesn't depend on it, so it stays a useful sanity check even if the
absolute numbers are off.

### Job pipeline

A job moves through: `upload` → `printing` → `transfer` → `experiment` →
`photobooth` → `ml` → `complete` (see `PIPE_STEPS` in `app/types/job.ts`).
Print progress and printer status come from Moonraker; robot, camera, and
experiment status come from the FastAPI bridge and Supabase Realtime.
