import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app";
import {
  mockLuigidExecutablePath,
  prepareSampleProjectFixture,
  reserveLocalhostPort,
  waitForRunStatus,
  waitForWatchEvents,
} from "./helpers/sample-project";

const createObserverProject = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  workspaceDirectory: string,
) => {
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

const createOperatorProject = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  fixture: Awaited<ReturnType<typeof prepareSampleProjectFixture>>,
  schedulerBaseUrl: string,
) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "sample-operator-project",
      connection: {
        accessMode: "operator",
        projectRootDir: fixture.targetProjectDir,
        pythonExecutable: "python3",
        entrypointPath: "main.py",
        workspaceDirectory: fixture.workspaceDirectory,
        schedulerBaseUrl,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json();
};

const createRunPayload = (rootTaskName: string, overrides: Record<string, unknown> = {}) => {
  return {
    rootTaskName,
    label: `${rootTaskName} integration`,
    parameters: {
      message: `${rootTaskName} from integration`,
      report_date: "2026-04-15",
      rerun_token: rootTaskName.toLowerCase(),
      simulateDelayMs: 0,
    },
    rerunMode: "same_spec",
    captureTaskInfoTree: true,
    captureTaskInfoTable: true,
    captureArtifactManifest: true,
    ...overrides,
  };
};

