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
  const tempRootDir = await createTempDirectory("gokart-station-project-diagnostics-");
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

const createRunPayload = (overrides: Record<string, unknown> = {}) => {
  return {
    rootTaskName: "PublishReport",
    label: "project diagnostics test",
    parameters: {
      message: "hello from diagnostics test",
      report_date: "2026-04-15",
      rerun_token: "diagnostics",
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

const waitForWatchEvents = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  matcher: (events: Array<{ relativePath: string; kind: string }>) => boolean,
  timeoutMs = 5_000,
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/watch-events?limit=50`,
    });
    assert.equal(response.statusCode, 200);
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

const findNode = (
  nodes: Array<{ relativePath: string; children?: unknown[] }>,
  relativePath: string,
): { relativePath: string; children?: unknown[] } | null => {
  for (const node of nodes) {
    if (node.relativePath === relativePath) {
      return node;
    }

    const children = Array.isArray(node.children)
      ? (node.children as Array<{ relativePath: string; children?: unknown[] }>)
      : [];
    const childMatch = findNode(children, relativePath);
    if (childMatch) {
      return childMatch;
    }
  }

  return null;
};

test("project file tree, watch events, support bundle, and paged logs are available", async () => {
  const fixture = await prepareSampleProjectFixture();
  const supportBundleRuntimeDirectory = path.join(fixture.tempRootDir, "support-bundles");
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "test.db")}`;
  const app = await buildApp({
    databaseUrl,
    projectDiagnostics: {
      supportBundleRuntimeDirectory,
    },
    projectWatch: {
      eventDebounceMs: 25,
      fallbackPollIntervalMs: 10_000,
      maxFallbackPollIntervalMs: 10_000,
    },
  });

  try {
    const operatorProject = await createOperatorProject(app, fixture);

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });

    const watchedWorkspaceFilePath = path.join(fixture.workspaceDirectory, "manual-output.json");
    const watchStartedAt = Date.now();
    await fs.writeFile(watchedWorkspaceFilePath, '{"ok":true}\n', "utf8");
    await fs.writeFile(watchedWorkspaceFilePath, '{"ok":false}\n', "utf8");

    const watchEvents = await waitForWatchEvents(app, operatorProject.id, (events) => {
      return events.some((event) => event.relativePath.endsWith("manual-output.json"));
    });
    assert.ok(
      Date.now() - watchStartedAt < 2_000,
      "watch events should be delivered by native file events before polling fallback runs",
    );
    assert.ok(watchEvents.some((event: { kind: string }) => event.kind === "add"));

    const fileTreeResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${operatorProject.id}/files/tree`,
    });

    assert.equal(fileTreeResponse.statusCode, 200);
    const fileTree = fileTreeResponse.json();
    assert.ok(findNode(fileTree, "workspace"));
    assert.ok(findNode(fileTree, "projectRoot"));
    assert.ok(findNode(fileTree, "workspace/manual-output.json"));

    const createRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/runs`,
      payload: createRunPayload(),
    });

    assert.equal(createRunResponse.statusCode, 201);
    const run = createRunResponse.json();
    await waitForRunStatus(app, run.id, ["success"]);

    const pagedLogsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${run.id}/logs?limit=2&offset=1`,
    });

    assert.equal(pagedLogsResponse.statusCode, 200);
    const pagedLogs = pagedLogsResponse.json();
    assert.equal(pagedLogs.length, 2);

    const supportBundleResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/support-bundle`,
    });

    assert.equal(supportBundleResponse.statusCode, 201);
    const supportBundle = supportBundleResponse.json();
    assert.equal(supportBundle.kind, "support_bundle");

    const bundleManifest = JSON.parse(await fs.readFile(supportBundle.absolutePath, "utf8")) as {
      project: { accessMode: string; capabilities: { canRun: boolean } };
      validation: { resolvedCapabilities: { canRun: boolean } };
      capabilitySnapshot: { schedulerHealth: string } | null;
      scheduler: { snapshot: { health: string } };
      files: { schedulerSnapshot: string };
      latestRun: { fileNames: string[] } | null;
    };

    assert.equal(bundleManifest.project.accessMode, "operator");
    assert.equal(bundleManifest.project.capabilities.canRun, true);
    assert.equal(bundleManifest.validation.resolvedCapabilities.canRun, true);
    assert.ok(bundleManifest.capabilitySnapshot);
    assert.equal(bundleManifest.files.schedulerSnapshot, "scheduler-snapshot.json");
    assert.equal(bundleManifest.scheduler.snapshot.health, "unknown");
    assert.ok(bundleManifest.latestRun?.fileNames.includes("latest-run/logs.txt"));
  } finally {
    await app.close();
    await removeDirectoryWithRetries(fixture.tempRootDir);
  }
});
