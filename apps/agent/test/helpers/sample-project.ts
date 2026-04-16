import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { buildApp } from "../../src/app";

export const sampleProjectSourceDir = fileURLToPath(
  new URL("../../../../examples/sample_gokart_project", import.meta.url),
);

export const mockLuigidExecutablePath = fileURLToPath(
  new URL("../fixtures/mock-luigid.mjs", import.meta.url),
);

export const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

export const reserveLocalhostPort = async () => {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Unable to reserve an ephemeral localhost port for tests."));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
};

export const prepareSampleProjectFixture = async (prefix: string) => {
  const tempRootDir = await createTempDirectory(prefix);
  const targetProjectDir = path.join(tempRootDir, "sample_target_repo");
  const workspaceDirectory = path.join(tempRootDir, "sample_workspace");
  const observerWorkspaceDirectory = path.join(tempRootDir, "observer_workspace");
  const supportBundleRuntimeDirectory = path.join(tempRootDir, "support-bundles");
  const schedulerRuntimeDirectory = path.join(tempRootDir, "scheduler-runtime");

  await fs.cp(sampleProjectSourceDir, targetProjectDir, {
    recursive: true,
  });
  await fs.mkdir(workspaceDirectory, {
    recursive: true,
  });
  await fs.mkdir(observerWorkspaceDirectory, {
    recursive: true,
  });

  return {
    tempRootDir,
    targetProjectDir: await fs.realpath(targetProjectDir),
    workspaceDirectory: await fs.realpath(workspaceDirectory),
    observerWorkspaceDirectory: await fs.realpath(observerWorkspaceDirectory),
    supportBundleRuntimeDirectory,
    schedulerRuntimeDirectory,
  };
};

export const waitForRunStatus = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  runId: string,
  expectedStatuses: string[],
  timeoutMs = 5_000,
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
    });
    if (response.statusCode !== 200) {
      throw new Error(`Run ${runId} fetch failed with status ${response.statusCode}.`);
    }
    const run = response.json();
    if (expectedStatuses.includes(run.status)) {
      return run;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for run ${runId} to reach ${expectedStatuses.join(", ")}.`);
};

export const waitForWatchEvents = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  matcher: (events: Array<{ relativePath: string; kind: string }>) => boolean,
  timeoutMs = 5_000,
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/watch-events?limit=200`,
    });
    if (response.statusCode !== 200) {
      throw new Error(`Watch event fetch failed with status ${response.statusCode}.`);
    }
    const events = response.json();
    if (matcher(events)) {
      return events;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for watch events for project ${projectId}.`);
};
