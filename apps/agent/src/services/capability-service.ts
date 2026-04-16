import type {
  AccessMode,
  CapabilitySet,
  ProjectConnection,
  ProjectValidationResult,
  ValidationIssue,
} from "@gokart-station/shared";

const hasErrorForField = (issues: ValidationIssue[], field: string) => {
  return issues.some((issue) => issue.level === "error" && issue.field === field);
};

export class CapabilityService {
  getBaseCapabilities(accessMode: AccessMode): CapabilitySet {
    if (accessMode === "observer") {
      return {
        canReadWorkspace: true,
        canReadArtifacts: true,
        canRun: false,
        canStop: false,
        canRerun: false,
        canEditProfiles: false,
        canManageScheduler: false,
        canInstallAdapter: false,
      };
    }

    if (accessMode === "operator") {
      return {
        canReadWorkspace: true,
        canReadArtifacts: true,
        canRun: true,
        canStop: true,
        canRerun: true,
        canEditProfiles: true,
        canManageScheduler: true,
        canInstallAdapter: false,
      };
    }

    return {
      canReadWorkspace: true,
      canReadArtifacts: true,
      canRun: true,
      canStop: true,
      canRerun: true,
      canEditProfiles: true,
      canManageScheduler: true,
      canInstallAdapter: true,
    };
  }

  resolveCapabilities(connection: ProjectConnection, issues: ValidationIssue[]): CapabilitySet {
    const base = this.getBaseCapabilities(connection.accessMode);
    const workspaceReadable = !hasErrorForField(issues, "workspaceDirectory");
    const runReady =
      workspaceReadable &&
      !hasErrorForField(issues, "projectRootDir") &&
      !hasErrorForField(issues, "pythonExecutable") &&
      !hasErrorForField(issues, "entrypointPath");

    return {
      canReadWorkspace: base.canReadWorkspace && workspaceReadable,
      canReadArtifacts: base.canReadArtifacts && workspaceReadable,
      canRun: base.canRun && runReady,
      canStop: base.canStop && runReady,
      canRerun: base.canRerun && runReady,
      canEditProfiles: base.canEditProfiles,
      canManageScheduler: base.canManageScheduler,
      canInstallAdapter: base.canInstallAdapter,
    };
  }

  buildValidationResult(
    connection: ProjectConnection,
    issues: ValidationIssue[],
    schedulerHealth: ProjectValidationResult["schedulerHealth"],
  ): ProjectValidationResult {
    const resolvedCapabilities = this.resolveCapabilities(connection, issues);
    const ok = issues.every((issue) => issue.level !== "error");

    return {
      ok,
      issues,
      schedulerHealth,
      resolvedCapabilities,
    };
  }
}
