# EvoFab Modularity Refactor — Plan

Status: in progress. This document is written before execution and updated as
phases complete, per the working agreement for this pass (full-codebase audit
+ incremental, self-managed refactor with a hard "don't break behavior"
constraint). Progress notes are appended to each phase's section as it lands.

## 0. How this plan was built

Four parallel research passes read every file in `app/api/python/`, `app/lib/`
+ `app/types/` + `app/contexts/`, `app/components/pipelines/`, and everything
else (remaining component dirs, all TS API routes, `supabase/schema.sql`,
`arduino/`, `ros2_ws/`, root config). Their findings are the basis for the
phases below. Nothing here is guesswork about what the code does — it was
read in full first.

## 1. Hard constraints (do not violate)

These come from `CONTRIBUTING.md`, the codebase's own documented conventions,
and explicit decisions made with the repo owner before starting:

- **No behavior change to any hardware-facing contract.** Every API route's
  status codes, response JSON shapes, and error-message text stay exactly as
  they are. The frontend has no test suite to catch a subtle contract drift,
  and this app drives a real robot arm — a silent behavior change here is the
  one category of "cleanup" that could hurt someone or break a part.
- **`evofab-app/supabase/` is off-limits.** Per `CONTRIBUTING.md`: "coordinate
  with the repo owner before changing." No schema/migration edits in this
  pass, even for tables the audit found undocumented (see §3.6).
- **Two known "temporary test state" spots stay exactly as they are, on
  explicit instruction, not my inference:**
  1. `app/api/python/main.py`'s `_SAFETY_PLANES` — the east-wall margin
     (500mm, was 250mm) and table-collision margin (1m, was 25mm) stay
     loosened, and the pending diff that removes their "temporary, revert
     after testing" comments is left as-is. **I will not touch this file's
     safety-plane values or comments in this pass.**
  2. The loop-iteration-minimum-of-1 override (`usePipelineBuilder.ts:250`,
     `LoopBlock.tsx:99`, `InlineCountPrompt.tsx:19`, all sharing the same
     stale "temp change for testing... revert after" comment) stays exactly
     as-is — value and comments both untouched.
  Both are called out explicitly in §7 so a future pass knows they were seen
  and deliberately left alone, not missed.
- **The legacy job-pipeline vertical stays.** `app/setup/`, `app/monitor/`,
  `app/results/`, their components, their API routes (`jobs`, `jobs/[id]`,
  `jobs/[id]/logs`, `results`, `print`, `print/pause`, `printers`,
  `print-profiles`), and the Supabase tables they use (`jobs`, `logs`,
  `results`, `experiments`, `material_profiles`, `printers`,
  `printer_status`) are fully functional but unlinked from `NavTabs`. This
  is ambiguous enough (working code + real data, just not nav-linked) that
  deleting it is not a safe unilateral call — conservative choice is to
  leave it running, reachable by URL, and documented as such (§7). Not
  touched beyond incidental shared-helper extraction that also happens to
  be imported there (verified case-by-case).
- **No restructuring of hardware connection-ownership models.** The robot's
  background RTDE thread, the Arduino's persistent serial thread, and the
  camera's separate rooted process are each shaped by real constraints
  specific to that hardware (RTDE needs a continuous reader; the camera
  needs root and its own venv; the Arduino needs a single persistent serial
  handle). Audit found these "inconsistent," but the inconsistency is
  largely load-bearing, not accidental. This pass unifies the *shape* of
  error handling/logging/result types around these, not the connection
  lifecycle itself.
- **The UR7e Robotiq gripper stays simulated.** `stepExecutors.ts`'s
  `cycleGripper` is a documented `sleep(45000)` stand-in; `main.py` already
  has a real `/robot/gripper` route it doesn't call. Wiring that up is a
  functional change (new behavior on real hardware), not a refactor, and is
  out of scope here — noted for the repo owner in §7.
