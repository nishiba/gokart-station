import type {
  AccessMode,
  AdapterArtifactPayload,
  AdapterTaskDiscoveredPayload,
  ArtifactKind,
  ArtifactManifestEntry,
  LogEvent,
  LogStream,
  Run,
  RunSpec,
  RunStatus,
  SchedulerSnapshot,
  StopMode,
  TaskGraph,
  TaskGraphEdge,
  TaskGraphNode,
  TaskLineageNode,
  TaskState,
  TimelineEvent,
  TimelineEventType,
} from "@gokart-station/shared";
import type { Prisma, PrismaClient, RunControlActionType, SchedulerHealth } from "@prisma/client";

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value) as T;
};

const runInclude = {
  spec: true,
} satisfies Prisma.RunInclude;

type RunRecord = Prisma.RunGetPayload<{
  include: typeof runInclude;
}>;

const mapRunSpec = (record: RunRecord["spec"]): RunSpec => {
  return {
    rootTaskName: record.rootTaskName,
    label: record.label,
    parameters: parseJson<Record<string, RunSpec["parameters"][string]>>(record.parametersJson, {}),
    configProfileId: record.configProfileId,
    envProfileId: record.envProfileId,
    rerunMode: record.rerunMode,
    workerCount: record.workerCount,
    captureTaskInfoTree: record.captureTaskInfoTree,
    captureTaskInfoTable: record.captureTaskInfoTable,
    captureArtifactManifest: record.captureArtifactManifest,
  };
};

