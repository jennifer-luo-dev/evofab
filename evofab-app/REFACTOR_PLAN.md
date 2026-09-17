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

### Phase E — The core ask: a real "machine module" abstraction for Pipelines

This is what objective 2 is actually about, and the highest-value, most
involved change. Today, adding one new machine action means touching ~10-13
places (`stepExecutors.ts`'s `STEP_EXECUTORS` map and its own per-action
if-chain, `PipelineBuilder.tsx`'s `RUNNING_KIND_BY_TECH` map + per-tech
`useState`, `StepMonitorCard.tsx`'s per-tech monitor + `running.kind` switch,
`ContainerView.tsx`'s `STOPPABLE_TECHS` map, `icons.tsx`'s
`MACHINE_TYPE_ICONS` map, `StepDraftForm.tsx`'s per-tech boolean+block, and a
second, independent copy of the monitor dispatch in `HistoryStepMonitor.tsx`
for History).

Plan: introduce one `PipelineTechModule` interface —

```ts
interface PipelineTechModule {
  tech: TechKey
  icon: ComponentType
  stoppable: boolean
  executor: StepExecutor
  MonitorPanel: ComponentType<{ running: RunningState }>       // "now running" (builder)
  HistoryMonitorPanel: ComponentType<{ liveStep: LiveStep }>   // "now running" (history, read-only)
  formExtras?: ComponentType<StepDraftFormExtrasProps>          // e.g. printer settings panel, robot move modal
}
```

— and one registry, `PIPELINE_TECH_MODULES: Record<TechKey, PipelineTechModule>`,
built by migrating each tech's existing executor/monitor/history-monitor/
icon/stoppable-flag/form-extra **verbatim** into its module (moving code, not
rewriting logic), one tech at a time (`printer`, then `robot_arm`, then
`arduino_board`, then `camera`, then `classification_model`), each migration
its own commit. After each tech's migration:
- `tsc --noEmit` must pass.
- Manually trace that tech's pipeline step end-to-end in the running dev
  server (build a one-step pipeline in the builder, run it, confirm the
  monitor panel renders identically, confirm History shows the same replay).
- Only after all five techs are migrated do the old scattered maps
  (`RUNNING_KIND_BY_TECH`, `STOPPABLE_TECHS`, `MACHINE_TYPE_ICONS`, the
  `StepMonitorCard`/`HistoryStepMonitor` per-tech switches) get deleted, so
  there's no window where both old and new systems partially disagree.

This directly fixes the "shotgun surgery" problem the audit identified:
adding a new machine tech afterward means writing one `PipelineTechModule`
object and adding one entry to the registry — nothing else.

**Not** touching in this phase: the underlying `Step`/`StepDraft` data model
(`types.ts`) beyond what's needed to type the registry — it's schema-driven
already for input fields, and the audit didn't find it broken, just
under-leveraged.

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
- [ ] Phase B
- [ ] Phase C
- [ ] Phase D
- [ ] Phase E
- [ ] Phase F
- [ ] Phase G
- [ ] Phase H

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