- **`ros2_ws/` and `arduino/` firmware are read-only for this pass.** They're
  outside `evofab-app/`, not part of the primary runtime path per the root
  README ("used alongside or as an alternative to the direct RTDE control
  path"), and I have no way to test firmware/ROS changes. Documented, not
  touched.

## 2. Branch / commit strategy

Continuing on the current branch, `interface-restructure` (already a
restructuring branch, not `main`). Work lands as a series of small commits,
each independently buildable/type-checkable, using this repo's
`type:`-prefixed commit convention from `CONTRIBUTING.md`
(`refactor:`/`chore:`/`fix:`/`docs:`). Not pushed or opened as a PR unless
asked. Two pre-existing uncommitted changes on this branch
(`main.py`'s comment deletions, `NavTabs.tsx`'s dead-tab-comment cleanup) are
left as the user's own in-progress work; I may build on top of them but won't
re-author or squash them myself.

## 3. Phases

### Phase A — Mechanical, zero-risk cleanup

Dead code / unused symbols / stale comments only; nothing here changes any
runtime behavior, so verification is "it still builds and lints."

- Remove dead exports: `capturePhoto` (`app/lib/camera.ts`), demote
  `MOONRAKER_STATE_MAP` to non-exported (only used internally).
- Remove the duplicate top-level `import platform` in `main.py` (a local
  `import platform` inside `_find_arduino_port` already covers its one use).
- Delete stale comments in `main.py` / `camera_orbbec_service.py` that
  reference files no longer in the repo (`camera_manager.py`,
  `get_orbbec_serial.py`) — replace with a one-line factual note only where
  the surrounding context needs it (e.g. why the camera is a separate
  process), not a wholesale comment purge.
- Resolve the stale "remove once confirmed" diagnostic header comment in
  `camera_orbbec_service.py:185-187` — since the header (`X-Frame-Timestamp-Ms`)
  is still actively relied on for staleness checks per the audit, keep the
  header but replace the comment with an accurate one (it's load-bearing
  now, not temporary).
- Remove unused Python deps from `requirements.txt`: `scipy`,
  `pyobjc-framework-AVFoundation` (confirmed zero imports; the latter is a
  leftover from the retired AVFoundation-based camera implementation).
- Remove unused npm deps from `package.json`: `express`, `cors`, `fastapi`
  (confirmed zero imports in `app/`; these were never used — `fastapi` in
  particular is a red herring npm package name, unrelated to the real Python
  FastAPI framework).
- Rename `app/actuation-test/page.tsx`'s locally-defined `firePulse` (name
  collision with `app/lib/arduino.ts`'s real hardware client, unrelated
  function) to something unambiguous.