const mapRun = (record: RunRecord): Run => {
  return {
    id: record.id,
    projectId: record.projectId,
    spec: mapRunSpec(record.spec),
    accessMode: record.accessMode as AccessMode,
    status: record.status as RunStatus,
    exitCode: record.exitCode,
    stopMode: (record.stopMode as StopMode | null) ?? null,
    adapterPid: record.adapterPid,
    processGroupId: record.processGroupId,
    schedulerTaskId: record.schedulerTaskId,
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    errorSummary: record.errorSummary,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
};

const mapLogEvent = (
  record: Awaited<ReturnType<PrismaClient["logEvent"]["findFirstOrThrow"]>>,
): LogEvent => {
  return {
    runId: record.runId,
    stream: record.stream as LogStream,
    line: record.line,
    at: record.at.toISOString(),
  };
};

const mapTimelineEvent = (
  record: Awaited<ReturnType<PrismaClient["timelineEvent"]["findFirstOrThrow"]>>,
): TimelineEvent => {
  return {
    id: record.id,
    runId: record.runId,
    type: record.type as TimelineEventType,
    message: record.message,
    at: record.at.toISOString(),
    payload: parseJson<unknown>(record.payloadJson, undefined),
  };
};

const mapSchedulerSnapshot = (
  record: Awaited<ReturnType<PrismaClient["schedulerSnapshot"]["findFirstOrThrow"]>>,
): SchedulerSnapshot => {
  return {
    id: record.id,
    runId: record.runId,
    projectId: record.projectId,
    health: record.health as SchedulerSnapshot["health"],
    activeTaskCount: record.activeTaskCount,
    pendingTaskCount: record.pendingTaskCount,
    failedTaskCount: record.failedTaskCount,
    workerCount: record.workerCount,
    raw: parseJson<unknown>(record.rawJson, {}),
    capturedAt: record.capturedAt.toISOString(),
  };
};

const mapArtifact = (
  record: Awaited<ReturnType<PrismaClient["artifactManifestEntry"]["findFirstOrThrow"]>>,
): ArtifactManifestEntry => {
  return {
    id: record.id,
    projectId: record.projectId,
    runId: record.runId,
    taskNodeId: record.taskNodeId,
    kind: record.kind as ArtifactKind,
    absolutePath: record.absolutePath,
    relativePath: record.relativePath,
    sizeBytes: record.sizeBytes,
    mimeType: record.mimeType,
    previewable: record.previewable,
    modifiedAt: record.modifiedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
};

const mapTaskLineageNode = (
  record: Awaited<ReturnType<PrismaClient["taskLineageNode"]["findFirstOrThrow"]>>,
): TaskLineageNode => {
  return {
    id: record.id,
    runId: record.runId,
    taskName: record.taskName,
    uniqueId: record.uniqueId,
    state: record.state as TaskState,
    parameters: parseJson<Record<string, unknown>>(record.parametersJson, {}),
    outputs: parseJson<string[]>(record.outputsJson, []),
    processingTimeSec: record.processingTimeSec,
    taskLog: parseJson<Record<string, unknown> | null>(record.taskLogJson, null),
    rerunReason: record.rerunReason,
    codeVersionHint: record.codeVersionHint,
    upstreamNodeIds: parseJson<string[]>(record.upstreamNodeIdsJson, []),
    downstreamNodeIds: parseJson<string[]>(record.downstreamNodeIdsJson, []),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
};

const mapTaskGraphEdge = (
  record: Awaited<ReturnType<PrismaClient["taskGraphEdge"]["findFirstOrThrow"]>>,
): TaskGraphEdge => {
  return {
    id: record.id,
    source: record.sourceTaskNodeId,
    target: record.targetTaskNodeId,
  };
};

type RunStatusUpdate = {
  status?: RunStatus;
  exitCode?: number | null;
  stopMode?: StopMode | null;
  adapterPid?: number | null;
  processGroupId?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorSummary?: string | null;
};

type TimelineCreateInput = {
  runId: string;
  type: TimelineEventType;
  message: string;
  at: string;
  payload?: unknown;
};

type SchedulerSnapshotCreateInput = {
  projectId: string;
  runId: string;
  health: SchedulerHealth;
  activeTaskCount: number;
  pendingTaskCount: number;
  failedTaskCount: number;
  workerCount: number;
  raw: unknown;
  capturedAt: string;
};

type LogEventCreateInput = {
  runId: string;
  stream: LogStream;
  line: string;
  at: string;
};

type ListLogsOptions = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
};

type TaskInfoTableEntry = {
  taskName: string;
  uniqueId: string;
  state: TaskState;
  parameters?: Record<string, unknown>;
  outputs?: string[];
  processingTimeSec?: number | null;
  taskLog?: Record<string, unknown> | null;
  rerunReason?: string | null;
  codeVersionHint?: string | null;
  upstreamUniqueIds?: string[];
  downstreamUniqueIds?: string[];
};

export class RunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProjectId(projectId: string) {
    const records = await this.prisma.run.findMany({
      where: { projectId },
      include: runInclude,
      orderBy: [{ createdAt: "desc" }],
    });

    return records.map(mapRun);
  }

  async getById(runId: string) {
    const record = await this.prisma.run.findUnique({
      where: { id: runId },
      include: runInclude,
    });

    return record ? mapRun(record) : null;
  }

  async create(projectId: string, accessMode: AccessMode, spec: RunSpec) {
    const record = await this.prisma.$transaction(async (tx) => {
      const runSpec = await tx.runSpec.create({
        data: {
          projectId,
          configProfileId: spec.configProfileId ?? null,
          envProfileId: spec.envProfileId ?? null,
          rootTaskName: spec.rootTaskName,
          label: spec.label ?? null,
          parametersJson: JSON.stringify(spec.parameters),
          rerunMode: spec.rerunMode,
          workerCount: spec.workerCount ?? null,
          captureTaskInfoTree: spec.captureTaskInfoTree,
          captureTaskInfoTable: spec.captureTaskInfoTable,
          captureArtifactManifest: spec.captureArtifactManifest,
        },
      });

      return tx.run.create({
        data: {
          projectId,
          runSpecId: runSpec.id,
          accessMode,
          status: "queued",
        },
        include: runInclude,
      });
    });

    return mapRun(record);
  }

  async updateStatus(runId: string, input: RunStatusUpdate) {
    const record = await this.prisma.run.update({
      where: { id: runId },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.stopMode !== undefined ? { stopMode: input.stopMode } : {}),
        ...(input.adapterPid !== undefined ? { adapterPid: input.adapterPid } : {}),
        ...(input.processGroupId !== undefined ? { processGroupId: input.processGroupId } : {}),
        ...(input.startedAt !== undefined
          ? { startedAt: input.startedAt ? new Date(input.startedAt) : null }
          : {}),
        ...(input.finishedAt !== undefined
          ? { finishedAt: input.finishedAt ? new Date(input.finishedAt) : null }
          : {}),
        ...(input.errorSummary !== undefined ? { errorSummary: input.errorSummary } : {}),
      },
      include: runInclude,
    });

    return mapRun(record);
  }

  async createControlAction(
    projectId: string,
    type: RunControlActionType,
    payload: unknown,
    runId?: string,
    stopMode?: StopMode,
  ) {
    await this.prisma.runControlAction.create({
      data: {
        projectId,
        runId: runId ?? null,
        type,
        stopMode: stopMode ?? null,
        payloadJson: JSON.stringify(payload ?? {}),
      },
    });
  }

  async listLogs(runId: string, options: ListLogsOptions = {}) {
    const records = await this.prisma.logEvent.findMany({
      where: { runId },
      orderBy:
        options.order === "desc"
          ? [{ at: "desc" }, { id: "desc" }]
          : [{ at: "asc" }, { id: "asc" }],
      ...(options.offset !== undefined ? { skip: options.offset } : {}),
      ...(options.limit !== undefined ? { take: options.limit } : {}),
    });

    return records.map(mapLogEvent);
  }

  async createLogEvent(input: LogEventCreateInput) {
    const record = await this.prisma.logEvent.create({
      data: {
        runId: input.runId,
        stream: input.stream,
        line: input.line,
        at: new Date(input.at),
      },
    });

    return mapLogEvent(record);
  }

  async listTimeline(runId: string) {
    const records = await this.prisma.timelineEvent.findMany({
      where: { runId },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });

    return records.map(mapTimelineEvent);
  }

  async createTimelineEvent(input: TimelineCreateInput) {
    const record = await this.prisma.timelineEvent.create({
      data: {
        runId: input.runId,
        type: input.type,
        message: input.message,
        at: new Date(input.at),
        payloadJson: input.payload === undefined ? null : JSON.stringify(input.payload),
      },
    });

    return mapTimelineEvent(record);
  }

  async listSchedulerSnapshots(runId: string) {
    const records = await this.prisma.schedulerSnapshot.findMany({
      where: { runId },
      orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
    });

    return records.map(mapSchedulerSnapshot);
  }

  async listLineage(runId: string) {
    const records = await this.prisma.taskLineageNode.findMany({
      where: { runId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return records.map(mapTaskLineageNode);
  }

  async getLineageNode(taskNodeId: string) {
    const record = await this.prisma.taskLineageNode.findUnique({
      where: { id: taskNodeId },
    });

    return record ? mapTaskLineageNode(record) : null;
  }

  async getLineageNodeByRunAndUniqueId(runId: string, uniqueId: string) {
    const record = await this.prisma.taskLineageNode.findFirst({
      where: {
        runId,
        uniqueId,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return record ? mapTaskLineageNode(record) : null;
  }

  async listArtifacts(runId: string) {
    const records = await this.prisma.artifactManifestEntry.findMany({
      where: { runId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return records.map(mapArtifact);
  }

  async getArtifactById(artifactId: string) {
    const record = await this.prisma.artifactManifestEntry.findUnique({
      where: { id: artifactId },
    });

    return record ? mapArtifact(record) : null;
  }

  async getGraph(runId: string): Promise<TaskGraph> {
    const [nodeRecords, edgeRecords] = await Promise.all([
      this.prisma.taskLineageNode.findMany({
        where: { runId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.taskGraphEdge.findMany({
        where: { runId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    const nodes: TaskGraphNode[] = nodeRecords.map((record) => ({
      id: record.id,
      taskName: record.taskName,
      uniqueId: record.uniqueId,
      state: record.state as TaskState,
      processingTimeSec: record.processingTimeSec,
    }));

    const edges = edgeRecords.map(mapTaskGraphEdge);
    return {
      runId,
      nodes,
      edges,
    };
  }

  async createSchedulerSnapshot(input: SchedulerSnapshotCreateInput) {
    const record = await this.prisma.schedulerSnapshot.create({
      data: {
        projectId: input.projectId,
        runId: input.runId,
        health: input.health,
        activeTaskCount: input.activeTaskCount,
        pendingTaskCount: input.pendingTaskCount,
        failedTaskCount: input.failedTaskCount,
        workerCount: input.workerCount,
        rawJson: JSON.stringify(input.raw ?? {}),
        capturedAt: new Date(input.capturedAt),
      },
    });

    return mapSchedulerSnapshot(record);
  }

  async findPreviousSuccessfulRun(
    projectId: string,
    rootTaskName: string,
    beforeCreatedAt: string,
  ) {
    const record = await this.prisma.run.findFirst({
      where: {
        projectId,
        status: "success",
        createdAt: {
          lt: new Date(beforeCreatedAt),
        },
        spec: {
          is: {
            rootTaskName,
          },
        },
      },
      include: runInclude,
      orderBy: [{ createdAt: "desc" }],
    });

    return record ? mapRun(record) : null;
  }

  async findLineageNodeByRunAndTaskName(runId: string, taskName: string) {
    const record = await this.prisma.taskLineageNode.findFirst({
      where: {
        runId,
        taskName,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return record ? mapTaskLineageNode(record) : null;
  }

  async upsertTaskDiscovered(runId: string, task: AdapterTaskDiscoveredPayload) {
    const existing = await this.prisma.taskLineageNode.findFirst({
      where: {
        runId,
        uniqueId: task.uniqueId,
      },
    });

    if (existing) {
      await this.prisma.taskLineageNode.update({
        where: { id: existing.id },
        data: {
          taskName: task.taskName,
          state: task.state as TaskState,
          parametersJson: JSON.stringify(task.parameters ?? {}),
          outputsJson: JSON.stringify(task.outputs ?? []),
          processingTimeSec: task.processingTimeSec ?? null,
          upstreamNodeIdsJson: JSON.stringify(task.upstreamUniqueIds ?? []),
          downstreamNodeIdsJson: JSON.stringify(task.downstreamUniqueIds ?? []),
        },
      });
      return existing.id;
    }

    const created = await this.prisma.taskLineageNode.create({
      data: {
        runId,
        taskName: task.taskName,
        uniqueId: task.uniqueId,
        state: task.state as TaskState,
        parametersJson: JSON.stringify(task.parameters ?? {}),
        outputsJson: JSON.stringify(task.outputs ?? []),
        processingTimeSec: task.processingTimeSec ?? null,
        upstreamNodeIdsJson: JSON.stringify(task.upstreamUniqueIds ?? []),
        downstreamNodeIdsJson: JSON.stringify(task.downstreamUniqueIds ?? []),
      },
    });

    return created.id;
  }

  async syncTaskInfoTable(runId: string, entries: TaskInfoTableEntry[]) {
    await this.prisma.$transaction(async (tx) => {
      const existingNodes = await tx.taskLineageNode.findMany({
        where: { runId },
      });
      const existingNodeByUniqueId = new Map(existingNodes.map((node) => [node.uniqueId, node]));
      const nodeIdByUniqueId = new Map<string, string>();

      for (const entry of entries) {
        const existingNode = existingNodeByUniqueId.get(entry.uniqueId);
        if (existingNode) {
          const updatedNode = await tx.taskLineageNode.update({
            where: { id: existingNode.id },
            data: {
              taskName: entry.taskName,
              state: entry.state,
              parametersJson: JSON.stringify(entry.parameters ?? {}),
              outputsJson: JSON.stringify(entry.outputs ?? []),
              processingTimeSec: entry.processingTimeSec ?? null,
              taskLogJson:
                entry.taskLog === undefined
                  ? existingNode.taskLogJson
                  : JSON.stringify(entry.taskLog),
              rerunReason: entry.rerunReason ?? null,
              codeVersionHint: entry.codeVersionHint ?? null,
              upstreamNodeIdsJson: existingNode.upstreamNodeIdsJson,
              downstreamNodeIdsJson: existingNode.downstreamNodeIdsJson,
            },
          });
          nodeIdByUniqueId.set(entry.uniqueId, updatedNode.id);
          continue;
        }

        const createdNode = await tx.taskLineageNode.create({
          data: {
            runId,
            taskName: entry.taskName,
            uniqueId: entry.uniqueId,
            state: entry.state,
            parametersJson: JSON.stringify(entry.parameters ?? {}),
            outputsJson: JSON.stringify(entry.outputs ?? []),
            processingTimeSec: entry.processingTimeSec ?? null,
            taskLogJson: entry.taskLog === undefined ? null : JSON.stringify(entry.taskLog),
            rerunReason: entry.rerunReason ?? null,
            codeVersionHint: entry.codeVersionHint ?? null,
            upstreamNodeIdsJson: "[]",
            downstreamNodeIdsJson: "[]",
          },
        });
        nodeIdByUniqueId.set(entry.uniqueId, createdNode.id);
      }

      for (const entry of entries) {
        const nodeId = nodeIdByUniqueId.get(entry.uniqueId);
        if (!nodeId) {
          continue;
        }

        const upstreamNodeIds = (entry.upstreamUniqueIds ?? [])
          .map((uniqueId) => nodeIdByUniqueId.get(uniqueId))
          .filter((value): value is string => value !== undefined);
        const downstreamNodeIds = (entry.downstreamUniqueIds ?? [])
          .map((uniqueId) => nodeIdByUniqueId.get(uniqueId))
          .filter((value): value is string => value !== undefined);

        await tx.taskLineageNode.update({
          where: { id: nodeId },
          data: {
            upstreamNodeIdsJson: JSON.stringify(upstreamNodeIds),
            downstreamNodeIdsJson: JSON.stringify(downstreamNodeIds),
          },
        });
      }

      await tx.taskGraphEdge.deleteMany({
        where: { runId },
      });

      const createdEdgeKeys = new Set<string>();
      for (const entry of entries) {
        const targetNodeId = nodeIdByUniqueId.get(entry.uniqueId);
        if (!targetNodeId) {
          continue;
        }

        for (const upstreamUniqueId of entry.upstreamUniqueIds ?? []) {
          const sourceNodeId = nodeIdByUniqueId.get(upstreamUniqueId);
          if (!sourceNodeId) {
            continue;
          }

          const edgeKey = `${sourceNodeId}->${targetNodeId}`;
          if (createdEdgeKeys.has(edgeKey)) {
            continue;
          }
          createdEdgeKeys.add(edgeKey);

          await tx.taskGraphEdge.create({
            data: {
              runId,
              sourceTaskNodeId: sourceNodeId,
              targetTaskNodeId: targetNodeId,
            },
          });
        }
      }
    });
  }

  async upsertTaskState(
    runId: string,
    task: {
      taskName: string;
      uniqueId: string;
      state: TaskState;
    },
  ) {
    const existing = await this.prisma.taskLineageNode.findFirst({
      where: {
        runId,
        uniqueId: task.uniqueId,
      },
    });

    if (existing) {
      const updated = await this.prisma.taskLineageNode.update({
        where: { id: existing.id },
        data: {
          taskName: task.taskName,
          state: task.state,
        },
      });
      return updated.id;
    }

    const created = await this.prisma.taskLineageNode.create({
      data: {
        runId,
        taskName: task.taskName,
        uniqueId: task.uniqueId,
        state: task.state,
      },
    });
    return created.id;
  }

  async createArtifact(
    projectId: string,
    runId: string,
    artifact: AdapterArtifactPayload & {
      taskNodeId?: string | null;
    },
  ) {
    const record = await this.prisma.artifactManifestEntry.create({
      data: {
        projectId,
        runId,
        taskNodeId: artifact.taskNodeId ?? null,
        kind: artifact.kind,
        absolutePath: artifact.absolutePath,
        relativePath: artifact.relativePath,
        sizeBytes: artifact.sizeBytes ?? null,
        mimeType: artifact.mimeType ?? null,
        previewable: artifact.previewable,
      },
    });

    return mapArtifact(record);
  }
}
