import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

test("project/profile/mode API supports observer and operator flows", async () => {
  const testRootDir = await createTempDirectory("gokart-station-agent-");
  const databaseUrl = `file:${path.join(testRootDir, "test.db")}`;
  const app = await buildApp({ databaseUrl });

  try {
    const healthResponse = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    assert.equal(healthResponse.statusCode, 200);

    const observerWorkspaceDir = await createTempDirectory("gokart-station-observer-workspace-");
    const observerCreateResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "observer-project",
        connection: {
          accessMode: "observer",
          workspaceDirectory: observerWorkspaceDir,
        },
      },
    });

    assert.equal(observerCreateResponse.statusCode, 201);
    const observerProject = observerCreateResponse.json();
    assert.equal(observerProject.connection.accessMode, "observer");
    assert.equal(observerProject.capabilities.canRun, false);

    const observerValidateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${observerProject.id}/validate`,
    });

    assert.equal(observerValidateResponse.statusCode, 200);
    const observerValidation = observerValidateResponse.json();
    assert.equal(observerValidation.ok, true);
    assert.equal(observerValidation.resolvedCapabilities.canRun, false);
    assert.equal(observerValidation.resolvedCapabilities.canReadWorkspace, true);

    const observerProfileCreateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${observerProject.id}/profiles`,
      payload: {
        kind: "config",
        name: "observer-config",
        values: {
          FOO: "bar",
        },
        maskedKeys: [],
        isDefault: false,
        enabledForModes: ["observer"],
      },
    });

    assert.equal(observerProfileCreateResponse.statusCode, 403);

    const operatorProjectRootDir = await createTempDirectory("gokart-station-operator-root-");
    const operatorWorkspaceDir = await createTempDirectory("gokart-station-operator-workspace-");
    const entrypointPath = path.join(operatorProjectRootDir, "main.py");
    const envSourcePath = path.join(operatorProjectRootDir, ".env");
    const luigiConfigPath = path.join(operatorProjectRootDir, "luigi.cfg");

    await fs.writeFile(entrypointPath, "print('hello')\n", "utf8");
    await fs.writeFile(envSourcePath, "FOO=bar\n", "utf8");
    await fs.writeFile(luigiConfigPath, "[core]\nno_configure_logging=true\n", "utf8");

    const operatorCreateResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "operator-project",
        connection: {
          accessMode: "operator",
          projectRootDir: operatorProjectRootDir,
          pythonExecutable: process.execPath,
          entrypointPath: "main.py",
          workspaceDirectory: operatorWorkspaceDir,
          luigiConfigPath,
          envSourcePath,
          schedulerBaseUrl: "http://127.0.0.1:65534",
        },
      },
    });

    assert.equal(operatorCreateResponse.statusCode, 201);
    const operatorProject = operatorCreateResponse.json();
    assert.equal(operatorProject.connection.accessMode, "operator");
    assert.equal(operatorProject.capabilities.canRun, true);

    const operatorValidateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/validate`,
    });

    assert.equal(operatorValidateResponse.statusCode, 200);
    const operatorValidation = operatorValidateResponse.json();
    assert.equal(operatorValidation.resolvedCapabilities.canRun, true);
    assert.equal(operatorValidation.resolvedCapabilities.canEditProfiles, true);
    assert.ok(
      operatorValidation.issues.some(
        (issue: { code: string }) =>
          issue.code === "scheduler_unreachable" || issue.code === "scheduler_default_used",
      ),
    );

    const baseProfileResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/profiles`,
      payload: {
        kind: "config",
        name: "base-config",
        values: {
          FOO: "base",
          BAR: "from-base",
        },
        maskedKeys: ["SECRET_TOKEN"],
        isDefault: false,
        enabledForModes: ["operator", "managed"],
      },
    });

    assert.equal(baseProfileResponse.statusCode, 201);
    const baseProfile = baseProfileResponse.json();

    const childProfileResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${operatorProject.id}/profiles`,
      payload: {
        kind: "config",
        name: "child-config",
        extendsProfileId: baseProfile.id,
        values: {
          FOO: "child",
        },
        maskedKeys: ["OTHER_SECRET"],
        isDefault: false,
        enabledForModes: ["operator"],
      },
    });

    assert.equal(childProfileResponse.statusCode, 201);
    const childProfile = childProfileResponse.json();

    const resolveProfileResponse = await app.inject({
      method: "POST",
      url: `/api/profiles/${childProfile.id}/resolve`,
    });

    assert.equal(resolveProfileResponse.statusCode, 200);
    const resolvedProfile = resolveProfileResponse.json();
    assert.deepEqual(resolvedProfile.values, {
      FOO: "child",
      BAR: "from-base",
    });
    assert.deepEqual(resolvedProfile.maskedKeys, ["OTHER_SECRET", "SECRET_TOKEN"]);

    const projectsResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
    });

    assert.equal(projectsResponse.statusCode, 200);
    const projects = projectsResponse.json();
    assert.equal(projects.length, 2);
  } finally {
    await app.close();
    await fs.rm(testRootDir, { recursive: true, force: true });
  }
});
