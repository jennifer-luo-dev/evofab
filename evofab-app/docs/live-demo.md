# Phase H Live Demo Runbook

This runbook is for William's supervised hardware bring-up of printer H on the
Tufts lab network. The Vercel preview cannot reach LAN printers; run this demo
from William's Mac while connected to the lab network.

Printer H:

- Moonraker URL: `http://10.247.137.21:7125`
- Onboarding IP: `10.247.137.21`
- Onboarding port: `7125`

## 1. Environment

Set these values in the local shell or `.env.local` used by the dashboard:

```bash
MOONRAKER_MODE=hardware
HARDWARE_CONFIRMATION=I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE
STATUS_POLL_INTERVAL_MS=2000

SLICER_MODE=real
SLICER_URL=http://localhost:8055
SLICER_TOKEN=<shared bearer token>
```

When these values are saved in `.env.local`, keep each assignment on its own
line with no trailing shell continuation backslashes. A value such as
`MOONRAKER_MODE=hardware \` is parsed literally and will not match the required
`hardware` mode string.

Keep `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` configured for William's Supabase project. The
status worker needs the service-role key because it writes `printer_status`.

## 2. Start Order

1. Start the slicer service.
   - Expected evidence: `GET $SLICER_URL/health` reports healthy.
   - Abort if: the service is down, token auth fails, or slicing cannot produce
     G-code in real mode.
2. Start the status worker from `evofab-app`.

   ```bash
   npm run status:worker
   ```

   - Expected evidence: JSON logs with `event=status-worker.tick`, printer
     count, upsert count, and per-printer results.
   - Abort if: any real printer poll runs without `MOONRAKER_MODE=hardware` and
     the exact hardware confirmation string above.

3. Start the dashboard from `evofab-app`.

   ```bash
   npm run dev
   ```

   - Expected evidence: the app opens at `http://localhost:3000`.
   - Abort if: the app cannot load printer data from Supabase.

## 3. Onboard Printer H

1. Open `/printers`.
2. Enter printer H:
   - Name: `Printer H`
   - Model: the label William wants shown in the fleet
   - Type: `FDM` or `FGF`, matching the actual machine
   - Moonraker IP: `10.247.137.21`
   - Port: `7125`
3. Press `Test connection`.
   - Expected evidence: the form reports the Moonraker version, Klipper version
     when reported by `/server/info`, and Klippy state.
   - Abort if: the result is `MOONRAKER_TIMEOUT`, `MOONRAKER_OFFLINE`,
     `HARDWARE_CONFIRMATION_REQUIRED`, `UNSAFE_MOCK_URL`, or malformed.
4. Press `Add Printer`.
   - Expected evidence: printer H appears in the `/printers` fleet and receives
     a `printer_status` row.
   - Abort if: the printer cannot be created or its initial status row cannot be
     written.

## 4. Verification Ladder

William performs every hardware action at the printer. Codex does not send
print, motion, heater, macro, or e-stop commands directly.

### Step 1: Read-Only Live Status

1. Keep `npm run status:worker` running.
2. Open `/printers` and a live `/monitor/<jobId>` page when a job is available.
3. Confirm hotend and bed temperatures update within one poll interval.

Expected evidence:

- Worker logs show successful polls for printer H.
- `/printers` shows printer H online with real temperatures.
- The monitor temperature chart shows live hotend and bed values.

Abort criteria:

- Status stays stale or offline for more than 30 seconds while Moonraker is
  reachable.
- Temperatures are impossible, missing, or mapped to the wrong field.
- Worker logs show repeated `MOONRAKER_TIMEOUT`, `MOONRAKER_OFFLINE`, or
  malformed responses.

Stop-worker evidence:

- Stop `npm run status:worker`.
- Expected evidence: the dashboard synthesizes printer H as offline after about
  30 seconds through the existing stale-status path.

### Step 2: Software E-Stop And Guarded Recovery

1. From `/printers`, trigger software e-stop.
2. From `/monitor/<jobId>`, trigger software e-stop.
3. From the third page that exposes print control, trigger software e-stop.
4. Recover with the guarded `FIRMWARE_RESTART` flow by typing the required
   confirmation.

Expected evidence:

- Each e-stop path puts Klipper into an error or shutdown state.
- The dashboard shows the fault message and MCU when Moonraker reports them.
- Recovery is blocked until the exact `FIRMWARE_RESTART` confirmation is typed.
- After recovery, status returns to idle or ready.

Abort criteria:

- Any e-stop button does nothing.
- Recovery can run without the guard text.
- Fault details disappear before William records them.
- Klipper does not return to a safe idle/ready state.

### Step 3: Gated Motion

1. Home the machine from the dashboard.
2. Jog one axis by 10 mm.
3. Apply one babystep within the configured clamp.
4. Confirm cold extrusion is blocked while the hotend is below the extrusion
   temperature threshold.

