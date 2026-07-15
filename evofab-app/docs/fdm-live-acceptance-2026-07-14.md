# FDM live acceptance — 2026-07-14

## Scope and safety

- Printer: FDM Printer at `10.247.137.89`.
- William provided in-person supervision with access to the physical stop.
- All uploads used upload-only behavior (`print=false`); starts were separate explicit POSTs.
- No `print/start` call was made during upload.
- Every state-changing printer command was announced before dispatch.
- No secret or API key was used or recorded; the host is a Moonraker trusted client.

## Merged implementation

- Initial Part B slicer: PR #4, main `ed9ca1d927b37dd72d414c8a0051c076ded3f1b0`.
- Initial Part B dashboard: PR #29, main `bd5bfbc2a8c6ae9e2dffbb8879122dd4692815c0`.
- Production bed geometry: slicer PR #5, main `bfade9c6843911fe1adcb3cc20ad4d3cc83acdb0`.
- Moonraker terminal outcomes: dashboard PR #30, main `a4347a09ce48e4e350d9cb7917606973fdba2b45`.
- Ignore stale terminal states for queued jobs: dashboard PR #31, main `03237e979d282df95c2c9bb4788d091316b334b5`.
- Pressure-advance smooth-time compatibility: slicer PR #6, main `c66b7a53b3327dd82306e05e6bb9c0332b003f52`.
- Production extruder target: slicer PR #7, main `779a6084dbab80098bc54e4d88e034e83132a125`.
- Production startup thermal contract: slicer PR #8, main `2926fb94f6826e8da4a5b786560ed40d8c206171`.
- All merges were normal merges after green required checks. No admin override or check bypass was used.

## Verification gates

- Production-host slicer suite: 33 passed, including two real-engine tests; Ruff format and lint passed.
- Final normalized OrcaSlicer 3.0.1 x86_64 golden SHA-256:
  `fb09c56d4c5a93e2bea3c959b50d8585c6b9dfb40e2f26ee91c86004e58510c1`.
- Dashboard suite: 127 passed; typecheck and production build passed.
- Slicer GitHub mock CI runs passed. The `engine-linux` job was skipped and remains an open CI coverage gap.
- Dashboard GitHub Actions runs passed.

## Live discovery and corrections

All unsuccessful starts below auto-cancelled before model deposition. Their terminal evidence showed
`print_duration=0` and `filament_used=0`.

1. A stale pre-Part-B dashboard process on port 3000 ignored upload-only semantics and started an
   uploaded file. A pause and then cancel were each dispatched once; timeout outcomes were not retried.
   Moonraker later reconciled the cancellation. Port 3000 PID 40748 could not be terminated without
   elevation. Acceptance was isolated to the merged dashboard on port 3001.
2. Inherited `1000x1000` slicer geometry produced KAMP bounds `490..500`, outside the printer mesh.
   The preset was corrected to the registered 152.4 mm build volume; the real G-code object center is
   now `76.2,76.2` with polygon bounds `66.2..86.2`.
3. The status worker initially interpreted stale Moonraker `cancelled` state as belonging to newly
   uploaded queued jobs. Terminal reconciliation is now restricted to jobs already printing.
4. The Generic PLA chain emitted `SMOOTH_TIME=0.5`, above this Klipper configuration's `0.2` maximum.
   The preset and real-engine assertion now cap all emitted values at `0.2`.
5. The inherited feeder target was `mixing_stepper`, but the printer exposes only `extruder`. The preset
   now emits only `EXTRUDER=extruder`, with every emitted rotation distance validated as `456`.
6. The printer's actual `START_PRINT` macro ignores slicer temperature parameters. The preset now blocks
   on bed temperature before calibration and blocks on nozzle temperature after `START_PRINT`, before the
   first extrusion. The real-engine test asserts this ordering.
7. William reported seeing physical trip code 106 after an auto-cancelled attempt. He cleared it and
   ran auto-home. Subsequent read-only evidence showed `ready`, heaters off, and `xyz` homed. The meaning
   of code 106 was not inferred from this observation.

## Successful natural-completion evidence

- Dashboard job: `6834a7ca-802a-4afc-a9d7-c99369413266`.
- Slicer job: `32d92ab5-db7f-4449-8eab-4f81f798eb7a`.
- Moonraker history job: `000024`.
- File: `slice-32d92ab5-db7f-4449-8eab-4f81f798eb7a.gcode`.
- Uploaded size: 109,350 bytes; Moonraker file-list verification passed.
- Raw G-code SHA-256: `61d3aaa4644f774bc1fd4f5675be76fef54fc0fb9adf06cf346c39819b3144c8`.
- Engine/profile: OrcaSlicer 3.0.1, `pla-fdm`, Generic PLA preset chain,
  `profile_placeholder=false`, `resolved_profile=null`.
- Metadata: 16 layers, 20 mm cube, 819 s estimated print time, 220 C first-layer nozzle,
  50 C first-layer bed.
