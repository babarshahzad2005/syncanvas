import { defineProject } from "vitest/config"

export default defineProject({
  // HTTP seam in Node: each test boots its own in-memory Postgres (PGlite) and runs the migrations.
  test: {
    name: "worker",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.room.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
