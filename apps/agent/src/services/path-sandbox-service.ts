import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectConnection, ValidationIssue } from "@gokart-station/shared";

const localSchedulerHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export type SandboxScopeKey = "workspace" | "projectRoot" | "luigiConfigPath" | "envSourcePath";

export type SandboxScope = {
  key: SandboxScopeKey;
  label: string;
  absolutePath: string;
  realPath: string;
  kind: "directory" | "file";
};

const pathExists = async (targetPath: string) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const resolveExistingRealPath = async (targetPath: string) => {
  return fs.realpath(targetPath);
};

const resolveExecutableFromPath = async (executableName: string) => {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of pathEntries) {
    const candidatePath = path.join(entry, executableName);

    try {
      await fs.access(candidatePath, fsConstants.X_OK);
      return candidatePath;
    } catch {}
  }

  return null;
};

const isPathInsideRoot = (rootDir: string, candidatePath: string) => {
  const relativePath = path.relative(rootDir, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const createIssue = (
  code: string,
  message: string,
  level: ValidationIssue["level"],
  field?: string,
): ValidationIssue => {
  return field === undefined
    ? {
        code,
        message,
        level,
      }
    : {
        code,
        message,
        level,
        field,
      };
};

export class PathSandboxService {
  async resolveScopes(connection: ProjectConnection): Promise<SandboxScope[]> {
    const directoryScopes: SandboxScope[] = [];
    const fileScopes: SandboxScope[] = [];

    const workspaceScope = await this.resolveScope("workspace", connection.workspaceDirectory);
    if (workspaceScope) {
      directoryScopes.push(workspaceScope);
    }

    if (connection.accessMode !== "observer" && connection.projectRootDir) {
      const projectRootScope = await this.resolveScope("projectRoot", connection.projectRootDir);
      if (projectRootScope) {
        directoryScopes.push(projectRootScope);
      }
    }

    if (connection.luigiConfigPath) {
      const luigiConfigScope = await this.resolveScope(
        "luigiConfigPath",
        connection.luigiConfigPath,
      );
      if (luigiConfigScope) {
        fileScopes.push(luigiConfigScope);
      }
    }

    if (connection.envSourcePath) {
      const envSourceScope = await this.resolveScope("envSourcePath", connection.envSourcePath);
      if (envSourceScope) {
        fileScopes.push(envSourceScope);
      }
    }

    const uniqueDirectoryScopes = this.dedupeScopes(directoryScopes);
    const scopedFilePaths = fileScopes.filter((scope) => {
      return !uniqueDirectoryScopes.some((directoryScope) =>
        isPathInsideRoot(directoryScope.realPath, scope.realPath),
      );
    });

    return [...uniqueDirectoryScopes, ...this.dedupeScopes(scopedFilePaths)];
  }

  async validateConnection(connection: ProjectConnection) {
    const issues: ValidationIssue[] = [];

    await this.validateDirectory(connection.workspaceDirectory, "workspaceDirectory", issues);
    if (connection.schedulerBaseUrl) {
      this.validateSchedulerBaseUrl(connection.schedulerBaseUrl, issues);
    }

    if (connection.accessMode === "observer") {
      return issues;
    }

    if (!connection.projectRootDir) {
      issues.push(
        createIssue(
          "project_root_required",
          "projectRootDir is required for operator and managed modes.",
          "error",
          "projectRootDir",
        ),
      );
    } else {
      await this.validateDirectory(connection.projectRootDir, "projectRootDir", issues);
    }

    if (!connection.pythonExecutable) {
      issues.push(
        createIssue(
          "python_executable_required",
          "pythonExecutable is required for operator and managed modes.",
          "error",
          "pythonExecutable",
        ),
      );
    } else {
      await this.validateExecutable(connection.pythonExecutable, "pythonExecutable", issues);
    }

    if (!connection.entrypointPath) {
      issues.push(
        createIssue(
          "entrypoint_required",
          "entrypointPath is required for operator and managed modes.",
          "error",
          "entrypointPath",
        ),
      );
    } else if (connection.projectRootDir) {
      await this.validateEntrypointPath(
        connection.projectRootDir,
        connection.entrypointPath,
        issues,
      );
    }

    if (connection.luigiConfigPath) {
      await this.validateFile(connection.luigiConfigPath, "luigiConfigPath", issues);
    }

    if (connection.envSourcePath) {
      await this.validateFile(connection.envSourcePath, "envSourcePath", issues);
    }

    return issues;
  }

  private async validateDirectory(targetPath: string, field: string, issues: ValidationIssue[]) {
    if (!(await pathExists(targetPath))) {
      issues.push(createIssue("path_not_found", `${field} does not exist.`, "error", field));
      return;
    }

    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      issues.push(
        createIssue("path_not_directory", `${field} must be a directory.`, "error", field),
      );
    }
  }

  private async validateFile(targetPath: string, field: string, issues: ValidationIssue[]) {
    if (!(await pathExists(targetPath))) {
      issues.push(createIssue("path_not_found", `${field} does not exist.`, "error", field));
      return;
    }

    const stats = await fs.lstat(targetPath);
    if (stats.isSymbolicLink()) {
      issues.push(
        createIssue("symlink_not_allowed", `${field} must not be a symlink.`, "error", field),
      );
      return;
    }

    const fileStats = await fs.stat(targetPath);
    if (!fileStats.isFile()) {
      issues.push(createIssue("path_not_file", `${field} must be a file.`, "error", field));
    }
  }

  private async validateExecutable(targetPath: string, field: string, issues: ValidationIssue[]) {
    const containsPathSeparator =
      targetPath.includes(path.sep) ||
      (path.sep !== path.posix.sep && targetPath.includes(path.posix.sep));
    const resolvedPath =
      path.isAbsolute(targetPath) || containsPathSeparator
        ? path.resolve(targetPath)
        : await resolveExecutableFromPath(targetPath);

    if (!resolvedPath || !(await pathExists(resolvedPath))) {
      issues.push(
        createIssue(
          "executable_not_found",
          `${field} must point to an installed executable or PATH command.`,
          "error",
          field,
        ),
      );
      return;
    }

    try {
      await fs.access(resolvedPath, fsConstants.X_OK);
    } catch {
      issues.push(
        createIssue("path_not_executable", `${field} must be executable.`, "error", field),
      );
      return;
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      issues.push(createIssue("path_not_file", `${field} must be a file.`, "error", field));
    }
  }

  private async validateEntrypointPath(
    projectRootDir: string,
    entrypointPath: string,
    issues: ValidationIssue[],
  ) {
    const resolvedEntrypointPath = path.isAbsolute(entrypointPath)
      ? entrypointPath
      : path.resolve(projectRootDir, entrypointPath);

    if (!(await pathExists(resolvedEntrypointPath))) {
      issues.push(
        createIssue(
          "entrypoint_not_found",
          "entrypointPath does not exist.",
          "error",
          "entrypointPath",
        ),
      );
      return;
    }

    const [realProjectRootDir, realEntrypointPath] = await Promise.all([
      resolveExistingRealPath(projectRootDir),
      resolveExistingRealPath(resolvedEntrypointPath),
    ]);

    if (!isPathInsideRoot(realProjectRootDir, realEntrypointPath)) {
      issues.push(
        createIssue(
          "entrypoint_outside_project_root",
          "entrypointPath must stay inside projectRootDir.",
          "error",
          "entrypointPath",
        ),
      );
      return;
    }

    const stats = await fs.stat(realEntrypointPath);
    if (!stats.isFile()) {
      issues.push(
        createIssue(
          "entrypoint_not_file",
          "entrypointPath must point to a file.",
          "error",
          "entrypointPath",
        ),
      );
    }
  }

  private validateSchedulerBaseUrl(schedulerBaseUrl: string, issues: ValidationIssue[]) {
    try {
      const parsedUrl = new URL(schedulerBaseUrl);
      const hostname = parsedUrl.hostname.replace(/^\[(.*)\]$/, "$1");

      if (!localSchedulerHosts.has(hostname)) {
        issues.push(
          createIssue(
            "scheduler_not_localhost",
            "schedulerBaseUrl must resolve to localhost.",
            "error",
            "schedulerBaseUrl",
          ),
        );
      }

      if (!parsedUrl.port) {
        issues.push(
          createIssue(
            "scheduler_port_required",
            "schedulerBaseUrl must include an explicit port.",
            "error",
            "schedulerBaseUrl",
          ),
        );
      }

      if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
        issues.push(
          createIssue(
            "scheduler_base_url_must_be_origin",
            "schedulerBaseUrl must be an origin without path, query, or hash.",
            "error",
            "schedulerBaseUrl",
          ),
        );
      }
    } catch {
      issues.push(
        createIssue(
          "scheduler_invalid_url",
          "schedulerBaseUrl must be a valid URL.",
          "error",
          "schedulerBaseUrl",
        ),
      );
    }
  }

  private async resolveScope(
    key: SandboxScopeKey,
    targetPath: string,
  ): Promise<SandboxScope | null> {
    if (!(await pathExists(targetPath))) {
      return null;
    }

    const stats = await fs.lstat(targetPath);
    if (stats.isSymbolicLink() && (key === "luigiConfigPath" || key === "envSourcePath")) {
      return null;
    }

    const realPath = await resolveExistingRealPath(targetPath);
    const resolvedStats = await fs.stat(realPath);
    const expectedKind = key === "workspace" || key === "projectRoot" ? "directory" : "file";
    const actualKind = resolvedStats.isDirectory() ? "directory" : "file";

    if (expectedKind !== actualKind) {
      return null;
    }

    return {
      key,
      label: this.getScopeLabel(key),
      absolutePath: path.resolve(targetPath),
      realPath,
      kind: actualKind,
    };
  }

  private getScopeLabel(key: SandboxScopeKey) {
    switch (key) {
      case "workspace":
        return "workspace";
      case "projectRoot":
        return "projectRoot";
      case "luigiConfigPath":
        return "luigiConfigPath";
      case "envSourcePath":
        return "envSourcePath";
    }
  }

  private dedupeScopes(scopes: SandboxScope[]) {
    const uniqueScopes = new Map<string, SandboxScope>();

    for (const scope of scopes) {
      const uniqueKey = `${scope.kind}:${scope.realPath}`;
      if (!uniqueScopes.has(uniqueKey)) {
        uniqueScopes.set(uniqueKey, scope);
      }
    }

    return [...uniqueScopes.values()];
  }
}
