import { defineProject } from "vitest/config"

export default defineProject({
  // Each HTTP-seam test boots its own in-memory Postgres (PGlite) and runs the migrations.
  test: { name: "worker", testTimeout: 30_000, hookTimeout: 30_000 },
})
