import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "apps/worker/vitest.room.config.ts"],
  },
})
