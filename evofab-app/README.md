# evofab-app

The EvoFab web dashboard: a Next.js (App Router) frontend backed by a FastAPI
server that bridges lab hardware (UR7e robot arm, Orbbec Gemini 335L camera,
Arduino solenoid controller) to the browser, plus a Supabase Postgres
database for job/result persistence.

## Stack

- **Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind 4
- **Job/result storage** — Supabase (Postgres + Realtime subscriptions)
- **Hardware bridge** — two FastAPI (Python) processes: `main.py` (robot arm
  status over WebSocket, Arduino/robot HTTP control, and on-demand curvature
  classification) and `camera_orbbec_service.py` (a separate,
  root-privileged process that owns the Orbbec camera directly — see
  Architecture below for why it's split out)
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

`npm run dev` / `npm run dev:api` do hardcode a specific Python interpreter
path for `main.py` in `package.json` (this machine's Python 3.11 framework
install, which already has all of `requirements.txt` installed) — point that
at your own interpreter, or run `uvicorn` yourself against whichever Python
has the requirements installed.

The camera is a **separate, third process**, `camera_orbbec_service.py`,
talking to the Orbbec Gemini 335L directly over USB via `pyorbbecsdk` (no
PyPI wheel, so it lives in its own venv, `app/api/python/orbbec_env/`) —
`npm run dev` / `npm run dev:api` do **not** start it. It must run **as
root**: macOS's UVC camera daemon (`VDCAssistant`) otherwise holds an
exclusive claim on the camera's video interface for AVFoundation's use, and
only a root process can preempt that claim. Start it yourself, separately:

```bash
sudo app/api/python/orbbec_env/bin/python app/api/python/camera_orbbec_service.py
```

It listens on port 8002 by default; `main.py` reaches it over HTTP
(`ORBBEC_SERVICE_URL` env var, default `http://127.0.0.1:8002`) rather than
owning the camera itself — see Architecture below.

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
  a route group (doesn't affect the URL): building a pipeline from arbitrary
  technology steps and running it (`printer`, `robot_arm`, `arduino_board`,
  `camera`, and `classification_model` all have real executors — see
  Pipelines below), a merged run history + progress view, and machine
  inventory management, all backed by the `machines`/`pipelines`/
  `pipeline_steps` schema (`supabase/schema.sql`). The `(themed)` layout
  also scopes a light/dark theme toggle to just these three pages — every
  other page stays on the single dark theme in `globals.css`
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
- Proxies camera status/snapshot requests to `camera_orbbec_service.py` (see
  below — it doesn't talk to the camera hardware itself) and, on request,
  runs actuation-synced curvature capture (`analyzer.py` + `geometry.py`) —
  see below
- Runs the same curvature-vision pipeline on demand against an
  already-captured photo via `POST /classify`, for the Pipelines
  `classification_model` step — see below
- Enforces robot safety planes (defined in `main.py`) on every commanded
  move

Run standalone with `uvicorn main:app --reload --port 8001 --app-dir
app/api/python`. Configure the robot's IP via the `ROBOT_IP` environment
variable (default `192.168.50.100`) and the camera bridge's URL via
`ORBBEC_SERVICE_URL` (default `http://127.0.0.1:8002`).

#### Camera (`camera_orbbec_service.py` + `main.py` proxy)

The camera lives entirely in its own process, `camera_orbbec_service.py` —
not a background thread inside `main.py` the way the robot/Arduino bridges
are. Two reasons it's split out:

- **Root privilege.** Opening the Orbbec through `pyorbbecsdk` fails with
  `uvc_open failed ... Return Code: -3` unless run as root, because macOS's
  UVC camera daemon (`VDCAssistant`) already holds an exclusive claim on the
  camera's video interface for AVFoundation's use. Running the whole
  `main.py` bridge as root just to satisfy this one dependency wasn't worth
  it, so only the camera process needs `sudo`.
- **No PyPI wheel.** `pyorbbecsdk` is installed into its own venv
  (`app/api/python/orbbec_env/`), separate from `main.py`'s interpreter.

(This replaces an earlier `camera_manager.py`, which read the Orbbec over
plain OpenCV/`CAP_AVFOUNDATION` instead — kept as a fallback at the time
because `pyorbbecsdk` had no PyPI wheel and previous attempts to build it
from source failed to detect this hardware. Running it as its own rooted
process resolved that, so `camera_manager.py` is gone.)

`camera_orbbec_service.py` connects to the camera **by serial number**
(`ORBBEC_SERIAL`, found via `get_orbbec_serial.py`) rather than "first
device found," and keeps the pipeline open for the life of the process.
Every `GET /capture` blocks on `pipeline.wait_for_frames()` and grabs a
brand-new frame — there is no continuously-updated cache.

Endpoints (port 8002 by default): `GET /status`, `GET /capture` (single
JPEG).

`main.py` proxies to this service over HTTP (`ORBBEC_SERVICE_URL`) rather
than touching the camera itself, so existing camera-consuming code
(`actuation-test/page.tsx`'s live preview, the actuation-synced capture
below) didn't need to change when the camera moved out of it:

- `GET /camera/status` — translates the Orbbec bridge's `{connected,
  resolution}` into the `{connected, backend, resolution}` shape callers
  already expected
- `GET /camera/snapshot` — forwards one `/capture` call; meant to be polled
  with a cache-busting query param for a live preview, not an MJPEG stream.
  **Every poll now costs a real frame grab** on the Orbbec bridge (no cache
  to re-serve from) — worth knowing if this is ever polled much faster than
  `actuation-test`'s current ~5/sec (`SNAPSHOT_POLL_MS`)

A Pipelines `camera` step's on-demand capture bypasses `main.py` entirely
and calls `camera_orbbec_service.py` directly — see Pipelines below.

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
marked `synced: false`. The frame itself now comes from an HTTP round trip
to `camera_orbbec_service.py` rather than an instant in-memory read off a
continuously-running background thread, so `latency_ms` in the result below
also includes network + SDK wait + JPEG encode/decode overhead — treat it as
"time to capture," not a pure hardware-capture number.

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

#### Classification (`POST /classify`)

A second entry point into the same curvature-vision pipeline as the
actuation-synced capture above (`_annotate_curvature()`, shared code) — but
run on demand against an **already-captured photo** (typically from a
Pipelines `camera` step, see below) instead of a live camera frame, and
independently tunable per machine rather than using `main.py`'s fixed
module-level `_analyzer`/`PPM`.

`POST /classify` (multipart: `file`, plus optional `z_min`/`z_max`/
`threshold` form fields, sourced from a machine's
`machine_classification_model` row) builds a fresh
`ActuatorAnalyzer(z_min, z_max, threshold)` per request and runs it through
the same mask → largest-contour → skeletonize → circle-fit pipeline. The
response's keys match `action_types.output_schema` for the
`classification_model` machine type's `classify` action exactly:

```json
{
  "analysis_status": "TRACKING",   // TRACKING | NO_TARGET | MATH_ERROR
  "mean_curvature": 12.3,          // 1/m — null unless TRACKING
  "bend_angle_deg": 45.6,          // null unless TRACKING
  "radius_mm": 81.2,               // null unless TRACKING
  "ppm_used": 2800.0,              // main.py's PPM constant, for traceability
  "actuator_length_mm": 66.0,      // geometry.py's ACTUATOR_LENGTH_M
  "image_url": "/classify/last-image"
}
```

`analysis_status` **is** the classification result — `z_min`/`z_max`/
`threshold` only tune mask generation (they're `ActuatorAnalyzer`'s
constructor args, carried straight through from
`machine_classification_model`'s columns of the same name), not a separate
pass/fail cutoff. The annotated (mask/skeleton/fit overlay) image is
available at `GET /classify/last-image` for as long as that classification
stays the most recent one.

Consumed by a Pipelines `classification_model` step — see below.

### Pipelines

The `(themed)/pipelines/` page builds an ordered list of steps (`Step[]` in
`app/components/pipelines/types.ts`) — each a `{ tech, action, machine,
inputs }` tuple — then, on **Run Pipeline**, persists them to
`pipelines`/`pipeline_steps` (`supabase/schema.sql`) and executes them one
at a time client-side.

- **Schema is entirely DB-driven.** `machine_types` lists the five
  technologies (`printer`, `robot_arm`, `arduino_board`, `camera`,
  `classification_model`); `action_types` defines each technology's actions,
  with `input_schema`/`output_schema` (bare `StepInputConfig[]`/
  `StepOutputConfig[]` JSON — see `types.ts`) describing the step-builder
  form and the values later steps can reference. An action only shows up in
  the builder once its row's `is_implemented` is `true` — code can be fully
  wired up and still invisible in the UI if that flag lags behind.
- **Execution is one function per technology.**
  `app/components/pipelines/stepExecutors.ts` exports `STEP_EXECUTORS`, a
  `Record<TechKey, StepExecutor>` that `PipelineBuilder.runPipeline()` looks
  up per step. Each executor gets just enough context
  (`StepExecutorContext`) to run in isolation — machine IPs, the printers
  list, setters for the "Now Running" side panel (`StepMonitorCard.tsx`),
  and `stepOutputsByNum`, a plain object mutated in place as each step
  completes so a later step can resolve an earlier one's outputs
  synchronously, mid-run. `robot_arm`'s Gripper Cycle is currently the only
  action with no executor yet — it throws `StepNotImplementedError`, which
  `runPipeline` reports as `status: 'skipped'` rather than failing the run.
- **Steps can reference each other's outputs.** An input with
  `type: 'step_output'` (e.g. classification's `photo_source`) renders as a
  dropdown of candidate steps in `StepDraftForm.tsx`, filtered by `expects`
  against candidate steps' `output_schema[].type`. The committed value is
  the referenced step's display number (`Step.num`), which the consuming
  executor looks up in `stepOutputsByNum`.

#### Camera step

`runCameraStep` (`stepExecutors.ts`) calls `POST /api/camera-capture`
(`{ machineId }`) → `app/lib/camera.ts`'s `capturePhoto()` →
`camera_orbbec_service.py`'s `GET /capture` directly, bypassing `main.py`
entirely. The `delay` input (seconds, default 0.5, seeded on the
`snapshot`/"Capture" action) is a pause *before* the shutter fires — since a
camera step synced to e.g. an actuation pulse is represented as two
ordinary steps sharing `sync_group_id` rather than one action spanning both
machines, this delay is what lets the preceding step's physical effect
visibly settle first.

The captured JPEG is embedded as a data URL (the bridge has no re-fetchable
"last capture" cache, and this guarantees redisplaying it later never
re-triggers the camera) and stored as:

```ts
{ image_keys: [dataUrl], summary: 'Photo captured' }
```

`image_keys` — plural, an `image_array` output — is a one-element array
rather than a bare string, so a future multi-frame or synced multi-camera
capture could return more than one photo without an output-schema change.

#### Classification Model step

`classifyPhoto` (`stepExecutors.ts`) resolves `photo_source` (a
`step_output` input with `expects: 'image_array'`, so only camera steps are
selectable candidates) to `stepOutputsByNum[sourceStepNum].image_keys[0]` —
today always the whole photo, since a camera step only ever returns one.
That image is sent to `POST /api/classify`, which:

1. Resolves `machineId` → `machines.ip/port` (the machine's
   `classification_model` bridge — `main.py`, see above) plus its
   `machine_classification_model` row (`threshold`/`z_min_m`/`z_max_m`)
2. Fetches the source photo **server-side**, so it works regardless of
   where the photo is hosted
3. Forwards both to the bridge's `POST /classify` (see above) as multipart

The response is stored verbatim as the step's outputs — its keys already
match `action_types.output_schema` for `classify` exactly (see above).
`StepMonitorCard.tsx`'s `ClassificationMonitor` shows the source photo
(replaced by the bridge's annotated version once it responds), a live
"classifying…" state, and the curvature metrics once `analysis_status ===
'TRACKING'`.

**Machine configuration required for both steps.** A `camera`/
`classification_model` machine row needs a real `ip`/`port` pointing at its
bridge — `camera` machines at `camera_orbbec_service.py` (port 8002 by
default), `classification_model` machines at `main.py` (port 8001, the same
bridge as the robot arm — there's no dedicated "classification bridge"
process, since `POST /classify` just reuses `main.py`'s existing
`analyzer.py`/`geometry.py` imports). Because `machines.ip` is `UNIQUE`, two
rows that legitimately point at the exact same host:port (e.g. `UR7e` and a
`classification_model` machine both reaching `main.py`) need visibly
distinct loopback literals for that one column — `127.0.0.1` vs `127.0.1`
vs `localhost` vs `127.1` all resolve to the same address, just spelled
differently — purely to satisfy the constraint. That's a workaround for the
constraint, not a statement that these are different hosts.

### Job pipeline

A job moves through: `upload` → `printing` → `transfer` → `experiment` →
`photobooth` → `ml` → `complete` (see `PIPE_STEPS` in `app/types/job.ts`).
Print progress and printer status come from Moonraker; robot, camera, and
experiment status come from the FastAPI bridge and Supabase Realtime.