- Moonraker status: `completed`; progress `1.0`; terminal layer readout `15/16`.
- Moonraker start time: Unix `1784050209.0346794`.
- Moonraker end time: Unix `1784051239.9197383`.
- Total duration: 1030.997 s; model print duration: 818.764 s.
- Filament counter: 14,173.131; slicer metadata filament total: 14,133.13 mm / 17.38 g.
- Dashboard `started_at`: `2026-07-14T17:30:08.617Z`.
- Dashboard `completed_at`: `2026-07-14T17:47:19.658Z`.
- Completion detection lag from Moonraker end time: 0.658 s.

## Pause/resume and operator safety evidence

- A second supervised print used dashboard job `546de89a-b69e-4bdb-9e33-d26aa6ee3ce7` and the same
  verified Generic PLA G-code. At layer `2/16`, the announced dashboard pause request returned HTTP 504.
  It was not retried. Direct Moonraker reconciliation confirmed `state=paused`, `is_paused=true`, layer
  `3/16`, progress `38.9%`, and a parked toolhead position near `[-2,-1,9.37]`.
- The announced single resume request returned `ok=true`, `outcome=succeeded`. Direct Moonraker evidence
  confirmed `state=printing`, `is_paused=false`, layer `3/16`, and advancing file progress.
- William then reported that the physical result was not printing on the bed. An additional announced
  direct `PAUSE` was issued as an operator safety action. Moonraker confirmed paused at layer `4/16`,
  progress `43.3%`, with the toolhead parked near `[-2,-1,11.23]`. No unapproved resume followed.

## Status-worker lifecycle incident and prevention

- Multiple detached S4U status-worker descendants survived scheduled-task restarts. They wrote to the
  same log with independent tick counters and applied stale terminal printer telemetry to newer queued
  jobs. This caused uploads to become `aborted` within seconds and to inherit the prior job's layer data.
- The historical incident records remain unchanged as evidence: `81ee3e32-d5c4-4f7e-9976-50ffa29510d9`,
  `4fcc70e3-5d57-46e4-8da1-c9445fc74bd7`, `1c5e880d-ec1a-46ca-b937-ef63dd9338b7`,
  `dbbb67cb-7b98-4ff3-8fa1-894b2aae4fcb`, and `0a396e96-15cc-40c2-9e03-9e2d2e277d43`.
  No database rewrite was performed.
- The 3070 host was rebooted to remove the legacy descendants. After reboot, both scheduled tasks were
  Running, the dashboard returned HTTP 200 locally and at `100.99.172.25:3000`, the slicer health endpoint
  returned HTTP 200, and exactly one status worker owned singleton port `127.0.0.1:32147`.
- The tested prevention changes are filename-correlated Moonraker reconciliation for queued jobs, an
  OS-managed singleton worker lock with safe fallback, and a non-detaching Windows launcher. They remain
  subject to the fresh upload-only regression below until committed and merged.

## Post-reboot natural completion evidence

- Moonraker completed the 209,724-byte file
  `b4b3204c-fcb8-4d1e-be82-ae4ffb9d4ee3.gcode` naturally after reboot.
- Final Moonraker evidence: `state=complete`, virtual-SD progress `1.0`, inactive virtual SD, terminal
  layer readout `15/16`, total duration `1003.977 s`, model print duration `829.162 s`, and filament
  counter `14295.072`.
- The associated dashboard record `0a396e96-15cc-40c2-9e03-9e2d2e277d43` was already historically
  corrupted before reboot, so the corrected worker intentionally did not rewrite that terminal record.

## Acceptance status and open items

- Live acceptance is achieved: slice, upload, confirmation, explicit start, pause, resume, and natural
  completion have all been exercised on `.89` with announced state-changing commands.
- The post-merge upload-only regression passed on 2026-07-15. With `.89` idle and cool, the announced
  `SDCARD_RESET_FILE` command returned the printer to `standby` with an inactive virtual SD and both heater
  targets at zero. Slicer job `71d15296-4ed5-4dd3-8d70-e68315350fb3` was uploaded with `print=false` and
  created dashboard job `e430f42c-ca87-471d-a760-80f86fa1df6c`.
- Moonraker listed the nested 209,724-byte file
  `slice-71d15296-4ed5-4dd3-8d70-e68315350fb3.gcode/slice-71d15296-4ed5-4dd3-8d70-e68315350fb3.gcode`.
  Its read-back SHA-256 matched the source checksum exactly:
  `958ad518dcac14ec2df4cb870f240efacd0b484d5b1af8a81a6971d6a4135a43`.
- Across five observed status-worker polls, the job remained `queued` with `last_command=upload`,
  `command_outcome=succeeded`, null current/total layers, Moonraker `standby`, and inactive virtual SD.
  No print/start call was made.
- The oversized incident status-worker log must be archived outside the repository. Log rotation and
  PID-stamped log lines are follow-up work, not part of this acceptance change.
- `.21` is intentionally powered off. Its timeout/backoff is expected and must be re-verified only when
  it is powered on.
- Add a non-skipped real-engine CI job. Current real-engine authority is the production x86_64 host.
