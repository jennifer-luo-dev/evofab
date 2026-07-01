import { spawnSync } from "node:child_process";
import process from "node:process";

if (process.env.RUN_HARDWARE_TESTS !== "true") {
  console.error(
    "Hardware tests are disabled. Set RUN_HARDWARE_TESTS=true after completing the lab safety checklist.",
  );
  process.exit(1);
}

if (
  process.env.HARDWARE_CONFIRMATION !==
  "I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE"
) {
  console.error(
    "Set the required HARDWARE_CONFIRMATION value before controlling a printer.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.hardware.config.ts",
  ],
  {
    env: { ...process.env, MOONRAKER_MODE: "hardware" },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