Expected evidence:

- Homing completes and the UI remains responsive.
- The 10 mm jog moves only the requested axis by the requested distance.
- Babystep accepts only an in-range adjustment.
- Cold extrusion returns the guard error and sends no extrusion move.

Abort criteria:

- Motion occurs on the wrong axis or by the wrong distance.
- Any clamp is bypassed.
- Cold extrusion is allowed while the hotend is cold.
- William sees unexpected mechanical noise, binding, or unsafe motion.

### Step 4: Preheat Preset And Cooldown

1. Choose the material preset William wants for the demo.
2. Apply preheat.
3. Observe hotend and bed temperatures rising toward targets.
4. Trigger cooldown.

Expected evidence:

- Dashboard target temperatures match the selected material profile.
- Live status shows actual temperatures moving toward targets.
- Cooldown sets hotend and bed targets back to zero.

Abort criteria:

- Targets do not match the selected profile.
- Temperatures rise unexpectedly beyond requested targets.
- Cooldown does not clear heater targets.

### Step 5: Short Supervised Print

1. Upload the demo STL.
2. Inspect it, select printer H, and confirm the build-volume precheck passes.
3. Slice with the real slicer service.
4. Start the print from the dashboard while William supervises the printer.
5. During the print, perform one runtime-override spot check within allowed
   ranges.

Expected evidence:

- Real slicer returns G-code with honest time, material, and layer metadata.
- Moonraker receives the uploaded G-code and starts the selected file.
- Dashboard progress and layer display track the print instead of mock progress.
- Runtime override reaches Moonraker and the dashboard remains within clamps.
- The print completes or is intentionally canceled by William.

Abort criteria:

- The precheck reports the model does not fit printer H.
- Slicer service fails or returns malformed G-code.
- Progress or layer evidence is clearly synthetic during hardware mode.
- Runtime override violates a clamp or produces unsafe printer behavior.
- William chooses to stop the print for any physical safety reason.

### Step 6: Phase J Real-Slicer Prepare Flow

Run this ladder on the M4 Mac with the real slicer service started before the
dashboard:

```bash
cd /Users/xliu16/Documents/evofab-slicer
SLICER_TOKEN=<shared bearer token> SLICER_MODE=real uvicorn app.main:app --host localhost --port 8055
```

Keep the dashboard environment pointed at the local slicer:

```bash
SLICER_MODE=real
SLICER_URL=http://localhost:8055
SLICER_TOKEN=<shared bearer token>
```

1. Upload the asymmetric fixture in `/cloud-slicer`, open Orientation, pick a
   non-default ranked face, then slice.
   - Expected evidence: the scene animates/rests the picked face on the bed,
     the prepare summary labels the state as user-picked, and layer 1 in the
     G-code preview lies on the selected face.
   - Abort if: any code path silently reorients the part, the selected face does
     not become the first layer, or the error message lacks a remedy.
2. Upload the T fixture twice: once with supports off and once with supports on.
   - Expected evidence: supports-off G-code has no support feature paths;
     supports-on G-code shows support toolpaths in the support legend color.
   - Abort if: supports appear when disabled, disappear when enabled, or the
     preview crashes on either result.
3. Confirm real result metadata.
   - Expected evidence: print time, material usage, layer count, preview header,
     and pre-print summary all match the completed slicer job result, not a UI
     placeholder.
   - Abort if: any displayed result value is hardcoded, missing while present in
     the job result, or inconsistent with the downloaded G-code.
4. Confirm the uploaded-STL canvas visual check.
   - Expected evidence: after upload, the select-STL surface is replaced by the
     build-plate scene; orbit, zoom, and pan work; Reset restores uploaded pose;
     a replacement upload swaps the part without returning to stale geometry.
   - Abort if: the model is visibly wrong scale, below the bed, floating above
     the bed after drop-to-bed, or overlapping unrelated UI.

## 5. Read-Only Probe Policy

Codex may run these read-only probes only after William gives explicit
in-session go-ahead:

```bash
curl --fail --silent --show-error http://10.247.137.21:7125/server/info
curl --fail --silent --show-error "http://10.247.137.21:7125/printer/objects/query?webhooks&print_stats&extruder&heater_bed&virtual_sdcard"
```

Codex must never send state-changing calls directly, including print start,
motion, heaters, macros, recovery, or e-stop. William performs all hardware
steps from the UI while physically supervising the printer.

## 6. Evidence To Record

For the implementation log, record:

- Commit SHA for each work item.
- Gate results after each work item and at final verification.
- Printer H connection-test result and versions shown.
- Worker tick evidence for live online status.
- The time the worker was stopped and the time the dashboard showed offline.
- Each verification ladder step completed, result, and abort reason if stopped.
- Any divergence from this runbook or the implementation plan.
