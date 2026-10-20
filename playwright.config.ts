import { defineConfig } from "@playwright/test"

// Browser seam (M0 spec): real browsers against the dev server, which talks to Neon.
// Locally this drives the installed Microsoft Edge, so no browser download is needed.
export default defineConfig({
  testDir: "e2e",
  // Two-browser specs spend most of their time on sign-in and sync through Neon, which can be
  // slow; 60 s left the slower specs failing on time alone (M5b ticket 01).
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  // CI retries a failed spec once, so a flake costs one spec, not a rerun of the job. A spec
  // that passes only on retry is reported as flaky: fix it, don't ignore it.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    channel: process.env.CI ? undefined : "msedge",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  globalTeardown: "./e2e/global-teardown.ts",
})
