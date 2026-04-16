import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { removeDirectoryWithRetries } from "./helpers/cleanup";
import { resolveSampleProjectPythonExecutable } from "./helpers/sample-project";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const exampleProjectSourceDir = fileURLToPath(
  new URL("../../../examples/sample_gokart_project", import.meta.url),
);

const prepareSampleProjectFixture = async () => {
  const tempRootDir = await createTempDirectory("gokart-station-run-control-");
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

const createOperatorProject = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  fixture: Awaited<ReturnType<typeof prepareSampleProjectFixture>>,
) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "sample-operator-project",
      connection: {
        accessMode: "operator",
        projectRootDir: fixture.targetProjectDir,
        pythonExecutable: resolveSampleProjectPythonExecutable(),
        entrypointPath: "main.py",
        workspaceDirectory: fixture.workspaceDirectory,
        schedulerBaseUrl: null,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json();
};

const createObserverProject = async (app: Awaited<ReturnType<typeof buildApp>>) => {
  const workspaceDirectory = await createTempDirectory("gokart-station-observer-run-workspace-");
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "sample-observer-project",
      connection: {
        accessMode: "observer",
        workspaceDirectory,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json();
};

const createRunPayload = (overrides: Record<string, unknown> = {}) => {
  return {
    rootTaskName: "PublishReport",
    label: "run control test",
    parameters: {
      message: "hello from run control test",
      report_date: "2026-04-15",
      rerun_token: "baseline",
      simulateDelayMs: 0,
    },
    rerunMode: "same_spec",
    captureTaskInfoTree: true,
    captureTaskInfoTable: true,
    captureArtifactManifest: true,
    ...overrides,
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

const waitForTimelineEventTypes = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  runId: string,
  expectedTypes: string[],
  timeoutMs = 5_000,
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/timeline`,
    });
    assert.equal(response.statusCode, 200);
    const timeline = response.json() as Array<{ type: string }>;
    if (
      expectedTypes.every((expectedType) => timeline.some((entry) => entry.type === expectedType))
    ) {
      return timeline;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(
    `Timed out waiting for run ${runId} timeline to contain ${expectedTypes.join(", ")}.`,
  );
};

test("run control and SSE APIs support create/stop/rerun and observer 403 rules", async () => {
  const fixture = await prepareSampleProjectFixture();
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "test.db")}`;
  const app = await buildApp({ databaseUrl });

  try {
    const operatorProject = await createOperatorProject(app, fixture);
    const observerProject = await createObserverProject(app);

    const observerRunCreateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${observerProject.id}/runs`,
      payload: createRunPayload(),
    });

    assert.equal(observerRunCreateResponse.statusCode, 403);

    const createSuccessRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload({
        parameters: {
          message: "success run",
          report_date: "2026-04-15",
          rerun_token: "success",
          simulateDelayMs: 100,
        },
      }),
    });

    assert.equal(createSuccessRunResponse.statusCode, 201);
    const successRun = createSuccessRunResponse.json();
    assert.equal(successRun.projectId, operatorProject.id);

    const runsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${operatorProject.id}/runs`,
    });

    assert.equal(runsResponse.statusCode, 200);
    const listedRuns = runsResponse.json();
    assert.ok(listedRuns.some((entry: { id: string }) => entry.id === successRun.id));

    const finishedSuccessRun = await waitForRunStatus(app, successRun.id, ["success"]);
    assert.equal(finishedSuccessRun.status, "success");

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${successRun.id}/logs/stream`,
    });

    assert.equal(streamResponse.statusCode, 200);
    assert.match(streamResponse.headers["content-type"] ?? "", /text\/event-stream/u);
    assert.match(streamResponse.body, /event: run/u);
    assert.match(streamResponse.body, /event: log/u);
    assert.match(streamResponse.body, /event: timeline/u);
    assert.match(streamResponse.body, /event: scheduler/u);

    const logsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${successRun.id}/logs`,
    });

    assert.equal(logsResponse.statusCode, 200);
    const logs = logsResponse.json();
    assert.ok(logs.length > 0);
    assert.ok(logs.some((entry: { stream: string }) => entry.stream === "stderr"));

    const timeline = await waitForTimelineEventTypes(app, successRun.id, [
      "run_created",
      "adapter_started",
      "run_finished",
    ]);
    assert.ok(timeline.some((entry: { type: string }) => entry.type === "run_created"));
    assert.ok(timeline.some((entry: { type: string }) => entry.type === "adapter_started"));
    assert.ok(timeline.some((entry: { type: string }) => entry.type === "run_finished"));

    const createStoppingRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload({
        label: "stop target",
        parameters: {
          message: "stop run",
          report_date: "2026-04-15",
          rerun_token: "stop-target",
          simulateDelayMs: 800,
        },
      }),
    });

    assert.equal(createStoppingRunResponse.statusCode, 201);
    const stoppingRun = createStoppingRunResponse.json();

    await waitForRunStatus(app, stoppingRun.id, ["starting", "running"]);

    const stopResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${stoppingRun.id}/stop`,
      payload: {
        mode: "graceful",
      },
    });

    assert.equal(stopResponse.statusCode, 200);
    const stoppedRun = stopResponse.json();
    assert.equal(stoppedRun.status, "stopping");
    assert.equal(stoppedRun.stopMode, "graceful");

    const finishedStoppedRun = await waitForRunStatus(app, stoppingRun.id, ["canceled"]);
    assert.equal(finishedStoppedRun.status, "canceled");

    const rerunResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${successRun.id}/rerun`,
      payload: {
        rerunMode: "with_param_override",
        label: "rerun test",
        parameters: {
          rerun_token: "rerun-1",
        },
      },
    });

    assert.equal(rerunResponse.statusCode, 201);
    const rerun = rerunResponse.json();
    assert.notEqual(rerun.id, successRun.id);

    const finishedRerun = await waitForRunStatus(app, rerun.id, ["success"]);
    assert.equal(finishedRerun.status, "success");
    assert.equal(finishedRerun.spec.parameters.rerun_token, "rerun-1");

    const switchToObserverResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${operatorProject.id}`,
      payload: {
        connection: {
          accessMode: "observer",
        },
      },
    });

    assert.equal(switchToObserverResponse.statusCode, 200);

    const observerStopResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${successRun.id}/stop`,
      payload: {
        mode: "force",
      },
    });

    assert.equal(observerStopResponse.statusCode, 403);

    const observerRerunResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${successRun.id}/rerun`,
      payload: {},
    });

    assert.equal(observerRerunResponse.statusCode, 403);
  } finally {
    await app.close();
    await removeDirectoryWithRetries(fixture.tempRootDir);
  }
});
