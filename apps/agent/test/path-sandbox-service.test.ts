import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PathSandboxService } from "../src/services/path-sandbox-service";
import { removeDirectoryWithRetries } from "./helpers/cleanup";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

test("path sandbox enforces symlink policy for workspace, project root, and config/env paths", async () => {
  const tempRootDir = await createTempDirectory("gokart-station-path-sandbox-");
  const sandboxService = new PathSandboxService();

  try {
    const realWorkspaceDirectory = path.join(tempRootDir, "real-workspace");
    const realProjectParentDirectory = path.join(tempRootDir, "real-project-parent");
    const realProjectRootDirectory = path.join(realProjectParentDirectory, "project");
    const realConfigParentDirectory = path.join(tempRootDir, "real-config-parent");
    const workspaceSymlinkPath = path.join(tempRootDir, "workspace-link");
    const projectParentSymlinkPath = path.join(tempRootDir, "project-parent-link");
    const configParentSymlinkPath = path.join(tempRootDir, "config-parent-link");

    await fs.mkdir(realWorkspaceDirectory, {
      recursive: true,
    });
    await fs.mkdir(realProjectRootDirectory, {
      recursive: true,
    });
    await fs.mkdir(realConfigParentDirectory, {
      recursive: true,
    });
    await fs.writeFile(path.join(realProjectRootDirectory, "main.py"), "print('hello')\n", "utf8");
    await fs.writeFile(path.join(realConfigParentDirectory, ".env"), "FOO=bar\n", "utf8");

    await fs.symlink(realWorkspaceDirectory, workspaceSymlinkPath, "dir");
    await fs.symlink(realProjectParentDirectory, projectParentSymlinkPath, "dir");
    await fs.symlink(realConfigParentDirectory, configParentSymlinkPath, "dir");

    const workspaceSymlinkIssues = await sandboxService.validateConnection({
      accessMode: "observer",
      workspaceDirectory: workspaceSymlinkPath,
    });
    assert.ok(
      workspaceSymlinkIssues.some(
        (issue) => issue.field === "workspaceDirectory" && issue.code === "symlink_not_allowed",
      ),
    );

    const allowedWorkspaceIssues = await sandboxService.validateConnection({
      accessMode: "observer",
      workspaceDirectory: workspaceSymlinkPath,
      allowWorkspaceDirectorySymlink: true,
    });
    assert.equal(
      allowedWorkspaceIssues.some((issue) => issue.field === "workspaceDirectory"),
      false,
    );

    const allowedWorkspaceScopes = await sandboxService.resolveScopes({
      accessMode: "observer",
      workspaceDirectory: workspaceSymlinkPath,
      allowWorkspaceDirectorySymlink: true,
    });
    assert.equal(allowedWorkspaceScopes.length, 1);
    assert.equal(allowedWorkspaceScopes[0]?.key, "workspace");
    assert.equal(allowedWorkspaceScopes[0]?.realPath, await fs.realpath(realWorkspaceDirectory));

    const projectRootAncestorSymlinkIssues = await sandboxService.validateConnection({
      accessMode: "operator",
      projectRootDir: path.join(projectParentSymlinkPath, "project"),
      pythonExecutable: process.execPath,
      entrypointPath: "main.py",
      workspaceDirectory: realWorkspaceDirectory,
    });
    assert.ok(
      projectRootAncestorSymlinkIssues.some(
        (issue) => issue.field === "projectRootDir" && issue.code === "symlink_not_allowed",
      ),
    );

    const envSourceAncestorSymlinkIssues = await sandboxService.validateConnection({
      accessMode: "operator",
      projectRootDir: realProjectRootDirectory,
      pythonExecutable: process.execPath,
      entrypointPath: "main.py",
      workspaceDirectory: realWorkspaceDirectory,
      envSourcePath: path.join(configParentSymlinkPath, ".env"),
    });
    assert.ok(
      envSourceAncestorSymlinkIssues.some(
        (issue) => issue.field === "envSourcePath" && issue.code === "symlink_not_allowed",
      ),
    );
  } finally {
    await removeDirectoryWithRetries(tempRootDir);
  }
});
