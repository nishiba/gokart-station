import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const tempRootDir = await createTempDirectory("gokart-station-lineage-");
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
      name: "sample-lineage-project",
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

  assert.equal(response.statusCode, 201);
  return response.json();
};

const createRunPayload = (rootTaskName: string, overrides: Record<string, unknown> = {}) => {
  return {
    rootTaskName,
    label: `${rootTaskName} lineage test`,
    parameters: {
      message: `${rootTaskName} message`,
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

test("graph, lineage, artifacts, raw payloads, and previous-success compare are available", async () => {
  const fixture = await prepareSampleProjectFixture();
  const databaseUrl = `file:${path.join(fixture.tempRootDir, "test.db")}`;
  const app = await buildApp({ databaseUrl });

  try {
    const project = await createOperatorProject(app, fixture);

    const baselineRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/runs`,
      payload: createRunPayload("PublishReport", {
        label: "baseline success",
        parameters: {
          message: "baseline success",
          report_date: "2026-04-15",
          rerun_token: "baseline",
          simulateDelayMs: 0,
        },
      }),
    });
    assert.equal(baselineRunResponse.statusCode, 201);
    const baselineRun = baselineRunResponse.json();
    await waitForRunStatus(app, baselineRun.id, ["success"]);

    const currentRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/runs`,
      payload: createRunPayload("PublishReport", {
        label: "current success",
        parameters: {
          message: "current success",
          report_date: "2026-04-15",
          rerun_token: "current",
          simulateDelayMs: 120,
        },
      }),
    });
    assert.equal(currentRunResponse.statusCode, 201);
    const currentRun = currentRunResponse.json();
    await waitForRunStatus(app, currentRun.id, ["success"]);

    const graphResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/graph`,
    });
    assert.equal(graphResponse.statusCode, 200);
    const graph = graphResponse.json();
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert.deepEqual(
      [...graph.nodes.map((node: { taskName: string }) => node.taskName)].sort((left, right) =>
        left.localeCompare(right),
      ),
      ["PrepareInput", "PublishReport", "RenderReport"],
    );

    const lineageResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/lineage`,
    });
    assert.equal(lineageResponse.statusCode, 200);
    const lineage = lineageResponse.json();
    assert.equal(lineage.length, 3);
    const publishNode = lineage.find(
      (node: { taskName: string }) => node.taskName === "PublishReport",
    );
    assert.ok(publishNode);

    const lineageNodeResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/lineage/${publishNode.id}`,
    });
    assert.equal(lineageNodeResponse.statusCode, 200);
    const publishLineageNode = lineageNodeResponse.json();
    assert.equal(publishLineageNode.state, "DONE");
    assert.equal(publishLineageNode.parameters.rerun_token, "current");
    assert.ok(
      publishLineageNode.outputs.some((entry: string) =>
        entry.endsWith("2026-04-15-current-metadata.json"),
      ),
    );

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/lineage/${publishNode.id}/compare-previous-success`,
    });
    assert.equal(compareResponse.statusCode, 200);
    const compareResult = compareResponse.json();
    assert.equal(compareResult.current.taskName, "PublishReport");
    assert.equal(compareResult.previous.taskName, "PublishReport");
    assert.equal(compareResult.diff.stateChanged, false);
    assert.equal(compareResult.diff.parameterDiff.message.current, "current success");
    assert.equal(compareResult.diff.parameterDiff.message.previous, "baseline success");
    assert.equal(compareResult.diff.parameterDiff.rerun_token.current, "current");
    assert.equal(compareResult.diff.parameterDiff.rerun_token.previous, "baseline");
    assert.equal(compareResult.diff.processingTimeDiffSec, 0.12);
    assert.ok(
      compareResult.diff.outputPathDiff.added.some((entry: string) =>
        entry.endsWith("2026-04-15-current-metadata.json"),
      ),
    );
    assert.ok(
      compareResult.diff.outputPathDiff.removed.some((entry: string) =>
        entry.endsWith("2026-04-15-baseline-metadata.json"),
      ),
    );

    const artifactsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/artifacts`,
    });
    assert.equal(artifactsResponse.statusCode, 200);
    const artifacts = artifactsResponse.json();
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "output"));
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "task_log"));
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "task_params"));
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "processing_time"));
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "task_info_tree"));
    assert.ok(artifacts.some((artifact: { kind: string }) => artifact.kind === "task_info_table"));

    const taskParamsArtifact = artifacts.find(
      (artifact: { kind: string; relativePath: string }) =>
        artifact.kind === "task_params" && artifact.relativePath.includes("PublishReport"),
    );
    assert.ok(taskParamsArtifact);

    const artifactContentResponse = await app.inject({
      method: "GET",
      url: `/api/artifacts/${taskParamsArtifact.id}/content`,
    });
    assert.equal(artifactContentResponse.statusCode, 200);
    const artifactContent = artifactContentResponse.json();
    assert.equal(artifactContent.contentType, "text");
    assert.match(artifactContent.text, /"rerun_token": "current"/u);

    const rawTaskInfoTreeResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/raw/task-info-tree`,
    });
    assert.equal(rawTaskInfoTreeResponse.statusCode, 200);
    const rawTaskInfoTree = rawTaskInfoTreeResponse.json();
    assert.equal(rawTaskInfoTree.raw.taskName, "PublishReport");
    assert.equal(rawTaskInfoTree.raw.children.length, 1);

    const rawTaskInfoTableResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/raw/task-info-table`,
    });
    assert.equal(rawTaskInfoTableResponse.statusCode, 200);
    const rawTaskInfoTable = rawTaskInfoTableResponse.json();
    assert.equal(rawTaskInfoTable.raw.length, 3);
    assert.ok(
      rawTaskInfoTable.raw.some(
        (entry: { taskName: string; taskLog: { entries: unknown[] } }) =>
          entry.taskName === "PublishReport" && entry.taskLog.entries.length >= 2,
      ),
    );

    const rawSchedulerResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/raw/scheduler`,
    });
    assert.equal(rawSchedulerResponse.statusCode, 200);
    const rawScheduler = rawSchedulerResponse.json();
    assert.ok(Array.isArray(rawScheduler.raw));
    assert.ok(rawScheduler.raw.length >= 1);

    const rawAdapterEventsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${currentRun.id}/raw/adapter-events`,
    });
    assert.equal(rawAdapterEventsResponse.statusCode, 200);
    const rawAdapterEvents = rawAdapterEventsResponse.json();
    assert.ok(Array.isArray(rawAdapterEvents.raw));
    assert.ok(
      rawAdapterEvents.raw.some((event: { type: string }) => event.type === "raw.task_info_table"),
    );
    assert.ok(
      rawAdapterEvents.raw.some((event: { type: string }) => event.type === "artifact.discovered"),
    );

    const failedRunResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/runs`,
      payload: createRunPayload("BrokenReport", {
        label: "failed run",
        parameters: {
          message: "expected failure",
          report_date: "2026-04-15",
          rerun_token: "broken",
          simulateDelayMs: 0,
        },
      }),
    });
    assert.equal(failedRunResponse.statusCode, 201);
    const failedRun = failedRunResponse.json();
    await waitForRunStatus(app, failedRun.id, ["failed"]);

    const failedLineageResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${failedRun.id}/lineage`,
    });
    assert.equal(failedLineageResponse.statusCode, 200);
    const failedLineage = failedLineageResponse.json();
    const brokenNode = failedLineage.find(
      (node: { taskName: string }) => node.taskName === "BrokenReport",
    );
    assert.ok(brokenNode);
    assert.equal(brokenNode.state, "FAILED");
    assert.equal(brokenNode.parameters.rerun_token, "broken");
    assert.ok(
      brokenNode.outputs.some((entry: string) => entry.endsWith("2026-04-15-broken-broken.json")),
    );
    assert.ok(
      brokenNode.taskLog.entries.some((entry: { stream: string }) => entry.stream === "stderr"),
    );

    const failedArtifactsResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${failedRun.id}/artifacts`,
    });
    assert.equal(failedArtifactsResponse.statusCode, 200);
    const failedArtifacts = failedArtifactsResponse.json();
    assert.ok(
      failedArtifacts.some(
        (artifact: { kind: string; relativePath: string }) =>
          artifact.kind === "output" &&
          artifact.relativePath.includes("failed/2026-04-15-broken-broken.json"),
      ),
    );
    assert.ok(
      failedArtifacts.some(
        (artifact: { kind: string; relativePath: string }) =>
          artifact.kind === "task_log" && artifact.relativePath.includes("BrokenReport"),
      ),
    );
  } finally {
    await app.close();
    await fs.rm(fixture.tempRootDir, {
      recursive: true,
      force: true,
    });
  }
});
