import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const exampleProjectSourceDir = fileURLToPath(
  new URL("../../../examples/sample_gokart_project", import.meta.url),
);

const prepareSampleProjectFixture = async () => {
  const tempRootDir = await createTempDirectory("gokart-station-run-cleanup-");
  const targetProjectDir = path.join(tempRootDir, "sample_target_repo");
  const workspaceDirectory = path.join(tempRootDir, "sample_workspace");

  await fs.cp(exampleProjectSourceDir, targetProjectDir, {
    recursive: true,
  });
  await fs.mkdir(workspaceDirectory, {
    recursive: true,
  });

  return {
    tempRootDir,
    targetProjectDir: await fs.realpath(targetProjectDir),
    workspaceDirectory: await fs.realpath(workspaceDirectory),
  };
};

const waitForRunStatus = async (
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
    assert.equal(response.statusCode, 200);
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

const waitForPidToDisappear = async (pid: number, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ESRCH") {
        return;
      }

      throw error;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for pid ${pid} to disappear.`);
};

test("forced adapter termination is cleaned up without leaving a zombie process", async () => {
  const fixture = await prepareSampleProjectFixture();
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "test.db")}`;
  const app = await buildApp({
    databaseUrl,
  });

  try {
    const createProjectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "cleanup-project",
        connection: {
          accessMode: "operator",
          projectRootDir: fixture.targetProjectDir,
          pythonExecutable: "python3",
          entrypointPath: "main.py",
          workspaceDirectory: fixture.workspaceDirectory,
          schedulerBaseUrl: null,
        },
      },
    });

    assert.equal(createProjectResponse.statusCode, 201);
    const project = createProjectResponse.json();

    const createRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/runs`,
      payload: {
        rootTaskName: "PublishReport",
        label: "cleanup-test",
        parameters: {
          message: "cleanup",
          report_date: "2026-04-15",
          rerun_token: "cleanup",
          simulateDelayMs: 1_200,
        },
        rerunMode: "same_spec",
        captureTaskInfoTree: true,
        captureTaskInfoTable: true,
        captureArtifactManifest: true,
      },
    });

    assert.equal(createRunResponse.statusCode, 201);
    const createdRun = createRunResponse.json();

    const runningRun = await waitForRunStatus(app, createdRun.id, ["starting", "running"]);
    assert.equal(typeof runningRun.adapterPid, "number");

    process.kill(runningRun.adapterPid, "SIGKILL");

    const finishedRun = await waitForRunStatus(app, createdRun.id, ["failed", "canceled"]);
    assert.ok(["failed", "canceled"].includes(finishedRun.status));
    await waitForPidToDisappear(runningRun.adapterPid);
  } finally {
    await app.close();
    await fs.rm(fixture.tempRootDir, {
      recursive: true,
      force: true,
    });
  }
});