test("sample project integration covers mode boundaries, success, failed, partial failure, and support bundle export", async () => {
  const fixture = await prepareSampleProjectFixture("gokart-station-release-sample-");
  const schedulerPort = await reserveLocalhostPort();
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "test.db")}`;
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

  try {
    const observerProject = await createObserverProject(app, fixture.observerWorkspaceDirectory);
    const observerValidationResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${observerProject.id}/validate`,
    });
    assert.equal(observerValidationResponse.statusCode, 200);
    const observerValidation = observerValidationResponse.json();
    assert.equal(observerValidation.ok, true);
    assert.equal(observerValidation.resolvedCapabilities.canRun, false);

    const observerRunCreateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${observerProject.id}/runs`,
      payload: createRunPayload("PublishReport"),
    });
    assert.equal(observerRunCreateResponse.statusCode, 403);

    const operatorProject = await createOperatorProject(
      app,
      fixture,
      `http://127.0.0.1:${schedulerPort}`,
    );
    const operatorValidationResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/validate`,
    });
    assert.equal(operatorValidationResponse.statusCode, 200);
    const operatorValidation = operatorValidationResponse.json();
    assert.equal(operatorValidation.resolvedCapabilities.canRun, true);

    const schedulerStartResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/start",
      payload: {
        projectId: operatorProject.id,
      },
    });
    assert.equal(schedulerStartResponse.statusCode, 200);
    assert.equal(schedulerStartResponse.json().health, "healthy");

    const successRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload("PublishReport", {
        parameters: {
          message: "success case",
          report_date: "2026-04-15",
          rerun_token: "success",
          simulateDelayMs: 0,
        },
      }),
    });
    assert.equal(successRunResponse.statusCode, 201);
    const successRun = successRunResponse.json();
    await waitForRunStatus(app, successRun.id, ["success"]);

    const failedRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload("ImmediateFailure", {
        parameters: {
          message: "failed case",
          report_date: "2026-04-15",
          rerun_token: "failed",
          simulateDelayMs: 0,
        },
      }),
    });
    assert.equal(failedRunResponse.statusCode, 201);
    const failedRun = failedRunResponse.json();
    const finishedFailedRun = await waitForRunStatus(app, failedRun.id, ["failed"]);
    assert.equal(finishedFailedRun.status, "failed");

    const partialRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload("PartialFailureReport", {
        parameters: {
          message: "partial failure case",
          report_date: "2026-04-15",
          rerun_token: "partial",
          simulateDelayMs: 0,
        },
      }),
    });
    assert.equal(partialRunResponse.statusCode, 201);
    const partialRun = partialRunResponse.json();
    const finishedPartialRun = await waitForRunStatus(app, partialRun.id, ["failed"]);
    assert.equal(finishedPartialRun.status, "failed");

    const partialLineageResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${partialRun.id}/lineage`,
    });
    assert.equal(partialLineageResponse.statusCode, 200);
    const partialLineage = partialLineageResponse.json();
    assert.equal(partialLineage.length, 5);

    const lineageStateByTaskName = new Map<string, string>(
      partialLineage.map((node: { taskName: string; state: string }) => [
        node.taskName,
        node.state,
      ]),
    );
    assert.equal(lineageStateByTaskName.get("PrepareInput"), "DONE");
    assert.equal(lineageStateByTaskName.get("RenderReport"), "DONE");
    assert.equal(lineageStateByTaskName.get("PublishReport"), "DONE");
    assert.equal(lineageStateByTaskName.get("BrokenReport"), "FAILED");
    assert.equal(lineageStateByTaskName.get("PartialFailureReport"), "PENDING");

    const partialArtifactsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${partialRun.id}/artifacts`,
    });
    assert.equal(partialArtifactsResponse.statusCode, 200);
    const partialArtifacts = partialArtifactsResponse.json();
    assert.ok(
      partialArtifacts.some(
        (artifact: { kind: string; relativePath: string }) =>
          artifact.kind === "output" &&
          artifact.relativePath.endsWith("published/2026-04-15-partial-metadata.json"),
      ),
    );
    assert.ok(
      partialArtifacts.some(
        (artifact: { kind: string; relativePath: string }) =>
          artifact.kind === "output" &&
          artifact.relativePath.endsWith("failed/2026-04-15-partial-broken.json"),
      ),
    );

    await waitForWatchEvents(app, operatorProject.id, (events) =>
      events.some((event) =>
        event.relativePath.endsWith("published/2026-04-15-partial-metadata.json"),
      ),
    );

    const supportBundleResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/support-bundle`,
    });
    assert.equal(supportBundleResponse.statusCode, 201);
    const supportBundle = supportBundleResponse.json();

    const bundleManifest = JSON.parse(await fs.readFile(supportBundle.absolutePath, "utf8")) as {
      project: { accessMode: string; capabilities: { canRun: boolean } };
      validation: { resolvedCapabilities: { canRun: boolean }; schedulerHealth: string };
      capabilitySnapshot: { schedulerHealth: string } | null;
      scheduler: { health: { health: string } };
      latestRun: { run: { spec: { rootTaskName: string } }; fileNames: string[] } | null;
    };

    assert.equal(bundleManifest.project.accessMode, "operator");
    assert.equal(bundleManifest.project.capabilities.canRun, true);
    assert.equal(bundleManifest.validation.resolvedCapabilities.canRun, true);
    assert.equal(bundleManifest.validation.schedulerHealth, "healthy");
    assert.equal(bundleManifest.capabilitySnapshot?.schedulerHealth, "healthy");
    assert.equal(bundleManifest.scheduler.health.health, "healthy");
    assert.equal(bundleManifest.latestRun?.run.spec.rootTaskName, "PartialFailureReport");
    assert.ok(bundleManifest.latestRun?.fileNames.includes("latest-run/adapter-events.json"));

    const schedulerRestartResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/restart",
      payload: {
        projectId: operatorProject.id,
      },
    });
    assert.equal(schedulerRestartResponse.statusCode, 200);
    assert.equal(schedulerRestartResponse.json().health, "healthy");

    const schedulerStopResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/stop",
      payload: {
        projectId: operatorProject.id,
      },
    });
    assert.equal(schedulerStopResponse.statusCode, 200);
    assert.notEqual(schedulerStopResponse.json().isManagedByStation, true);
  } finally {
    await app.close();
    await fs.rm(fixture.tempRootDir, {
      recursive: true,
      force: true,
    });
  }
});
