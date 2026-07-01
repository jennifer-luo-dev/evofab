import { spawn } from "node:child_process";
import process from "node:process";

const mode = process.argv[2] ?? "mock";
const allowedModes = new Set(["mock", "local", "hardware"]);

if (!allowedModes.has(mode)) {
  console.error(`Unknown development mode: ${mode}`);
  process.exit(1);
}

const children = [];
const env = { ...process.env, MOONRAKER_MODE: mode };

if (mode === "hardware") {
  env.HARDWARE_CONFIRMATION = "I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE";
  console.warn(
    "\nWARNING: hardware mode can move and heat physical printers.\n",
  );
}

function run(command, args, childEnv = env) {
  const child = spawn(command, args, {
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

if (mode === "mock") {
  run(process.execPath, ["scripts/mock-moonraker.mjs"]);
}

run(process.execPath, ["node_modules/next/dist/bin/next", "dev"]);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
