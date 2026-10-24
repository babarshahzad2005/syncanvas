import { defineConfig } from "@playwright/test"

// S5/S6 measurements (M6 ticket 08), run by hand, never in CI (`pnpm perf`). They expect two
// local servers: `pnpm dev` on :5173 (sign-in through the dev inbox) and the production build on
// :8787, where the timings are taken (see docs/benchmarks.md for the commands).
export default defineConfig({
  testDir: ".",
  testMatch: "*.perf.ts",
  globalTeardown: "../../e2e/global-teardown.ts",
  timeout: 600_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    channel: process.env.CI ? undefined : "msedge",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
})
