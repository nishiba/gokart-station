import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AdapterRunRequest } from "@gokart-station/shared";
import { AdapterService } from "../src/services/adapter-service";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const exampleProjectSourceDir = fileURLToPath(
  new URL("../../../examples/sample_gokart_project", import.meta.url),
);

const prepareSampleProjectFixture = async () => {
  const tempRootDir = await createTempDirectory("gokart-station-target-project-");
  const targetProjectDir = path.join(tempRootDir, "sample_target_repo");
  const workspaceDirectory = path.join(tempRootDir, "sample_workspace");

  await fs.cp(exampleProjectSourceDir, targetProjectDir, {
    recursive: true,
  });
  await fs.mkdir(workspaceDirectory, {
    recursive: true,
  });

  const resolvedTargetProjectDir = await fs.realpath(targetProjectDir);
  const resolvedWorkspaceDirectory = await fs.realpath(workspaceDirectory);

  return {
    tempRootDir,
    targetProjectDir: resolvedTargetProjectDir,
    workspaceDirectory: resolvedWorkspaceDirectory,
  };
};

const buildRequest = (targetProjectDir: string, workspaceDirectory: string): AdapterRunRequest => ({
  runId: "run_agent_spawn",
  projectId: "project_agent_spawn",
  projectName: "sample_gokart_project",
  accessMode: "operator",
  projectRootDir: targetProjectDir,
  workspaceDirectory,
  pythonExecutable: "python3",
  entrypointPath: "main.py",
  schedulerBaseUrl: null,
  configValues: {
    sample_key: "value",
  },
  envValues: {
    ENV_NAME: "value",
  },
  envMaskedKeys: ["SECRET_TOKEN"],
  spec: {
    rootTaskName: "PublishReport",
    label: "sample project adapter run",
    parameters: {
      message: "hello from adapter service",
      report_date: "2026-04-15",
      rerun_token: "integration",
      simulateDelayMs: 0,
    },
    rerunMode: "same_spec",
    captureTaskInfoTree: true,
    captureTaskInfoTable: true,
    captureArtifactManifest: true,
  },
});

test("adapter service can spawn the Python adapter via stdin and temp file", async () => {
  const fixture = await prepareSampleProjectFixture();
  const adapterService = new AdapterService({
    pythonExecutable: "python3",
  });
  const request = buildRequest(fixture.targetProjectDir, fixture.workspaceDirectory);

  try {
    const stdinResult = await adapterService.runOnce(request, {
      cwd: fixture.targetProjectDir,
      transport: "stdin",
    });
    assert.equal(stdinResult.exitCode, 0, stdinResult.stderr);
    assert.ok(stdinResult.events.some((event) => event.type === "run.started"));
    assert.ok(stdinResult.events.some((event) => event.type === "run.finished"));
    assert.ok(
      stdinResult.events.some(
        (event) =>
          event.type === "artifact.discovered" &&
          event.absolutePath.startsWith(fixture.workspaceDirectory),
      ),
    );

    const fileResult = await adapterService.runOnce(request, {
      cwd: fixture.targetProjectDir,
      transport: "temp_file",
    });
    assert.equal(fileResult.exitCode, 0, fileResult.stderr);
    assert.ok(fileResult.events.some((event) => event.type === "task.discovered"));
    assert.ok(fileResult.events.some((event) => event.type === "artifact.discovered"));
    const runStartedEvent = fileResult.events.find((event) => event.type === "run.started");
    assert.equal(runStartedEvent?.projectRootDir, fixture.targetProjectDir);
  } finally {
    await fs.rm(fixture.tempRootDir, {
      recursive: true,
      force: true,
    });
  }
});
