import { defineConfig } from "@playwright/test";

// Two-service end-to-end: the experiment system (5173) embeds the game (3001)
// over the real postMessage bridge. Reuses servers already running on those
// ports (e.g. started by the repository-root start-experiment.cmd) so the acceptance test
// can run against the same processes an operator would use.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000
    },
    {
      command: "npm --prefix ../game run dev",
      url: "http://localhost:3001",
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
