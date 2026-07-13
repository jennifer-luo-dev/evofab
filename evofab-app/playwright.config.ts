import { defineConfig, devices } from "@playwright/test";

const hostAcceptance = process.env.EVOFAB_HOST_E2E === "1";
const e2ePort = process.env.EVOFAB_E2E_PORT ?? "3000";
const e2eBaseUrl =
  process.env.EVOFAB_E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const e2eServerCommand =
  process.env.EVOFAB_E2E_SERVER === "start"
    ? `npm run start -- --hostname 127.0.0.1 --port ${e2ePort}`
    : `npm run dev -- --hostname 127.0.0.1 --port ${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  webServer: hostAcceptance
    ? undefined
    : {
        command: e2eServerCommand,
        url: e2eBaseUrl,
        reuseExistingServer: false,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-signature",
          MOONRAKER_MODE: "mock",
          SLICER_MODE: "mock",
          EVOFAB_E2E_MOCK_SUPABASE: "1",
        },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
