import type {
  AccessMode,
  CapabilitySet,
  CreateProjectRequest,
  Project,
  ProjectConnection,
  UpdateProjectRequest,
} from "@gokart-station/shared";
import type { Prisma, PrismaClient } from "@prisma/client";

const projectInclude = {
  connection: true,
  capabilitySnapshots: {
    orderBy: { capturedAt: "desc" },
    take: 1,
  },
} satisfies Prisma.ProjectInclude;

type ProjectRecord = Prisma.ProjectGetPayload<{
  include: typeof projectInclude;
}>;

type ProjectConnectionRecord = Prisma.ProjectGetPayload<{
  include: {
    connection: true;
  };
}>;

type CapabilitySnapshotRecord = ProjectRecord["capabilitySnapshots"][number];

const mapCapabilitySnapshot = (
  snapshot: CapabilitySnapshotRecord | undefined,
): CapabilitySet | null => {
  if (!snapshot) {
    return null;
  }

  return {
    canReadWorkspace: snapshot.canReadWorkspace,
    canReadArtifacts: snapshot.canReadArtifacts,
    canRun: snapshot.canRun,
    canStop: snapshot.canStop,
    canRerun: snapshot.canRerun,
    canEditProfiles: snapshot.canEditProfiles,
    canManageScheduler: snapshot.canManageScheduler,
    canInstallAdapter: snapshot.canInstallAdapter,
  };
};

const mapProjectConnection = (
  connection: NonNullable<ProjectConnectionRecord["connection"]>,
): ProjectConnection => {
  return {
    accessMode: connection.accessMode as AccessMode,
    projectRootDir: connection.projectRootDir,
    pythonExecutable: connection.pythonExecutable,
    entrypointPath: connection.entrypointPath,
    workspaceDirectory: connection.workspaceDirectory,
    luigiConfigPath: connection.luigiConfigPath,
    envSourcePath: connection.envSourcePath,
    schedulerBaseUrl: connection.schedulerBaseUrl,
  };
};

const mapProjectRecord = (
  record: ProjectRecord,
  fallbackCapabilities: CapabilitySet,
): Project | null => {
  if (!record.connection) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    connection: mapProjectConnection(record.connection),
    capabilities: mapCapabilitySnapshot(record.capabilitySnapshots[0]) ?? fallbackCapabilities,
    defaultConfigProfileId: record.defaultConfigProfileId,
    defaultEnvProfileId: record.defaultEnvProfileId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
};

const toConnectionCreateInput = (
  connection: CreateProjectRequest["connection"] | ProjectConnection,
) => ({
  accessMode: connection.accessMode,
  ...(connection.projectRootDir !== undefined ? { projectRootDir: connection.projectRootDir } : {}),
  ...(connection.pythonExecutable !== undefined
    ? { pythonExecutable: connection.pythonExecutable }
    : {}),
  ...(connection.entrypointPath !== undefined ? { entrypointPath: connection.entrypointPath } : {}),
  workspaceDirectory: connection.workspaceDirectory,
  ...(connection.luigiConfigPath !== undefined
    ? { luigiConfigPath: connection.luigiConfigPath }
    : {}),
  ...(connection.envSourcePath !== undefined ? { envSourcePath: connection.envSourcePath } : {}),
  ...(connection.schedulerBaseUrl !== undefined
    ? { schedulerBaseUrl: connection.schedulerBaseUrl }
    : {}),
});

export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(fallbackCapabilityResolver: (accessMode: AccessMode) => CapabilitySet) {
    const records = await this.prisma.project.findMany({
      include: projectInclude,
      orderBy: { createdAt: "asc" },
    });

    return records
      .map((record) =>
        mapProjectRecord(
          record,
          fallbackCapabilityResolver((record.connection?.accessMode ?? "observer") as AccessMode),
        ),
      )
      .filter((project): project is Project => project !== null);
  }

  async getById(
    projectId: string,
    fallbackCapabilityResolver: (accessMode: AccessMode) => CapabilitySet,
  ) {
    const record = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: projectInclude,
    });

    if (!record) {
      return null;
    }

    return mapProjectRecord(
      record,
      fallbackCapabilityResolver((record.connection?.accessMode ?? "observer") as AccessMode),
    );
  }

  async getConnectionById(projectId: string) {
    const record = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        connection: true,
      },
    });

    if (!record?.connection) {
      return null;
    }

    return {
      id: record.id,
      name: record.name,
      defaultConfigProfileId: record.defaultConfigProfileId,
      defaultEnvProfileId: record.defaultEnvProfileId,
      connection: mapProjectConnection(record.connection),
    };
  }

  async create(
    input: CreateProjectRequest,
    fallbackCapabilityResolver: (accessMode: AccessMode) => CapabilitySet,
  ) {
    const record = await this.prisma.project.create({
      data: {
        name: input.name,
        ...(input.defaultConfigProfileId !== undefined
          ? { defaultConfigProfileId: input.defaultConfigProfileId }
          : {}),
        ...(input.defaultEnvProfileId !== undefined
          ? { defaultEnvProfileId: input.defaultEnvProfileId }
          : {}),
        connection: {
          create: toConnectionCreateInput(input.connection),
        },
      },
      include: projectInclude,
    });

    const project = mapProjectRecord(
      record,
      fallbackCapabilityResolver(input.connection.accessMode),
    );

    if (!project) {
      throw new Error("Project connection was not created.");
    }

    return project;
  }

  async update(
    projectId: string,
    input: UpdateProjectRequest,
    fallbackCapabilityResolver: (accessMode: AccessMode) => CapabilitySet,
  ) {
    const existing = await this.getConnectionById(projectId);
    if (!existing) {
      return null;
    }

    const mergedConnection: ProjectConnection = {
      accessMode: input.connection?.accessMode ?? existing.connection.accessMode,
      projectRootDir:
        input.connection?.projectRootDir ?? existing.connection.projectRootDir ?? null,
      pythonExecutable:
        input.connection?.pythonExecutable ?? existing.connection.pythonExecutable ?? null,
      entrypointPath:
        input.connection?.entrypointPath ?? existing.connection.entrypointPath ?? null,
      workspaceDirectory:
        input.connection?.workspaceDirectory ?? existing.connection.workspaceDirectory,
      luigiConfigPath:
        input.connection?.luigiConfigPath ?? existing.connection.luigiConfigPath ?? null,
      envSourcePath: input.connection?.envSourcePath ?? existing.connection.envSourcePath ?? null,
      schedulerBaseUrl:
        input.connection?.schedulerBaseUrl ?? existing.connection.schedulerBaseUrl ?? null,
    };

    const record = await this.prisma.$transaction(async (tx) => {
      const updatedProject = await tx.project.update({
        where: { id: projectId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.defaultConfigProfileId !== undefined
            ? { defaultConfigProfileId: input.defaultConfigProfileId }
            : {}),
          ...(input.defaultEnvProfileId !== undefined
            ? { defaultEnvProfileId: input.defaultEnvProfileId }
            : {}),
          connection: {
            update: toConnectionCreateInput(mergedConnection),
          },
        },
        include: projectInclude,
      });

      await tx.capabilitySnapshot.deleteMany({
        where: { projectId },
      });

      return updatedProject;
    });

    return mapProjectRecord(record, fallbackCapabilityResolver(mergedConnection.accessMode));
  }

  async delete(projectId: string) {
    await this.prisma.project.delete({
      where: { id: projectId },
    });
  }
}
