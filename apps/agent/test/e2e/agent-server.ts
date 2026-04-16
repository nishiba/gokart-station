import fs from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../../src/app";
import {
  mockLuigidExecutablePath,
  prepareSampleProjectFixture,
  reserveLocalhostPort,
} from "../helpers/sample-project";

const fixtureFilePath = process.env.GOKART_STATION_E2E_FIXTURE_FILE;

if (!fixtureFilePath) {
  throw new Error("GOKART_STATION_E2E_FIXTURE_FILE must be set for Playwright agent startup.");
}

const start = async () => {
  const fixture = await prepareSampleProjectFixture("gokart-station-playwright-");
  const schedulerPort = await reserveLocalhostPort();
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "playwright.db")}`;

  await fs.writeFile(
    path.join(fixture.observerWorkspaceDirectory, "observer-note.txt"),
    "observer seed file\n",
    "utf8",
  );
  await fs.mkdir(path.dirname(fixtureFilePath), {
    recursive: true,
  });
  await fs.writeFile(
    fixtureFilePath,
    JSON.stringify(
      {
        ...fixture,
        pythonExecutable: "python3",
        entrypointPath: "main.py",
        schedulerBaseUrl: `http://127.0.0.1:${schedulerPort}`,
      },
      null,
      2,
    ),
    "utf8",
  );

  const app = await buildApp({
    databaseUrl,
    projectDiagnostics: {
      supportBundleRuntimeDirectory: fixture.supportBundleRuntimeDirectory,
    },
    projectWatch: {
      pollIntervalMs: 50,
    },
    scheduler: {
      executable: process.execPath,
      argumentPrefix: [mockLuigidExecutablePath],
      runtimeDirectory: fixture.schedulerRuntimeDirectory,
      stopProcessOnDispose: true,
    },
  });

  const shutdown = async () => {
    await app.close();
    await fs.rm(fixture.tempRootDir, {
      recursive: true,
      force: true,
    });
    await fs.rm(fixtureFilePath, {
      force: true,
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? "4000"),
  });
};

void start();
