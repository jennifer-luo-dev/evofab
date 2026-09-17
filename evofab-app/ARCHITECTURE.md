# EvoFab Architecture

This is the reference document for how EvoFab is put together: the final
directory structure, the core abstractions (machine bridge clients, the
Pipelines "tech module" pattern), step-by-step guides for extending it, full
environment setup, and a changelog of the modularity/cleanup pass that
produced this document (see [`REFACTOR_PLAN.md`](REFACTOR_PLAN.md) for that
pass's day-to-day log and reasoning). `README.md` stays the short front
door; this is the long-form reference it points to.

## 1. Repository structure

```
evofab/                          (repo root)
├── evofab-app/                  Next.js web app + FastAPI hardware bridge (this document's focus)
├── arduino/soft_robotics_control/  Arduino Uno R3 firmware for the pneumatic solenoid board
└── ros2_ws/src/evofab_robot/    ROS 2 package — an alternative UR7e motion path via MoveIt 2,
                                  not on the primary runtime path (see §2.3)
```

Inside `evofab-app/`:

```
evofab-app/
├── app/
│   ├── (themed)/                 pipelines/, history/, machine-settings/ — the real, nav-linked
│   │                             product surface, sharing a light/dark ThemeProvider layout
│   ├── setup/ monitor/ results/  the original job-pipeline flow — functional, real Supabase
│   │                             tables, but unlinked from NavTabs (see §6, "left unchanged")
│   ├── robot-test/ actuation-test/ classification-test/ camera-test/
│   │                             manual hardware diagnostic pages, not nav-linked except
│   │                             camera-test ("Camera Feed", marked temporary in NavTabs)
│   ├── api/                      Next.js Route Handlers — Supabase + Moonraker, one dir per route
│   │   └── python/               the FastAPI hardware bridge — NOT part of the Next.js route
│   │                             tree, run as its own process (see §2)
│   ├── components/               by feature area: pipelines/, machine-settings/, monitor/,
│   │                             results/, setup/, history/, position-picker/, layout/, ui/, theme/
│   ├── contexts/                 JobContext, PrinterContext, RobotContext, ThemeContext
│   ├── lib/                      hardware-bridge HTTP clients + shared client helpers (§2.2),
│   │                             Moonraker client, Supabase client factories, gcode parsing
│   └── types/                    shared domain types: job.ts, printer.ts, result.ts, machine.ts
├── supabase/                     schema.sql, action_types_rows.sql — coordinate with the repo
│                                 owner before changing (see CONTRIBUTING.md)
├── REFACTOR_PLAN.md              this pass's plan + phase-by-phase log
└── ARCHITECTURE.md               this document
```

No new top-level directories were introduced by this pass — every new file
landed inside the existing structure (mostly `app/lib/` and
`app/components/pipelines/`), per `CONTRIBUTING.md`'s "don't create new
top-level folders without discussing first."

## 2. The hardware bridge (`app/api/python/`)

A FastAPI server, `main.py`, run as its own process (`npm run dev:api`, port
8001 by default) — **not** part of the Next.js route tree. It:

- Maintains a background RTDE connection to the UR7e and streams live status
  over `/ws/robot` (consumed by `RobotContext`).
- Owns the Arduino solenoid board over USB serial (`/actuation/*`).
- Proxies camera status/snapshot requests to `camera_orbbec_service.py` (see
  §2.1) and runs actuation-synced curvature capture on demand.
- Runs the same curvature-vision pipeline (`analyzer.py` + `geometry.py`) on
  an already-captured photo via `POST /classify`.
- Enforces the UR7e's safety planes on every commanded move.

Configuration: `ROBOT_IP` (default `192.168.50.100`), `ORBBEC_SERVICE_URL`
(default `http://127.0.0.1:8002`).

### 2.1 Why the camera is a separate process

`camera_orbbec_service.py` is a **third, independent process** (port 8002),
not a background thread inside `main.py` the way the robot/Arduino bridges
are, for two reasons:

- **Root privilege.** `pyorbbecsdk` fails to open the camera unless run as
  root — macOS's UVC camera daemon (`VDCAssistant`) already holds an
  exclusive claim on the video interface for AVFoundation's use, and only a
  root process can preempt it. Running all of `main.py` as root just for
  this was judged not worth it.
- **No PyPI wheel.** `pyorbbecsdk` lives in its own venv
  (`app/api/python/orbbec_env/`, ~1GB, **never commit source changes near
  it** — see §5's ESLint note), separate from `main.py`'s interpreter.

`main.py` talks to it over plain HTTP (`httpx`), proxying `/camera/*`
requests so existing camera-consuming code didn't need to change when the
camera moved out of `main.py`. A Pipelines `camera` step bypasses `main.py`
entirely and calls `camera_orbbec_service.py` directly (see §3's camera
executor).

### 2.2 There is no unified "machine" abstraction in the backend — by design, partly

Each of the three Python-side machine types (robot / Arduino / camera) has
its own connection-ownership model: a background RTDE-reader thread, a
background serial-reader thread, and a wholly separate rooted process,
respectively. **This pass did not unify these** (see `REFACTOR_PLAN.md`
Phase D) — each shape is a real consequence of that hardware's constraints,
not an accident:

- RTDE needs a continuously-polling reader thread to have live state ready
  for `/ws/robot` without per-request connect latency.
- The Arduino needs exactly one persistent serial handle (a second one would
  fight the first for the port).
- The camera's root requirement forces it out of `main.py`'s process
  entirely.

What *did* get unified: internal error-handling shape (via
`logging.getLogger(__name__)`, replacing several previously-silent
`except Exception: pass` blocks with real `logger.warning(...)` calls) —
purely additive, no change to any HTTP response. The three genuinely
duplicated bits found on close reading — the move-confirmation polling
loop, and the "open a socket to 30002 and send URScript" pattern — turned
out to have real behavioral differences per call site (e.g. the e-stop's 3s
socket timeout with its own error handling vs. the move functions' 5s
timeout) once read in full, so they were deliberately left alone rather than
forced into a shared helper that would risk changing timing on a real e-stop
path. See `REFACTOR_PLAN.md`'s Phase D section for the full trace.

**Klipper/Moonraker printers are not in this backend at all** — they're the
one machine type controlled straight from Next.js/the browser (see §2.4).

### 2.3 The ROS 2 path (`ros2_ws/`)

A separate, parallel UR7e control path (`evofab_robot`'s `move_node.py`)
bridging HTTP `POST /move` to MoveIt 2, independently re-implementing the
same three safety planes `main.py` and `position-picker/constants.ts` also
encode. Per the root README, this is "used alongside or as an alternative
to the direct RTDE control path" — not the primary path today, and outside
this pass's tested surface (no Python environment or ROS 2 workspace
available to verify changes against). The safety-plane triplication across
these three places is flagged, not fixed — see §6.

### 2.4 Printers: the one machine type with no backend involvement

`app/lib/moonraker.ts` talks to each printer's Moonraker HTTP/WS API
directly from Next.js (server routes and, in one case —
`PrinterGrid.tsx` — directly from the browser). No Python process is
involved. This asymmetry (3 machine types proxied through `main.py`, one
bypassing it entirely) is inherent to what each protocol needs, not a gap:
Moonraker already speaks plain HTTP/WS, so there's nothing for a Python
bridge to add.

## 3. Frontend hardware clients (`app/lib/`)

Five files, one per bridge, all following the same convention (see each
file's own header comment): plain exported `async function`s, raw `fetch`,
no classes, no persistent client objects.

| File | Talks to | Notes |
|---|---|---|
| `robot.ts` | `main.py` `/robot/*` | `moveRobot`/`stopRobot`; also exports `JOINT_NAMES`/`JOINT_LABELS`, reused by every robot-arm UI |
| `arduino.ts` | `main.py` `/actuation/*` | `firePulse` — acks on serial-write success, doesn't block for the pulse duration (caller times that out) |
| `camera.ts` | `camera_orbbec_service.py` directly | `captureDepthAndColor` |
| `classification.ts` | `main.py` `/classify` | `classifyImage` |
| `moonraker.ts` | each printer's Moonraker API | the largest file — upload/settings/start/pause/status/webcam/metadata |

### 3.1 `bridgeClient.ts` — the shared HTTP convention

All five files used to redefine the same 3-line `http://${ip}:${port}` URL
builder and the same "throw a descriptive `Error` on a non-2xx response"
block independently. `app/lib/bridgeClient.ts` now provides both:

```ts
export function bridgeBase(ip: string, port: number): string
export async function throwIfNotOk(res: Response, label: string): Promise<void>
```

A new hardware-bridge client should use these rather than reimplementing
them — see `robot.ts` for the smallest example of the pattern.

### 3.2 `machineRouting.ts` — the shared API-route convention

The Next.js routes that front a bridge (`actuate`, `camera-capture`,
`classify`, `print`, `print/pause`, `robot-move`, `robot-stop`) each used to
independently: look up a `machines` row's `ip`/`port` (404 if missing),
fall back to a per-route default port, and try/catch the bridge call into a
502. `app/lib/machineRouting.ts` now provides:

```ts
export async function resolveMachine(
  supabase, machineId: string, notFoundMessage: string, defaultPort: number
): Promise<{ ip: string; port: number } | NextResponse>   // a 404 NextResponse on failure

export async function callBridge<T>(fn: () => Promise<T>): Promise<T | NextResponse>  // a 502 NextResponse on failure
```

A route using these returns early when the result `instanceof NextResponse`
— see any of the seven routes above for the pattern. **Every route's exact
status codes and JSON shapes are unchanged from before this pass** — this
was a pure internal de-duplication, verified diff-by-diff.

## 4. Pipelines: the core orchestration model

The `(themed)/pipelines/` page builds an ordered list of steps
(`app/components/pipelines/types.ts`'s `Step`), each a
`{ tech, action, machine, inputs }` tuple, then runs them client-side — the
browser tab *is* the orchestrator; there is no server-side pipeline runner
or queue. If the tab closes mid-run, the run is stuck at `status: 'running'`
in the DB until manually cleaned up (a known, accepted limitation, not a bug
— see `app/api/pipelines/[id]/route.ts`'s own comment on this).

### 4.1 Schema is DB-driven, dispatch is a registry

`machine_types` lists the technologies (`printer`, `robot_arm`,
`arduino_board`, `camera`, `classification_model` today — see
`app/types/machine.ts`'s `TechKey`, a free-form string, not a closed set);
`action_types` defines each technology's actions with `input_schema`/
`output_schema` JSON describing the step-builder form. Adding a new
*action* on an *existing* tech (a new field on an existing form) is a data
change — insert rows, no code. Adding a new *tech*, or new client-side
*behavior* for an action, is the guide in §5 below.

Execution is one async function per tech, `stepExecutors.ts`'s
`STEP_EXECUTORS: Partial<Record<TechKey, StepExecutor>>`, looked up by
`PipelineBuilder.runPipeline()`. A tech with no entry (or whose executor
throws `StepNotImplementedError` — today only `robot_arm`'s Gripper Cycle,
a deliberate stand-in, see §6) is marked `skipped` rather than failing the
run.

### 4.2 The "Now Running" panel registry — this pass's main abstraction

**Before this pass:** showing a tech's live status while it's running meant
four different files each keeping their own copy of "which techs have a
panel": `stepExecutors.ts`'s `StepExecutorContext` had four named setters
(`setRunningPrinter`/`setRunningRobot`/`setRunningCamera`/
`setRunningClassification`), `PipelineBuilder.tsx` had four matching
`useState`s and a `RUNNING_KIND_BY_TECH` translation map, and the render
section had four hardcoded `{runningX && <StepMonitorCard .../>}` lines.
Adding a fifth tech's panel meant touching all of it.

**After this pass:**

```ts
// stepExecutors.ts — one context method, keyed by tech:
setRunningStep: (tech: TechKey, state: SetStateAction<RunningStepState | null>) => void

// PipelineBuilder.tsx — one state map instead of four:
const [runningSteps, setRunningSteps] = useState<Partial<Record<TechKey, RunningStepState>>>({})

// render — one .map() instead of four conditionals:
{Object.values(runningSteps)
  .filter((r): r is RunningStepState => !!r)
  .map((running) => <StepMonitorCard key={running.kind} running={running} />)}
```

This is a **generalization, not a simplification-by-deletion**: more than
one tech's panel can be visible at once today (a synced batch spanning two
techs — e.g. a robot move synced with a camera capture — shows both
panels simultaneously), and the map-based design preserves that for any
number of techs rather than the four that happened to be hardcoded before.
Verified live (see `REFACTOR_PLAN.md` Phase E) with a browser smoke test of
the Camera tech's panel rendering through the new path, and by tracing the
batch-clear logic against the original four-`if` version step by step.

**A new tech's live panel needs exactly:**
1. A `Running<Tech>State` variant added to `StepMonitorCard.tsx`'s
   `RunningStepState` union.
2. A branch inside `StepMonitorCard`'s own `if (running.kind === ...)`
   dispatch (already centralized in that one function).
3. One `ctx.setRunningStep(step.tech, { kind: '...', ... })` call in the
   new tech's executor.

No `StepExecutorContext` interface change, no `PipelineBuilder` state
change, no new render line.

### 4.3 Stop handling — `stopHandling.ts`

`ContainerView.tsx`'s row-level Stop button used to hardcode
`STOPPABLE_TECHS: Record<string, string>` (tech → halt-endpoint) locally,
*plus* a separate `step.tech === 'printer'` special case just for the
tooltip text — meaning a third stoppable tech would have silently inherited
the wrong tooltip. Both now live in
`app/components/pipelines/stopHandling.ts`:

```ts
export interface StoppableTechConfig { endpoint: string; label: string }
export const STOPPABLE_TECHS: Partial<Record<TechKey, StoppableTechConfig>>
export const NOT_STOPPABLE_LABEL: string   // tooltip for a tech with no entry above
```

A tech's hardware doesn't need a `STOPPABLE_TECHS` entry to work in a
pipeline — it just means the row's Stop button only aborts the client-side
wait (still correct), without also halting the physical hardware
mid-action. Only add an entry when there's a real, safe halt endpoint for
that hardware (see `robot_arm`/`printer`'s entries for the shape).

### 4.4 What stayed a scattered pattern, on purpose

Two more places the original audit flagged as "per-tech, touch N files" were
deliberately **not** folded into a bigger registry this pass — see
`REFACTOR_PLAN.md` Phase E's "deliberately not done" list for the full
reasoning:

- **`icons.tsx`'s `MACHINE_TYPE_ICONS`** — already one central map, not
  actually scattered; folding it into a data-only registry would mean
  importing React components into that registry for no reduction in touch
  points.
- **`StepDraftForm.tsx`'s per-tech extra UI** (`isPrinter`'s settings
  panel, `isRobotMove`'s move-target modal) — only 2 of 5 techs need this;
  a `formExtras` registry slot for two cases isn't a win yet.
- **`StepMonitorCard.tsx` vs. `HistoryStepMonitor.tsx`** — a real
  ~250-line near-duplicate (live run state vs. polled-from-DB history
  state), but unifying them means designing one shared intermediate shape
  both a live run and a History replay can produce — a feature of
  follow-on work, not a mechanical extraction. This is the most valuable
  next step if this pass continues (see §6).

## 5. How-to: add a new machine

Concrete steps, in order, using `robot_arm` as the running example of "what
already exists to copy."

1. **Register the type in Supabase.** Insert a `machine_types` row (`type_key`,
   `name`), then `action_types` rows for each action it supports
   (`input_schema`/`output_schema` — see `types.ts`'s `StepInputConfig`/
   `StepOutputConfig` for the shape `action_types` rows must match). This
   pass didn't touch `supabase/schema.sql` — coordinate with the repo owner
   for schema/migration changes (`CONTRIBUTING.md`).
2. **If it needs a hardware bridge:**
   - A pure-HTTP device (like a printer) needs no Python involvement — add
     a client module in `app/lib/` using `bridgeClient.ts`'s `bridgeBase`/
     `throwIfNotOk` (see `robot.ts` for the smallest example).
   - A device needing a persistent connection or elevated privilege needs a
     home in `app/api/python/` — decide whether it fits inside `main.py`
     (if it can share `main.py`'s process/privileges) or needs its own
     process (like the camera, if it needs root or an isolated
     environment — see §2.1).
3. **Add a Next.js API route** under `app/api/<name>/route.ts` using
   `machineRouting.ts`'s `resolveMachine`/`callBridge` (see
   `app/api/robot-move/route.ts` for the pattern).
4. **Add a Pipelines executor.** In `stepExecutors.ts`: write
   `async function run<Tech>Step(step, ctx): Promise<StepOutputs>`, register
   it in `STEP_EXECUTORS`. If it needs a live "Now Running" panel, follow
   §4.2's three steps.
5. **If its hardware can be safely halted mid-action**, add an entry to
   `stopHandling.ts`'s `STOPPABLE_TECHS` (§4.3). If not, no entry is needed
   — the run still aborts correctly, just without a hardware-level halt.
6. **Add an icon** to `icons.tsx`'s `MACHINE_TYPE_ICONS` (falls back to
   `DEFAULT` if omitted — not required, but recommended).
7. **If it needs bespoke step-builder UI** beyond the schema-driven generic
   form (like the robot's Cartesian/joint move-target modal), add an
   `is<Tech>` branch in `StepDraftForm.tsx` alongside the existing
   `isPrinter`/`isRobotMove` ones.
8. **History's replay view** (`HistoryStepMonitor.tsx`) is a separate,
   independent copy of the live monitor dispatch — add a matching branch
   there too if the new tech should show a live-style panel in past-run
   replay (see §4.4 on why this isn't unified yet).

## 6. How-to: add a new pipeline step type (action on an existing tech)

If the tech already exists and you're adding another *action* it can
perform (e.g. a second robot_arm action beyond Move):

1. Insert an `action_types` row for the new action key, with its
   `input_schema`/`output_schema`.
2. In the tech's executor function (e.g. `runRobotArmStep` in
   `stepExecutors.ts`), branch on `step.action` to call the new logic —
   see the existing `step.action === 'gripper'` branch for the pattern (and
   its comment about a past `'gripper'` vs `'gripper_cycle'` key-mismatch
   bug — keep the action key branch and the `action_types` seed row's
   `type_key` in sync by hand, since nothing enforces this at compile time).
3. If the new action needs bespoke input fields beyond the generic
   schema-driven form, extend that tech's `StepDraftForm.tsx` block (§5,
   step 7).
4. If the new action produces an output another step type should be able to
   reference (a `step_output` input elsewhere), give it an `output_schema`
   entry with a `type` other steps' `input_schema[].expects` can match
   against — see `camera`'s `image_array` output and
   `classification_model`'s `photo_source` input for the pattern.

## 7. Environment setup

### Prerequisites

- Node.js (see `evofab-app/package.json` for the toolchain — Next.js 16,
  React 19, TypeScript, Tailwind 4)
- Python **3.11 specifically** for the FastAPI bridge — `pyorbbecsdk` (the
  depth camera SDK) doesn't yet support newer Python versions
- A Supabase project with the schema in `evofab-app/supabase/schema.sql`
  applied (contact the repo owner for migrations)

### Install

```bash
cd evofab-app
npm install
pip install -r app/api/python/requirements.txt   # into your Python 3.11 interpreter
cp .env.local.example .env.local                 # then fill in your Supabase URL/anon key
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and `SUPABASE_SERVICE_ROLE_KEY` (server-only — required for the
machine-type DDL `SECURITY DEFINER` functions). If working on robot-arm
features, the FastAPI server also reads `ROBOT_IP` from the environment.

### Run

```bash
npm run dev        # Next.js + the FastAPI bridge together
# or separately:
npm run dev:web    # Next.js only — http://localhost:3000
npm run dev:api    # FastAPI only — http://localhost:8001
```

`dev`/`dev:api` hardcode a specific Python interpreter path in
`package.json` — repoint it at your own Python 3.11 interpreter with the
requirements installed.

**The camera is a fourth thing to start, separately, and needs root:**

```bash
sudo app/api/python/orbbec_env/bin/python app/api/python/camera_orbbec_service.py
```

Not started by any npm script. See §2.1 for why it must run as root and in
its own venv. The web app and most of the Pipelines UI work fine without it
— only camera/classification steps need it live.

### Verify

```bash
npx tsc --noEmit     # type-check
npm run lint         # ESLint (excludes app/api/python/orbbec_env/ — see below)
npm run format       # Prettier
python -m pytest app/api/python   # the one existing test file, test_geometry.py
```

No Playwright tests exist yet (`playwright` is a devDependency, configured
but unused — `CONTRIBUTING.md` welcomes contributions here). This pass's own
verification, in the absence of a test suite, was: `tsc --noEmit` + `eslint`
after every change, `python -m py_compile` on every touched Python file, and
manual browser smoke-testing (via Playwright, run ad hoc — not committed as
a test) for the Pipelines UI changes in §4.2. See `REFACTOR_PLAN.md` §4 for
the full verification approach.

**ESLint config note (fixed this pass):** `eslint.config.mjs`'s ignore list
didn't exclude `app/api/python/orbbec_env/` — a ~1GB Python venv containing
some bundled JS assets — which made `npm run lint` (with no path argument)
exhaust the linter's heap on every run. Now excluded, along with
`app/api/python/.pytest_cache/`.

## 8. What this pass changed, and why

Full phase-by-phase log with reasoning lives in `REFACTOR_PLAN.md`; this is
the summary.

**Removed (dead code):**
- `camera.ts`'s unused `capturePhoto` export (superseded by
  `captureDepthAndColor`), `moonraker.ts`'s externally-unused
  `MOONRAKER_STATE_MAP` export (demoted to internal).
- An unused top-level `platform` import in `main.py`.
- Unused dependencies: `scipy` and `pyobjc-framework-AVFoundation` (Python,
  leftovers from a retired AVFoundation-based camera implementation);
  `express`, `cors`, and `fastapi` (npm — `fastapi` there is an unrelated,
  never-imported decoy package, not the real Python framework).
- Stale comments pointing at files no longer in the repo (`camera_manager.py`,
  `get_orbbec_serial.py`), rewritten to describe the same history without
  implying those files still exist.

**Fixed (bugs found during the audit, not features):**
- `eslint.config.mjs`'s missing `orbbec_env`/`.pytest_cache` ignores (see §7).
- Two now-unused `recharts` imports in `CurvatureTrendChart.tsx`, surfaced
  by the above fix.
- A naming collision: `app/actuation-test/page.tsx` had its own unrelated
  local `firePulse` function shadowing `lib/arduino.ts`'s real hardware
  client — renamed to `triggerPulse`.
- A stale `evofab-app/README.md` claim that no separate camera-test page
  exists (it does, and is linked from the nav).
- `stopHandling.ts`'s tooltip generalization (§4.3) — a latent bug where a
  third stoppable tech would have inherited the wrong tooltip text.

**Refactored (de-duplication, no behavior change):**
- `app/lib/bridgeClient.ts` (§3.1) — five files' worth of duplicated
  URL-building and error-throwing.
- `app/lib/machineRouting.ts` (§3.2) — seven API routes' worth of
  duplicated machine lookup and bridge-call error mapping.
- `app/types/machine.ts` (`TechKey`) — collapsed with `icons.tsx`'s
  separately-declared `MachineTypeKey`, the same concept under two names.
- The "Now Running" panel registry (§4.2) and stop-handling config (§4.3) —
  this pass's main modularity deliverable.
- `logging.getLogger(__name__)` in `main.py` at four previously-silent
  failure points (§2.2) — log output only, no response change.

**Deliberately left unchanged, on explicit instruction or after risk
assessment (not missed):**
- **Two "temporary test state" spots, on the repo owner's explicit
  instruction, not this pass's inference:** `main.py`'s `_SAFETY_PLANES`
  (east-wall margin loosened to 500mm from 250mm, table-collision margin
  loosened to 1m from 25mm — testing-in-progress values, kept as-is,
  including the pending removal of their "revert after testing" comments),
  and the loop-iteration-minimum-of-1 override duplicated across
  `usePipelineBuilder.ts`, `LoopBlock.tsx`, and `InlineCountPrompt.tsx`
  (each carrying an identical stale "temp for testing" comment) — value and
  comments both left exactly as found in both cases.
- **The legacy job-pipeline vertical** (`app/setup/`, `app/monitor/`,
  `app/results/`, their components, their API routes, and the
  `jobs`/`logs`/`results`/`experiments`/`material_profiles`/`printers`/
  `printer_status` Supabase tables) — fully functional, real data, but
  unlinked from `NavTabs` and undocumented in `schema.sql`. Ambiguous
  enough (working code, just not nav-linked) that deleting it wasn't a safe
  unilateral call; left running, reachable by direct URL.
- **The Robotiq gripper.** `main.py` already has a real
  `POST /robot/gripper` endpoint; `stepExecutors.ts`'s `cycleGripper` is
  still a documented `sleep(45000)` stand-in that doesn't call it. Wiring
  these together is new functionality on real hardware, not a refactor —
  out of scope here.
- **Backend connection-lifecycle unification** (§2.2) and the
  move-confirmation-polling/URScript-socket "duplication" (turned out not
  to be true duplication on close reading — see `REFACTOR_PLAN.md` Phase D).
- **The safety-plane triplication** across `main.py`,
  `ros2_ws/.../move_node.py`, and `position-picker/constants.ts` (a
  non-enforcing frontend placeholder) — not consolidated; `ros2_ws` is
  outside this pass's tested surface.
- **Phase F (splitting the largest files)** — `PipelineBuilder.tsx`'s
  `runPipeline`/`testRunSteps` extraction into a `usePipelineRunner` hook,
  and `pipelineUtils.ts`'s split along its section comments — identified
  and scoped in `REFACTOR_PLAN.md` but deferred: it would mean re-touching
  the exact state machinery just carefully verified in §4.2, for a payoff
  that's mostly file-length rather than correctness or extensibility.
- **`StepMonitorCard.tsx`/`HistoryStepMonitor.tsx` unification** (§4.4) —
  the most valuable remaining follow-up, requiring a real design (a shared
  intermediate shape for live and historical step state), not a mechanical
  extraction.

## 9. Open questions for the repo owner

Carried over from `REFACTOR_PLAN.md` §7 — none of these were resolved
unilaterally:

1. Keep the legacy job-pipeline vertical linked/relinked, or remove it
   (code + tables) entirely?
2. Wire the Robotiq gripper's real endpoint into `cycleGripper`, or keep it
   simulated until there's a plan to validate it against real hardware?
3. Revert the robot safety-plane values and the loop-minimum-1 override to
   their pre-testing state, or are they now the intended values?
4. Consolidate the safety-plane limits (currently independently defined in
   `main.py`, the ROS 2 node, and the frontend placeholder) into one source
   of truth?
