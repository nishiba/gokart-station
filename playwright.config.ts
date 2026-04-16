import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const fixtureFilePath = path.join(os.tmpdir(), "gokart-station-playwright", "fixture.json");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: [
    {
      command: "pnpm --filter agent exec tsx test/e2e/agent-server.ts",
      cwd: __dirname,
      env: {
        ...process.env,
        GOKART_STATION_E2E_FIXTURE_FILE: fixtureFilePath,
        HOST: "127.0.0.1",
        PORT: "4000",
      },
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter web exec vite --host 127.0.0.1 --port 4173",
      cwd: __dirname,
      env: {
        ...process.env,
      },
      url: "http://127.0.0.1:4173/projects",
      reuseExistingServer: false,
    },
  ],
});
