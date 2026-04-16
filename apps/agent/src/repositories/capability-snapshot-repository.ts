import type {
  CapabilitySet,
  ProjectValidationResult,
  SchedulerHealth,
  ValidationIssue,
} from "@gokart-station/shared";
import type { PrismaClient } from "@prisma/client";

type CapabilitySnapshotRecord = Awaited<
  ReturnType<PrismaClient["capabilitySnapshot"]["findFirstOrThrow"]>
>;

const parseIssues = (issuesJson: string): ValidationIssue[] => {
  return JSON.parse(issuesJson) as ValidationIssue[];
};

const mapResolvedCapabilities = (record: CapabilitySnapshotRecord): CapabilitySet => {
  return {
    canReadWorkspace: record.canReadWorkspace,
    canReadArtifacts: record.canReadArtifacts,
    canRun: record.canRun,
    canStop: record.canStop,
    canRerun: record.canRerun,
    canEditProfiles: record.canEditProfiles,
    canManageScheduler: record.canManageScheduler,
    canInstallAdapter: record.canInstallAdapter,
  };
};

export class CapabilitySnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(projectId: string, validationResult: ProjectValidationResult) {
    const { resolvedCapabilities } = validationResult;

    await this.prisma.capabilitySnapshot.create({
      data: {
        projectId,
        canReadWorkspace: resolvedCapabilities.canReadWorkspace,
        canReadArtifacts: resolvedCapabilities.canReadArtifacts,
        canRun: resolvedCapabilities.canRun,
        canStop: resolvedCapabilities.canStop,
        canRerun: resolvedCapabilities.canRerun,
        canEditProfiles: resolvedCapabilities.canEditProfiles,
        canManageScheduler: resolvedCapabilities.canManageScheduler,
        canInstallAdapter: resolvedCapabilities.canInstallAdapter,
        schedulerHealth: validationResult.schedulerHealth,
        validationOk: validationResult.ok,
        issuesJson: JSON.stringify(validationResult.issues),
      },
    });
  }

  async getLatest(projectId: string) {
    const record = await this.prisma.capabilitySnapshot.findFirst({
      where: {
        projectId,
      },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });

    if (!record) {
      return null;
    }

    return {
      id: record.id,
      projectId: record.projectId,
      resolvedCapabilities: mapResolvedCapabilities(record),
      schedulerHealth: record.schedulerHealth as SchedulerHealth,
      validationOk: record.validationOk,
      issues: parseIssues(record.issuesJson),
      capturedAt: record.capturedAt.toISOString(),
    };
  }
}
