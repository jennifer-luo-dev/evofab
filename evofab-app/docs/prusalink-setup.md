# PrusaLink Fleet Phase 1 Operator Setup

This document provides setup and verification instructions for connecting EvoFab to PrusaLink-enabled printers (e.g. Prusa MINI+) on the lab LAN.

## 1. Security & Token Discipline

> [!WARNING]
> To prevent accidental exposure of your API keys:
>
> - **NEVER** pass the API key directly as a command-line argument.
> - **NEVER** enable shell tracing/debugging (e.g., `set -x`) while running commands with credentials.
> - **NEVER** use verbose curl logs (e.g., `curl -v`) that print request headers containing authorization keys.
> - **NEVER** include the API key in screenshots, chat messages, or version-control commits.

EvoFab is configured to read the API key from a secure local file or via an environment variable.

---

## 2. Setup Instructions

### Step 1: Obtain the API Key from the Printer LCD

1. On the Prusa MINI+ physical control screen, navigate to **Settings** → **Network** → **PrusaLink**.
2. Note the **API Key** shown on the screen (alphanumeric string).
3. If you need to rotate the key for security reasons, select **Change API Key** / **Generate New Key** on the LCD menu.

### Step 2: Configure the Secret File

Place the key in a local, Git-ignored file at the root of the `evofab-app` folder:

1. Create the `.secrets` directory:
   ```bash
   mkdir -p .secrets
   ```
2. Write the raw API key directly to `.secrets/prusalink.key` (with no surrounding brackets or spaces):
   ```text
   <PRUSA_API_KEY>
   ```

---

## 3. Running the Probe Script

You can verify the connection to the printer using the provided TypeScript probe script. Run this command from the `evofab-app` directory:

### Query All Endpoints Once

```bash
npx tsx scripts/prusalink-probe.ts --host <PRUSA_IP> --key-file .secrets/prusalink.key
```

_Expected Output:_ Prints a timestamped, fully sanitized log of the five PrusaLink API endpoints (version, info, status, job, storage).

### Continuous Status Polling

To continuously poll PrusaLink printer status for a fixed number of samples, use the `--samples` and `--interval` flags:

```bash
npx tsx scripts/prusalink-probe.ts --host <PRUSA_IP> --key-file .secrets/prusalink.key --samples 300 --interval 2
```

- `--samples`: Number of status checks to perform.
- `--interval`: Delay between checks in seconds.

---

## 4. Alternative Configuration

If you prefer not to use `--key-file`, you can set the `PRUSALINK_KEY_FILE` environment variable:

```bash
export PRUSALINK_KEY_FILE="/path/to/your/secret.key"
npx tsx scripts/prusalink-probe.ts --host <PRUSA_IP>
```

## 5. v0.8 supervised control acceptance

The dashboard dispatches PrusaLink commands only from the lab host. Vercel remains monitoring-only. The browser and Supabase must never receive the printer host, API key, or key-file path.

Before acceptance, apply the additive Prusa job-lifecycle migration, rebuild the dashboard, and restart the dashboard and status-worker scheduled tasks. Confirm exactly one status worker is emitting a monotonic tick sequence at the configured 2-second interval.

Stage B requires William's explicit approval in the active session:

1. Select one approved G-code file.
2. Create the job row.
3. Discover storage with `/api/v1/storage`.
4. Upload with `Print-After-Upload: ?0` and `Overwrite: ?0`.
5. Verify the stored file and confirm the printer remains idle.

Stage C requires a separate explicit approval:

1. Start the verified file with an explicit POST.
2. Record the observed PrusaLink job ID without recording connection details.
3. Pause, resume, and allow natural completion.
4. Record sanitized response codes, job/status transitions, and terminal-detection timing below.

Cancel is not part of this acceptance run and is not an emergency stop. Use the physical emergency procedure when required.

### Acceptance evidence

#### Stage B attempt — 07/11

William approved upload-only Stage B. Stage C was not approved and no print-start request was sent.

- Approved file: `evofab_printer9_stageb-20260711.gcode`
- Size: 130,200 bytes
- SHA-256: `EF107E274828EF2BF4BDCE5C50D640AB001EEB2E34BF21918161354AAB9B65FF`
- Dashboard upload result: HTTP 502 after 1.241 seconds
- Reconciled raw upload result: HTTP 507 after 0.129 seconds; 130,200 bytes transmitted
- `/api/v1/storage`: `usb`, path `/usb/`, `available: false`, `read_only: false`, with no capacity figures reported
- Final printer state: `IDLE`; hotend and bed targets both `0.0 C`; `/api/v1/job` returned HTTP 204; the exact stored-file path returned HTTP 404
- Availability guard: PR #20, merged as `b908f0a`, rejects dispatch with `PRUSALINK_STORAGE_UNAVAILABLE` when no reported storage is available

The evidence establishes that the approved file was not stored and the printer did not start or heat. Hardware work is blocked until the Monday lab visit.

#### Monday reverify checklist

1. Confirm `/api/v1/storage` reports the USB storage as `available: true`.
2. In an elevated Windows session, restart `EvoFab-Dashboard` and `EvoFab-Status-Worker` through Task Scheduler; do not serve either process manually. This deploys the merged availability guard.
3. Reverify storage available, printer `IDLE`, hotend and bed targets `0`, `/api/v1/job` HTTP 204, and the exact Stage B file path HTTP 404.
4. Repeat upload-only Stage B with the approved file and both no-start/no-overwrite headers.
5. Do not begin Stage C until William gives a separate explicit go in that session.