- Fix stale doc claim in `evofab-app/README.md` ("there is no separate
  camera-test page") now that `app/camera-test/page.tsx` exists as its own
  linked route.
- Confirm `exports/` is gitignored (it's output data, not source).

### Phase B — Shared HTTP-client helpers (frontend `lib/`)

Every one of `arduino.ts`, `camera.ts`, `classification.ts`, `moonraker.ts`,
`robot.ts` re-implements the same 3-line `base(ip, port)` helper and the same
`if (!res.ok) throw new Error(...)` shape. Extract one shared module
(`app/lib/bridgeClient.ts`) with `bridgeUrl(ip, port, path)` and a
`fetchBridge`/`throwIfNotOk` helper, then have all five files use it.
**No change to what gets sent or what errors say** — this is a pure
de-duplication, verified by diffing request URLs and error message text
before/after for every call site.

### Phase C — Shared machine-lookup + bridge-call helpers (API routes)

`actuate`, `camera-capture`, `classify`, `robot-move`, `robot-stop`, `print`,
`print/pause` each re-implement: look up a `machines` row, 404 if missing,
fall back to a per-route `DEFAULT_*_PORT` constant, try/catch the bridge call
into a 502. Extract `resolveMachine()` and a small `withBridgeErrorMapping()`
wrapper into `app/lib/machineRouting.ts`. Each route's exact status codes and
JSON error shape are preserved byte-for-byte — this phase is reviewed by
re-reading each route's diff against its pre-refactor behavior line by line,
since there's no test suite to catch a regression here automatically.

### Phase D — Backend Python internal de-duplication (`main.py`)

**Revised down after reading the three "duplicated" call sites in full** —
what looked like straightforward extractions from the audit summary turned
out to have real, load-bearing differences once read closely:

- The move-confirmation polling loop in `_execute_cartesian_move` (TCP-speed
  based) vs. `_execute_joint_move` (joint-speed based) look structurally
  identical, but this is real robot-motion-completion detection with no
  automated test coverage and no way for me to verify against the physical
  UR7e in this pass. The risk of a transcription mistake silently changing
  how "move finished" is detected — on a real robot arm — outweighs the
  ~25-line savings. **Not done.**
- The "open a socket to port 30002, send URScript, close" pattern
  (`_execute_cartesian_move`, `_execute_joint_move`, `_execute_robot_stop`)
  is **not actually the same pattern**: `_execute_robot_stop` uses a 3s
  socket timeout with its own `except OSError` returning a specific
  `{ok: False, error: "Could not reach robot: ..."}", while the two move
  functions use a 5s timeout with no dedicated socket-error handling (errors
  fall through to their outer `except Exception`). The tighter e-stop
  timeout looks deliberate (an e-stop should fail fast), not an oversight.
  Unifying these risks changing real e-stop responsiveness. **Not done.**
- The repeated `try: import rtde_receive / except ImportError` guard is two
  lines at three call sites; Python's per-function lazy-import idiom doesn't
  factor cleanly into a shared helper without returning module objects back
  to the caller, which adds indirection for no real gain. **Not done.**

What **was** done, since it's strictly additive (changes only what appears
in server logs, never an HTTP response, so it can't violate the
behavior-preservation constraint):
- Added `logging.getLogger(__name__)` and real `logger.warning(...)` calls
  at the four spots that previously failed completely silently — the RTDE
  reader's connection-loss handler, the Arduino serial reader's open-failure
  and drop handlers, and `/classify`'s fallback-to-NO_TARGET handler (which
  replaces its one bare `print()`). Every other `except` in the file already
  surfaces its error through a return value/response and was left alone.
- CORS middleware config duplication (`main.py` / `camera_orbbec_service.py`)
  intentionally **not** deduplicated — these are two independently-run
  processes, and importing a shared module between them to save a 10-line
  list isn't worth the coupling.

Also explicitly **not** doing: unifying the three internal error-shape
conventions (dict-with-status / bool-tuple / bare-exception) — each is
coupled to how its specific route already responds to the frontend, so
"fixing" it internally without touching the wire shape is high-effort for
low value, especially with the higher-value extractions above ruled out.

### Phase E — A real "machine module" abstraction for Pipelines

**Revised down from the original full `PipelineTechModule` design below**,
after reading `PipelineBuilder.tsx`'s actual state wiring in full. The
original plan called for one registry object per tech bundling executor +
icon + stoppable flag + a live monitor component + a history monitor
component + form extras, replacing four scattered maps/switches in one pass.
Reading the code turned up a real, load-bearing behavior the naive version
would have broken: `runningPrinter`/`runningRobot`/`runningCamera`/
`runningClassification` aren't four redundant copies of the same thing —
**more than one can be non-null at once**, and the JSX renders all of them
simultaneously (`{runningPrinter && ...} {runningRobot && ...} ...`). That's
what lets a synced batch spanning two techs (e.g. a robot move synced with a
camera capture) show two "Now Running" panels side by side. A first-draft
"collapse to one `runningStep` state" design (the obvious simplification)
would have silently dropped that for any future synced multi-tech batch —
exactly the kind of subtle regression this pass is supposed to avoid, so it
was caught by tracing before being written, not after.

**What shipped instead — a generalization, not a collapse:**

- `StepExecutorContext.setRunningPrinter/setRunningRobot/setRunningCamera/
  setRunningClassification` (four named setters) → one
  `setRunningStep: (tech: TechKey, state: SetStateAction<RunningStepState | null>) => void`.
  Every executor now calls `ctx.setRunningStep(step.tech, ...)` instead of a
  tech-specific setter — a new tech's executor needs **zero**
  `StepExecutorContext` changes to show its own live panel.
- `PipelineBuilder`'s four `useState<RunningXState | null>` → one
  `runningSteps: Partial<Record<TechKey, RunningStepState>>`, with a
  `setRunningStep` helper that preserves each tech's exact functional-update
  semantics (keyed by tech, so `setRunningStep('printer', (prev) => ...)`
  only ever touches the `'printer'` entry).
- The `RUNNING_KIND_BY_TECH` translation map is gone entirely — the registry
  is keyed by `Step.tech` directly now, so there's no separate "kind" concept
  to keep in sync with it.
- The batch-clear logic in `runPipeline` (keep entries for techs in this
  batch, drop everything else) and in `testRunSteps` (keep only the current
  step's own tech) are now a loop over `Object.keys(runningSteps)` instead of
  four hardcoded `if`s each — this is the part verified most carefully, since
  it's exactly where the simultaneous-panel behavior lives. Confirmed
  unchanged both by re-deriving the loop from the original four-`if` logic
  step by step, and by a live browser test (`npm run dev:web` + Playwright,
  since `chromium-cli` wasn't available in this environment): built a
  Camera step, Test-Ran it, and confirmed the "Now Running" / "capturing…"
  panel renders exactly as before via the new code path (screenshotted). A
  second test synced a Camera + Classification Model step and ran the real
  Run Pipeline path to exercise the `Promise.all`-batched dispatch — both
  steps did start concurrently (confirmed via the thrown errors' call
  stacks), though that specific pairing isn't a realistic one to sync (the
  classification step needs the camera step's *output*, so syncing them
  simultaneously starves it of a source photo — a pre-existing modeling
  question independent of this refactor, not something it caused). A test
  pipeline row created during this was deleted afterward via History's own
  delete control — verified only that row was removed, all real run history
  intact.
- `ContainerView.tsx`'s locally-defined `STOPPABLE_TECHS` (endpoint-only map,
  redefined every render) plus a separate `step.tech === 'printer'` special
  case for the Stop button's tooltip text → one shared
  `app/components/pipelines/stopHandling.ts` exporting `STOPPABLE_TECHS`
  (now `{ endpoint, label }` per tech) and `NOT_STOPPABLE_LABEL`. This also
  fixes a latent bug the old code had: a third stoppable tech would have
  silently inherited robot_arm's "Emergency-stop the arm" tooltip text
  instead of its own.

**Deliberately not done in this pass** (each is a separate, real design
decision rather than a mechanical extraction, and none blocks the above):
- **`MACHINE_TYPE_ICONS`** (`icons.tsx`) stays where it is — it's already one
  central map, not scattered, and folding it into a bigger registry would
  mean importing icon components into a file that otherwise only has plain
  data, for no real reduction in touch points.
- **`StepDraftForm.tsx`'s per-tech `isPrinter`/`isRobotMove` extra-UI
  blocks** stay as-is — only 2 of 5 techs need bespoke form UI today: a
  registry with `formExtras?: Component` for exactly two non-null entries
  isn't a win over two `if`s, especially since it would add a new
  extension point to design and verify without owning any of the current
  duplication.
- **`StepMonitorCard.tsx` vs. `HistoryStepMonitor.tsx`** — the ~250-line
  near-duplicate live-vs-historical monitor rendering the audit flagged.
  These consume genuinely different shapes (`RunningStepState`, built from
  in-memory executor state, vs. `LiveStep`, reconstructed from polled DB
  rows in `app/api/pipelines/[id]/route.ts`) — unifying them means designing
  a shared intermediate shape both sides can produce, which is a real
  feature of follow-on work, not a refactor of what's there. Flagged as the
  natural next step in ARCHITECTURE.md rather than attempted here.
- **The underlying `Step`/`StepDraft` data model** (`types.ts`) — untouched
  beyond what the above already used; it's schema-driven for input fields
  already, and nothing here needed a data-model change.

The result: adding a new machine tech's live monitor panel today means (1) a
`Running<Tech>State` variant on the `RunningStepState` union, (2) a
`<XMonitor>` branch inside `StepMonitorCard`'s own dispatch, and (3) an
`ctx.setRunningStep(step.tech, ...)` call in its executor — no
`StepExecutorContext` change, no `PipelineBuilder` state change, no new
render line. That's the real reduction in "scattered files" this phase
delivers; the remaining touch points (`STEP_EXECUTORS` entry, an icon, a
stoppable-endpoint entry if applicable, `StepDraftForm` extras if needed, and
`HistoryStepMonitor`'s independent copy) are unchanged from before.

### Phase F — Split the largest files along the seams Phase E creates

Once Phase E exists, these follow naturally rather than needing their own
separate design:
- `PipelineBuilder.tsx` (652 lines): extract `usePipelineRunner` (the
  `runPipeline`/`testRunSteps`/`persistTree`/stop-handling logic, which
  overlaps ~90 lines between the "real run" and "test run" paths today) the
  same way `usePipelineBuilder` already owns the tree-editing state. Leaves
  `PipelineBuilder.tsx` as page layout + wiring.
- `pipelineUtils.ts` (541 lines): split along its existing section comments
  into `treeUtils.ts` (flatten/derive), `pipelineValidation.ts`
  (sync/repeat/step-output validation), `unroll.ts` (`unrollForExecution`,
  the most complex function in the directory, isolated on its own), and
  keep `pipelineUtils.ts` for `freshenRunIds`/summarization or rename it
  once it's smaller.
- `StepMonitorCard.tsx` vs `HistoryStepMonitor.tsx` duplication (~250 lines
  of near-identical JSX) collapses naturally once both read from the same
  `PipelineTechModule.MonitorPanel`/`HistoryMonitorPanel` — this is really a
  Phase E outcome, listed here because it's the concrete line-count payoff.
- `app/actuation-test/page.tsx` (588 lines) and `app/robot-test/page.tsx`
  (532 lines): split each into a page shell + a handful of already-obvious
  sub-components (e.g. actuation-test's pulse controls vs. its live camera
  preview vs. its capture-result panel). Lower priority — these are
  unlinked diagnostic pages, not on the critical path — done last, only if
  time remains after E is solid.

**Deferred.** Phase E's actual scope (see its revised section above) turned
out larger and more delicate than planned — the `usePipelineRunner`
extraction here would mean re-touching the exact `runPipeline`/`testRunSteps`
state machinery just carefully verified (including the simultaneous-panel
behavior), for a payoff that's mostly file-length rather than a correctness
or extensibility improvement. Given no test suite and no way to exercise a
real hardware run in this pass, doing that extraction with the same level of
care as Phase E would cost more than this plan's remaining budget justifies
against `pipelineUtils.ts`'s split and the two diagnostic pages, which are
lower-risk (pure functions / unlinked pages) but also lower-value. Left for
a follow-up pass — the seams are identified above and don't go stale.

### Phase G — Type consolidation

`TechKey` (`components/pipelines/types.ts`) and `MachineTypeKey`
(`components/ui/icons.tsx`) are two `= string` aliases for the same
underlying `machine_types.type_key` concept. Consolidate to one shared type
in `app/types/machine.ts` (new file, matching the existing
`app/types/{job,printer,result}.ts` convention) and update both files' import
sites. Since this is a private app (no external consumers of these types),
this is a straight rename with no compatibility shim needed — verified via
`tsc --noEmit`.

### Phase H — `ARCHITECTURE.md`

Written last, once the above has actually landed (so it documents reality,
not intent). Covers: final structure, the `PipelineTechModule` abstraction
and how to add a new machine/new step type end-to-end, environment setup
(consolidating and correcting the existing READMEs), and a changelog of what
moved/was removed and why, cross-referencing this file's §7.

## 4. Verification approach (no test suite exists yet)

- TypeScript: `npx tsc --noEmit` after every phase.
- Lint: `npm run lint` after every phase.
- Python: no test suite beyond `test_geometry.py` (unaffected by these
  changes) — `python -m pytest app/api/python` after Phase D regardless.
- Manual hardware-path tracing: for anything touching `app/api/python/` or
  `app/lib/*.ts`, re-read the full call chain (route → lib client → FastAPI
  endpoint → hardware call) before and after, confirming request
  shape/response shape are byte-identical.
- Browser verification: for Phase E/F, run `npm run dev:web` (backend not
  required for most of the builder/monitor UI to render, but will run
  `npm run dev` where a real pipeline run needs to be exercised against the
  FastAPI bridge) and manually drive the Pipelines builder for each tech.

## 5. Explicitly out of scope / left unchanged (see §1 and §7)

Tracked in one place (§1) rather than repeated per-phase.

## 6. Progress log

- [x] Phase A — commit `211d0fa`
- [x] Phase B
- [x] Phase C
- [x] Phase D (scaled down — see notes in Phase D above)
- [x] Phase E (revised down — see notes in Phase E above)
- [ ] Phase F — deferred; see note at the end of the Phase F section above
- [x] Phase G
- [ ] Phase H — in progress

## 7. Open items for the repo owner (not resolved by this pass)

- The legacy job-pipeline vertical (`setup`/`monitor`/`results`) — keep
  relinked into `NavTabs`, or remove entirely (code + tables)? Left running
  but unlinked, per §1.
- The Robotiq gripper has a real backend endpoint (`main.py`'s
  `POST /robot/gripper`) that the frontend's Pipelines `cycleGripper`
  executor doesn't call — it's still a `sleep(45000)` simulation. Wiring
  these together is a functional change, not attempted here.
- Robot safety-plane values in `main.py` and the triple-duplicated
  loop-minimum-1 override are both left exactly as found, on explicit
  instruction — see §1.
- The safety-plane limits are independently duplicated in three places
  (`main.py`, `ros2_ws/src/evofab_robot/evofab_robot/move_node.py`, and
  `position-picker/constants.ts`'s cosmetic frontend bounds). Not
  consolidated — `ros2_ws` is outside this pass's tested surface, and the
  frontend copy is explicitly a non-enforcing placeholder already.
