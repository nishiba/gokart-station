import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import {
  type AdapterEvent,
  type AdapterRunRequest,
  type ArtifactContentByIdResponse,
  adapterEventSchema,
  type CreateRunRequest,
  type GraphResponse,
  type LineageComparePreviousSuccessResponse,
  type Profile,
  type Project,
  type RawAdapterEventsResponse,
  type RawPayloadResponse,
  type RerunRunRequest,
  type Run,
  type RunSpec,
  type RunStatus,
  type RunStreamEvent,
  type StopRunRequest,
  type TaskState,
} from "@gokart-station/shared";
import { defaultRunRuntimeDirectory, runGracefulStopTimeoutMs } from "../config";
import { HttpError } from "../lib/http-errors";
import type { ProfileRepository } from "../repositories/profile-repository";
import type { RunRepository } from "../repositories/run-repository";
import type { AdapterService } from "./adapter-service";
import type { ProjectService } from "./project-service";

type RunServiceOptions = {
  runtimeDirectory?: string;
  gracefulStopTimeoutMs?: number;
};

type GetLogsOptions = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
};

type RunStreamSubscriber = (event: RunStreamEvent) => void;

type ActiveRunContext = {
  runId: string;
  projectId: string;
  child: ChildProcessWithoutNullStreams;
  cleanup: () => Promise<void>;
  persistenceChain: Promise<void>;
  latestRun: Run;
  terminalStatus: RunStatus | null;
  adapterEventsPath: string;
  stderrPath: string;
  rawTaskInfoTreePath: string;
  rawTaskInfoTablePath: string;
  gracefulStopTimer: NodeJS.Timeout | null;
};

const terminalRunStatuses = new Set<RunStatus>(["success", "failed", "canceled"]);
const taskStateValues = new Set<TaskState>([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "DISABLED",
  "UNKNOWN",
  "CANCELED",
]);
const textPreviewByteLimit = 64 * 1024;
type CompareResolution = LineageComparePreviousSuccessResponse["diff"]["compareResolution"];
type CompareResolutionAttempt = CompareResolution["attempts"][number];
type CompareResolutionStrategy = NonNullable<CompareResolution["strategy"]>;
type LineageNodeRecord = LineageComparePreviousSuccessResponse["current"];

const isTerminalRunStatus = (status: RunStatus) => terminalRunStatuses.has(status);
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isTextMimeType = (mimeType: string | null | undefined) => {
  if (!mimeType) {
    return false;
  }

  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/x-ndjson" ||
    mimeType === "application/xml"
  );
};

const isProbablyTextBuffer = (buffer: Buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    if (byte < 9 || (byte > 13 && byte < 32)) {
      return false;
    }
  }

  return true;
};

const buildParameterDiff = (
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, { current?: unknown; previous?: unknown }> => {
  const keys = Array.from(new Set([...Object.keys(current), ...Object.keys(previous)])).sort(
    (left, right) => left.localeCompare(right),
  );

  return Object.fromEntries(
    keys
      .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(previous[key]))
      .map((key) => [
        key,
        {
          current: current[key],
          previous: previous[key],
        },
      ]),
  );
};

const buildOutputPathDiff = (current: string[], previous: string[]) => {
  const currentSet = new Set(current);
  const previousSet = new Set(previous);

  return {
    added: current.filter((pathEntry) => !previousSet.has(pathEntry)),
    removed: previous.filter((pathEntry) => !currentSet.has(pathEntry)),
  };
};

const normalizeComparableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeComparableValue(value[key])]),
    );
  }

  return value;
};

const stableSerialize = (value: unknown) => JSON.stringify(normalizeComparableValue(value));

const buildParameterFingerprint = (parameters: Record<string, unknown>) => {
  return stableSerialize(parameters);
};

const buildOutputPathSignature = (outputs: string[]) => {
  return stableSerialize(outputs.map((outputPath) => path.basename(outputPath)).sort());
};

const buildTopologySignature = (
  node: LineageNodeRecord,
  nodeById: Map<string, LineageNodeRecord>,
) => {
  const upstreamTaskNames = node.upstreamNodeIds
    .map((nodeId) => nodeById.get(nodeId)?.taskName ?? `unknown:${nodeId}`)
    .sort((left, right) => left.localeCompare(right));
  const downstreamTaskNames = node.downstreamNodeIds
    .map((nodeId) => nodeById.get(nodeId)?.taskName ?? `unknown:${nodeId}`)
    .sort((left, right) => left.localeCompare(right));

  return {
    upstream: stableSerialize(upstreamTaskNames),
    downstream: stableSerialize(downstreamTaskNames),
  };
};

const compareResolutionStrategyLabel: Record<CompareResolutionStrategy, string> = {
  task_name_unique_candidate: "single same-task candidate",
  unique_id: "uniqueId",
  parameter_fingerprint: "parameter fingerprint",
  topology_signature: "topology signature",
  output_path_signature: "output path signature",
};

const buildCompareResolutionAttempt = (
  strategy: CompareResolutionStrategy,
  candidates: LineageNodeRecord[],
): CompareResolutionAttempt => {
  return {
    strategy,
    candidateTaskNodeIds: candidates.map((candidate) => candidate.id),
    candidateCount: candidates.length,
  };
};

const buildCompareResolutionEvidence = (
  current: LineageNodeRecord,
  currentNodeById: Map<string, LineageNodeRecord>,
) => {
  const topologySignature = buildTopologySignature(current, currentNodeById);

  return {
    currentUniqueId: current.uniqueId,
    currentParameterFingerprint: buildParameterFingerprint(current.parameters),
    currentUpstreamSignature: topologySignature.upstream,
    currentDownstreamSignature: topologySignature.downstream,
    currentOutputPathSignature: buildOutputPathSignature(current.outputs),
  };
};

const buildEmptyCompareDiff = (compareResolution: CompareResolution) => {
  return {
    parameterDiff: {},
    stateChanged: false,
    processingTimeDiffSec: null,
    outputPathDiff: {
      added: [],
      removed: [],
    },
    compareResolution,
  };
};

const buildCompareResponse = (
  current: LineageNodeRecord,
  previous: LineageNodeRecord | null,
  compareResolution: CompareResolution,
): LineageComparePreviousSuccessResponse => {
  if (!previous) {
    return {
      current,
      previous: null,
      diff: buildEmptyCompareDiff(compareResolution),
    };
  }

  return {
    current,
    previous,
    diff: {
      parameterDiff: buildParameterDiff(current.parameters, previous.parameters),
      stateChanged: current.state !== previous.state,
      processingTimeDiffSec:
        current.processingTimeSec != null && previous.processingTimeSec != null
          ? Number((current.processingTimeSec - previous.processingTimeSec).toFixed(6))
          : null,
      outputPathDiff: buildOutputPathDiff(current.outputs, previous.outputs),
      compareResolution,
    },
  };
};

const sortByDateAscending = (
  leftAt: string,
  rightAt: string,
  leftTieBreaker: string,
  rightTieBreaker: string,
) => {
  const timeDelta = leftAt.localeCompare(rightAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return leftTieBreaker.localeCompare(rightTieBreaker);
};

export class RunService {
  private readonly runtimeDirectory: string;
  private readonly gracefulStopTimeoutMs: number;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly subscribers = new Map<string, Set<RunStreamSubscriber>>();

  constructor(
    private readonly runRepository: RunRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly projectService: ProjectService,
    private readonly adapterService: AdapterService,
    options: RunServiceOptions = {},
  ) {
    this.runtimeDirectory = options.runtimeDirectory ?? defaultRunRuntimeDirectory;
    this.gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? runGracefulStopTimeoutMs;
  }

  async dispose() {
    const activeRunIds = [...this.activeRuns.keys()];
    await Promise.all(
      activeRunIds.map(async (runId) => {
        try {
          await this.stopRun(runId, {
            mode: "force",
          });
        } catch {
          // noop
        }
      }),
    );
  }

  async listRuns(projectId: string) {
    await this.projectService.requireProject(projectId);
    return this.runRepository.listByProjectId(projectId);
  }

  async createRun(projectId: string, input: CreateRunRequest) {
    const project = await this.projectService.requireRunnableProject(projectId);
    const spec = await this.resolveRunSpec(project, input);
    const run = await this.runRepository.create(projectId, project.connection.accessMode, spec);
    const createdAt = new Date().toISOString();

    await this.runRepository.createControlAction(projectId, "run_created", { spec }, run.id);
    const timelineEvent = await this.runRepository.createTimelineEvent({
      runId: run.id,
      type: "run_created",
      message: `Run created for ${spec.rootTaskName}.`,
      at: createdAt,
      payload: {
        spec,
      },
    });

    this.publish(run.id, {
      event: "run",
      data: run,
    });
    this.publish(run.id, {
      event: "timeline",
      data: timelineEvent,
    });

    await this.startRunExecution(run, project);
    return this.getRun(run.id);
  }

  async getRun(runId: string) {
    const run = await this.runRepository.getById(runId);
    if (!run) {
      throw new HttpError(404, "Run not found.");
    }

    return run;
  }

  async stopRun(runId: string, input: StopRunRequest) {
    const run = await this.getRun(runId);
    const project = await this.projectService.requireProject(run.projectId);
    this.projectService.ensureRunStopAllowed(project.connection);

    if (isTerminalRunStatus(run.status)) {
      return run;
    }

    const stopMode = input.mode ?? "graceful";
    const requestedAt = new Date().toISOString();

    await this.runRepository.createControlAction(
      project.id,
      "stop_requested",
      {
        requestedAt,
        mode: stopMode,
      },
      run.id,
      stopMode,
    );

    const updatedRun = await this.runRepository.updateStatus(run.id, {
      status: "stopping",
      stopMode,
    });
    const timelineEvent = await this.runRepository.createTimelineEvent({
      runId: run.id,
      type: "stop_requested",
      message:
        stopMode === "force"
          ? "Force stop requested by station."
          : "Graceful stop requested by station.",
      at: requestedAt,
      payload: {
        mode: stopMode,
      },
    });

    this.publish(run.id, {
      event: "run",
      data: updatedRun,
    });
    this.publish(run.id, {
      event: "timeline",
      data: timelineEvent,
    });

    const context = this.activeRuns.get(run.id);
    if (context) {
      context.latestRun = updatedRun;
      this.clearGracefulStopTimer(context);

      if (stopMode === "force") {
        this.sendSignal(context.child.pid, "SIGKILL");
      } else {
        this.sendSignal(context.child.pid, "SIGTERM");
        context.gracefulStopTimer = setTimeout(() => {
          if (!this.activeRuns.has(context.runId) || context.terminalStatus) {
            return;
          }

          this.sendSignal(context.child.pid, "SIGKILL");
        }, this.gracefulStopTimeoutMs);
      }
    }

    return updatedRun;
  }

  async rerunRun(runId: string, input: RerunRunRequest) {
    const sourceRun = await this.getRun(runId);
    const project = await this.projectService.requireProject(sourceRun.projectId);
    this.projectService.ensureRunRerunAllowed(project.connection);

    const rerunSpecInput: CreateRunRequest = {
      ...sourceRun.spec,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.parameters !== undefined
        ? {
            parameters: {
              ...sourceRun.spec.parameters,
              ...input.parameters,
            },
          }
        : {}),
      ...(input.configProfileId !== undefined ? { configProfileId: input.configProfileId } : {}),
      ...(input.envProfileId !== undefined ? { envProfileId: input.envProfileId } : {}),
      ...(input.workerCount !== undefined ? { workerCount: input.workerCount } : {}),
      rerunMode:
        input.rerunMode ??
        (input.parameters
          ? "with_param_override"
          : input.configProfileId !== undefined || input.envProfileId !== undefined
            ? "with_profile_override"
            : sourceRun.spec.rerunMode),
    };

    await this.runRepository.createControlAction(
      project.id,
      "rerun_requested",
      {
        sourceRunId: runId,
        rerunSpecInput,
      },
      runId,
    );

    return this.createRun(project.id, rerunSpecInput);
  }

  async getLogs(runId: string, options: GetLogsOptions = {}) {
    await this.getRun(runId);
    return this.runRepository.listLogs(runId, options);
  }

  async getTimeline(runId: string) {
    await this.getRun(runId);
    return this.runRepository.listTimeline(runId);
  }

  async getGraph(runId: string): Promise<GraphResponse> {
    await this.getRun(runId);
    return this.runRepository.getGraph(runId);
  }

  async getLineage(runId: string) {
    await this.getRun(runId);
    return this.runRepository.listLineage(runId);
  }

  async getLineageNode(runId: string, taskNodeId: string) {
    await this.getRun(runId);
    const node = await this.runRepository.getLineageNode(taskNodeId);
    if (!node || node.runId !== runId) {
      throw new HttpError(404, "Task lineage node not found.");
    }

    return node;
  }

  async compareLineageNodeWithPreviousSuccess(
    runId: string,
    taskNodeId: string,
  ): Promise<LineageComparePreviousSuccessResponse> {
    const [run, current] = await Promise.all([
      this.getRun(runId),
      this.getLineageNode(runId, taskNodeId),
    ]);
    const currentLineage = await this.runRepository.listLineage(runId);
    const currentNodeById = new Map(currentLineage.map((node) => [node.id, node]));
    const evidence = buildCompareResolutionEvidence(current, currentNodeById);
    const previousRun = await this.runRepository.findPreviousSuccessfulRun(
      run.projectId,
      run.spec.rootTaskName,
      run.createdAt,
    );

    if (!previousRun) {
      return buildCompareResponse(current, null, {
        status: "no_previous_success",
        strategy: null,
        previousRunId: null,
        matchedTaskNodeId: null,
        sameTaskNameCandidateTaskNodeIds: [],
        attempts: [],
        evidence,
        message: "No previous successful run is available for compare.",
      });
    }

    const [previousLineage, sameTaskNameCandidates] = await Promise.all([
      this.runRepository.listLineage(previousRun.id),
      this.runRepository.listLineageNodesByRunAndTaskName(previousRun.id, current.taskName),
    ]);
    const previousNodeById = new Map(previousLineage.map((node) => [node.id, node]));

    if (sameTaskNameCandidates.length === 0) {
      return buildCompareResponse(current, null, {
        status: "no_candidate",
        strategy: null,
        previousRunId: previousRun.id,
        matchedTaskNodeId: null,
        sameTaskNameCandidateTaskNodeIds: [],
        attempts: [],
        evidence,
        message: `No ${current.taskName} node exists in the previous successful run.`,
      });
    }

    const currentParameterFingerprint = buildParameterFingerprint(current.parameters);
    const currentTopologySignature = buildTopologySignature(current, currentNodeById);
    const currentOutputPathSignature = buildOutputPathSignature(current.outputs);

    const attempts: CompareResolutionAttempt[] = [
      buildCompareResolutionAttempt(
        "unique_id",
        sameTaskNameCandidates.filter((candidate) => candidate.uniqueId === current.uniqueId),
      ),
      buildCompareResolutionAttempt(
        "parameter_fingerprint",
        sameTaskNameCandidates.filter(
          (candidate) =>
            buildParameterFingerprint(candidate.parameters) === currentParameterFingerprint,
        ),
      ),
      buildCompareResolutionAttempt(
        "topology_signature",
        sameTaskNameCandidates.filter((candidate) => {
          const topologySignature = buildTopologySignature(candidate, previousNodeById);
          return (
            topologySignature.upstream === currentTopologySignature.upstream &&
            topologySignature.downstream === currentTopologySignature.downstream
          );
        }),
      ),
      buildCompareResolutionAttempt(
        "output_path_signature",
        sameTaskNameCandidates.filter(
          (candidate) => buildOutputPathSignature(candidate.outputs) === currentOutputPathSignature,
        ),
      ),
    ];

    const matchedAttempt = attempts.find((attempt) => attempt.candidateCount === 1);
    if (matchedAttempt) {
      const matchedTaskNodeId = matchedAttempt.candidateTaskNodeIds[0];
      const previous = sameTaskNameCandidates.find(
        (candidate) => candidate.id === matchedTaskNodeId,
      );
      if (!previous) {
        throw new HttpError(500, "Matched compare target could not be resolved.");
      }

      return buildCompareResponse(current, previous, {
        status: "matched",
        strategy: matchedAttempt.strategy,
        previousRunId: previousRun.id,
        matchedTaskNodeId: previous.id,
        sameTaskNameCandidateTaskNodeIds: sameTaskNameCandidates.map((candidate) => candidate.id),
        attempts,
        evidence,
        message: `Matched previous ${current.taskName} node by ${compareResolutionStrategyLabel[matchedAttempt.strategy]}.`,
      });
    }

    if (sameTaskNameCandidates.length === 1) {
      const previous = sameTaskNameCandidates[0];
      if (!previous) {
        throw new HttpError(500, "Single compare candidate could not be resolved.");
      }

      return buildCompareResponse(current, previous, {
        status: "matched",
        strategy: "task_name_unique_candidate",
        previousRunId: previousRun.id,
        matchedTaskNodeId: previous.id,
        sameTaskNameCandidateTaskNodeIds: [previous.id],
        attempts,
        evidence,
        message: `Resolved compare target because the previous successful run has a single ${current.taskName} candidate.`,
      });
    }

    if (sameTaskNameCandidates.length > 1) {
      return buildCompareResponse(current, null, {
        status: "ambiguous",
        strategy: null,
        previousRunId: previousRun.id,
        matchedTaskNodeId: null,
        sameTaskNameCandidateTaskNodeIds: sameTaskNameCandidates.map((candidate) => candidate.id),
        attempts,
        evidence,
        message: `Ambiguous compare target: ${sameTaskNameCandidates.length} previous ${current.taskName} candidates remain after heuristic matching.`,
      });
    }

    return buildCompareResponse(current, null, {
      status: "no_candidate",
      strategy: null,
      previousRunId: previousRun.id,
      matchedTaskNodeId: null,
      sameTaskNameCandidateTaskNodeIds: sameTaskNameCandidates.map((candidate) => candidate.id),
      attempts,
      evidence,
      message: `Previous ${current.taskName} candidates existed, but none matched compare heuristics uniquely.`,
    });
  }

  async getArtifacts(runId: string) {
    await this.getRun(runId);
    return this.runRepository.listArtifacts(runId);
  }

  async getArtifactContent(artifactId: string): Promise<ArtifactContentByIdResponse> {
    const artifact = await this.runRepository.getArtifactById(artifactId);
    if (!artifact) {
      throw new HttpError(404, "Artifact not found.");
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = await fs.readFile(artifact.absolutePath);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        throw new HttpError(404, "Artifact content was not found on disk.");
      }
      throw error;
    }

    const truncated = rawBuffer.byteLength > textPreviewByteLimit;
    const previewBuffer = truncated ? rawBuffer.subarray(0, textPreviewByteLimit) : rawBuffer;
    const mimeType = artifact.mimeType ?? null;
    if (isTextMimeType(mimeType) || isProbablyTextBuffer(previewBuffer)) {
      return {
        artifactId: artifact.id,
        mimeType,
        contentType: "text",
        text: previewBuffer.toString("utf8"),
        truncated,
        byteLength: rawBuffer.byteLength,
      };
    }

    return {
      artifactId: artifact.id,
      mimeType,
      contentType: "binary",
      base64: previewBuffer.toString("base64"),
      truncated,
      byteLength: rawBuffer.byteLength,
    };
  }

  async getRawTaskInfoTree(runId: string): Promise<RawPayloadResponse> {
    await this.getRun(runId);
    const runtimePaths = this.getRunRuntimePaths(runId);
    return {
      raw: await this.readJsonFile(runtimePaths.rawTaskInfoTreePath),
    };
  }

  async getRawTaskInfoTable(runId: string): Promise<RawPayloadResponse> {
    await this.getRun(runId);
    const runtimePaths = this.getRunRuntimePaths(runId);
    return {
      raw: await this.readJsonFile(runtimePaths.rawTaskInfoTablePath),
    };
  }

  async getRawScheduler(runId: string): Promise<RawPayloadResponse> {
    await this.getRun(runId);
    const snapshots = await this.runRepository.listSchedulerSnapshots(runId);
    return {
      raw: snapshots.map((snapshot) => ({
        snapshotId: snapshot.id,
        health: snapshot.health,
        activeTaskCount: snapshot.activeTaskCount,
        pendingTaskCount: snapshot.pendingTaskCount,
        failedTaskCount: snapshot.failedTaskCount,
        workerCount: snapshot.workerCount,
        capturedAt: snapshot.capturedAt,
        raw: snapshot.raw,
      })),
    };
  }

  async getRawAdapterEvents(runId: string): Promise<RawAdapterEventsResponse> {
    await this.getRun(runId);
    const runtimePaths = this.getRunRuntimePaths(runId);
    const events = await this.readAdapterEvents(runtimePaths.adapterEventsPath);
    return {
      raw: events,
    };
  }

  async getStreamReplay(runId: string) {
    const run = await this.getRun(runId);
    const [logs, timeline, schedulerSnapshots] = await Promise.all([
      this.runRepository.listLogs(runId),
      this.runRepository.listTimeline(runId),
      this.runRepository.listSchedulerSnapshots(runId),
    ]);

    const replayEvents = [
      ...logs.map((event) => ({ event: "log" as const, data: event })),
      ...timeline.map((event) => ({ event: "timeline" as const, data: event })),
      ...schedulerSnapshots.map((event) => ({ event: "scheduler" as const, data: event })),
    ].sort((left, right) => {
      const leftAt = this.getStreamEventTimestamp(left);
      const rightAt = this.getStreamEventTimestamp(right);
      return sortByDateAscending(leftAt, rightAt, left.event, right.event);
    });

    return {
      run,
      replayEvents,
      isActive: this.activeRuns.has(runId) && !isTerminalRunStatus(run.status),
    };
  }

  subscribe(runId: string, listener: RunStreamSubscriber) {
    let listeners = this.subscribers.get(runId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(runId, listeners);
    }

    listeners.add(listener);

    return () => {
      const current = this.subscribers.get(runId);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  isRunActive(runId: string) {
    return this.activeRuns.has(runId);
  }

  private publish(runId: string, event: RunStreamEvent) {
    const listeners = this.subscribers.get(runId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  private async startRunExecution(run: Run, project: Project) {
    const runtimePaths = await this.ensureRunRuntimePaths(run.id);

    try {
      const resolvedProfiles = await this.resolveProfiles(project, run.spec);
      const request = this.buildAdapterRunRequest(project, run, resolvedProfiles);
      const handle = await this.adapterService.spawn(request, {
        cwd: project.connection.projectRootDir ?? project.connection.workspaceDirectory,
        transport: "stdin",
        detached: true,
        ...(project.connection.pythonExecutable
          ? {
              pythonExecutable: project.connection.pythonExecutable,
            }
          : {}),
      });

      if (!handle.child.pid) {
        throw new Error("Adapter process did not provide a PID.");
      }

      const startingRun = await this.runRepository.updateStatus(run.id, {
        status: "starting",
        adapterPid: handle.child.pid,
        processGroupId: handle.child.pid,
        startedAt: new Date().toISOString(),
      });

      const context: ActiveRunContext = {
        runId: run.id,
        projectId: project.id,
        child: handle.child,
        cleanup: handle.cleanup,
        persistenceChain: Promise.resolve(),
        latestRun: startingRun,
        terminalStatus: null,
        adapterEventsPath: runtimePaths.adapterEventsPath,
        stderrPath: runtimePaths.stderrPath,
        rawTaskInfoTreePath: runtimePaths.rawTaskInfoTreePath,
        rawTaskInfoTablePath: runtimePaths.rawTaskInfoTablePath,
        gracefulStopTimer: null,
      };

      this.activeRuns.set(run.id, context);
      this.publish(run.id, {
        event: "run",
        data: startingRun,
      });

      const stdoutReader = readline.createInterface({
        input: handle.child.stdout,
        crlfDelay: Infinity,
      });
      const stderrReader = readline.createInterface({
        input: handle.child.stderr,
        crlfDelay: Infinity,
      });

      stdoutReader.on("line", (line) => {
        void this.handleStdoutLine(context, line);
      });
      stderrReader.on("line", (line) => {
        void this.handleStderrLine(context, line);
      });

      handle.child.once("error", (error) => {
        void this.handleChildError(context, error);
      });
      handle.child.once("close", (exitCode, signal) => {
        stdoutReader.close();
        stderrReader.close();
        void this.handleChildClose(context, exitCode, signal);
      });
      handle.child.unref();
    } catch (error) {
      await this.failRunBeforeStart(run.id, error);
    }
  }

  private async failRunBeforeStart(runId: string, error: unknown) {
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Failed to start adapter process.";
    const [run, timelineEvent, logEvent] = await Promise.all([
      this.runRepository.updateStatus(runId, {
        status: "failed",
        finishedAt: failedAt,
        errorSummary: message,
      }),
      this.runRepository.createTimelineEvent({
        runId,
        type: "run_failed",
        message,
        at: failedAt,
      }),
      this.runRepository.createLogEvent({
        runId,
        stream: "system",
        line: message,
        at: failedAt,
      }),
    ]);

    this.publish(runId, {
      event: "run",
      data: run,
    });
    this.publish(runId, {
      event: "timeline",
      data: timelineEvent,
    });
    this.publish(runId, {
      event: "log",
      data: logEvent,
    });
  }

  private async handleStdoutLine(context: ActiveRunContext, line: string) {
    if (!line.trim()) {
      return;
    }

    await fs.appendFile(context.adapterEventsPath, `${line}\n`, "utf8");

    let event: AdapterEvent;
    try {
      event = adapterEventSchema.parse(JSON.parse(line));
    } catch (error) {
      await this.queuePersistence(context, async () => {
        const logEvent = await this.runRepository.createLogEvent({
          runId: context.runId,
          stream: "system",
          line:
            error instanceof Error
              ? `Invalid adapter stdout line ignored: ${error.message}`
              : "Invalid adapter stdout line ignored.",
          at: new Date().toISOString(),
        });

        this.publish(context.runId, {
          event: "log",
          data: logEvent,
        });
      });
      return;
    }

    await this.queuePersistence(context, async () => {
      await this.handleAdapterEvent(context, event);
    });
  }

  private async handleStderrLine(context: ActiveRunContext, line: string) {
    if (!line.trim()) {
      return;
    }

    await fs.appendFile(context.stderrPath, `${line}\n`, "utf8");
    await this.queuePersistence(context, async () => {
      const logEvent = await this.runRepository.createLogEvent({
        runId: context.runId,
        stream: "stderr",
        line,
        at: new Date().toISOString(),
      });

      this.publish(context.runId, {
        event: "log",
        data: logEvent,
      });
    });
  }

  private async handleChildError(context: ActiveRunContext, error: Error) {
    await this.queuePersistence(context, async () => {
      const logEvent = await this.runRepository.createLogEvent({
        runId: context.runId,
        stream: "system",
        line: `Adapter process error: ${error.message}`,
        at: new Date().toISOString(),
      });

      this.publish(context.runId, {
        event: "log",
        data: logEvent,
      });
    });
  }

  private async handleChildClose(
    context: ActiveRunContext,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ) {
    await context.persistenceChain;
    this.clearGracefulStopTimer(context);

    if (!context.terminalStatus) {
      const finishedAt = new Date().toISOString();
      const fallbackStatus = this.buildFallbackStatus(context.latestRun.status, exitCode, signal);
      const fallbackMessage = this.buildFallbackCloseMessage(fallbackStatus, exitCode, signal);
      const [run, timelineEvent] = await Promise.all([
        this.runRepository.updateStatus(context.runId, {
          status: fallbackStatus,
          exitCode: exitCode ?? (signal === "SIGKILL" ? 137 : signal === "SIGTERM" ? 143 : null),
          finishedAt,
          errorSummary: fallbackStatus === "failed" ? fallbackMessage : null,
        }),
        this.runRepository.createTimelineEvent({
          runId: context.runId,
          type: fallbackStatus === "failed" ? "run_failed" : "run_finished",
          message: fallbackMessage,
          at: finishedAt,
          payload: {
            exitCode,
            signal,
          },
        }),
      ]);

      context.latestRun = run;
      context.terminalStatus = fallbackStatus;
      this.publish(context.runId, {
        event: "run",
        data: run,
      });
      this.publish(context.runId, {
        event: "timeline",
        data: timelineEvent,
      });
    }

    try {
      await context.cleanup();
    } finally {
      this.activeRuns.delete(context.runId);
    }
  }

  private async handleAdapterEvent(context: ActiveRunContext, event: AdapterEvent) {
    switch (event.type) {
      case "run.started": {
        const run = await this.runRepository.updateStatus(context.runId, {
          status: "starting",
          startedAt: event.at,
        });
        const timelineEvent = await this.runRepository.createTimelineEvent({
          runId: context.runId,
          type: "adapter_started",
          message: `Adapter started for ${event.rootTaskName}.`,
          at: event.at,
          payload: event,
        });
        context.latestRun = run;
        this.publish(context.runId, {
          event: "run",
          data: run,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }

      case "run.status_changed": {
        const run = await this.runRepository.updateStatus(context.runId, {
          status: event.status,
        });
        context.latestRun = run;
        this.publish(context.runId, {
          event: "run",
          data: run,
        });
        return;
      }

      case "scheduler.snapshot": {
        const [snapshot, timelineEvent] = await Promise.all([
          this.runRepository.createSchedulerSnapshot({
            projectId: context.projectId,
            runId: context.runId,
            health: event.health,
            activeTaskCount: event.activeTaskCount,
            pendingTaskCount: event.pendingTaskCount,
            failedTaskCount: event.failedTaskCount,
            workerCount: event.workerCount,
            raw: event.raw,
            capturedAt: event.at,
          }),
          this.runRepository.createTimelineEvent({
            runId: context.runId,
            type: "scheduler_connected",
            message: `Scheduler snapshot captured with health=${event.health}.`,
            at: event.at,
            payload: event,
          }),
        ]);

        this.publish(context.runId, {
          event: "scheduler",
          data: snapshot,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }

      case "task.discovered": {
        await this.runRepository.upsertTaskDiscovered(context.runId, event);
        const timelineEvent = await this.runRepository.createTimelineEvent({
          runId: context.runId,
          type: "task_state_changed",
          message: `Discovered ${event.taskName} (${event.state}).`,
          at: event.at,
          payload: event,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }

      case "task.status_changed": {
        await this.runRepository.upsertTaskState(context.runId, {
          taskName: event.taskName,
          uniqueId: event.uniqueId,
          state: event.state,
        });
        const timelineEvent = await this.runRepository.createTimelineEvent({
          runId: context.runId,
          type: "task_state_changed",
          message: `${event.taskName} -> ${event.state}.`,
          at: event.at,
          payload: event,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }

      case "task.log": {
        const logEvent = await this.runRepository.createLogEvent({
          runId: context.runId,
          stream: event.stream,
          line: `[${event.taskName}] ${event.line}`,
          at: event.at,
        });
        this.publish(context.runId, {
          event: "log",
          data: logEvent,
        });
        return;
      }

      case "artifact.discovered": {
        let taskNodeId: string | null = null;
        if (event.taskName && event.uniqueId) {
          const existingNode = await this.runRepository.getLineageNodeByRunAndUniqueId(
            context.runId,
            event.uniqueId,
          );
          taskNodeId =
            existingNode?.id ??
            (await this.runRepository.upsertTaskState(context.runId, {
              taskName: event.taskName,
              uniqueId: event.uniqueId,
              state: "UNKNOWN" satisfies TaskState,
            }));
        }
        await this.runRepository.createArtifact(context.projectId, context.runId, {
          ...event,
          taskNodeId,
        });
        const timelineEvent = await this.runRepository.createTimelineEvent({
          runId: context.runId,
          type: "artifact_detected",
          message: `Artifact detected: ${event.relativePath}.`,
          at: event.at,
          payload: event,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }

      case "raw.task_info_tree": {
        await fs.writeFile(context.rawTaskInfoTreePath, JSON.stringify(event.raw, null, 2), "utf8");
        return;
      }

      case "raw.task_info_table": {
        await fs.writeFile(
          context.rawTaskInfoTablePath,
          JSON.stringify(event.raw, null, 2),
          "utf8",
        );
        const entries = this.parseTaskInfoTableEntries(event.raw);
        if (entries.length > 0) {
          await this.runRepository.syncTaskInfoTable(context.runId, entries);
        }
        return;
      }

      case "adapter.warning":
      case "adapter.error": {
        const logEvent = await this.runRepository.createLogEvent({
          runId: context.runId,
          stream: "system",
          line: `[${event.type}] ${event.code}: ${event.message}`,
          at: event.at,
        });
        this.publish(context.runId, {
          event: "log",
          data: logEvent,
        });
        return;
      }

      case "run.finished": {
        const [run, timelineEvent] = await Promise.all([
          this.runRepository.updateStatus(context.runId, {
            status: event.status,
            exitCode: event.exitCode ?? null,
            finishedAt: event.at,
            errorSummary: event.errorSummary ?? null,
          }),
          this.runRepository.createTimelineEvent({
            runId: context.runId,
            type: event.status === "failed" ? "run_failed" : "run_finished",
            message:
              event.status === "failed"
                ? (event.errorSummary ?? "Run finished with failure.")
                : `Run finished with status=${event.status}.`,
            at: event.at,
            payload: event,
          }),
        ]);
        context.latestRun = run;
        context.terminalStatus = event.status;
        this.clearGracefulStopTimer(context);
        this.publish(context.runId, {
          event: "run",
          data: run,
        });
        this.publish(context.runId, {
          event: "timeline",
          data: timelineEvent,
        });
        return;
      }
    }
  }

  private async resolveRunSpec(project: Project, input: CreateRunRequest): Promise<RunSpec> {
    return {
      ...input,
      configProfileId: input.configProfileId ?? project.defaultConfigProfileId ?? null,
      envProfileId: input.envProfileId ?? project.defaultEnvProfileId ?? null,
      label: input.label ?? null,
      workerCount: input.workerCount ?? null,
    };
  }

  private async resolveProfiles(project: Project, spec: RunSpec) {
    const configProfile = await this.resolveProfile(project.id, spec.configProfileId ?? null);
    const envProfile = await this.resolveProfile(project.id, spec.envProfileId ?? null);

    return {
      configValues: configProfile.values,
      configMaskedKeys: configProfile.maskedKeys,
      envValues: envProfile.values,
      envMaskedKeys: envProfile.maskedKeys,
    };
  }

  private async resolveProfile(projectId: string, profileId: string | null) {
    if (!profileId) {
      return {
        values: {} as Record<string, string>,
        maskedKeys: [] as string[],
      };
    }

    const chain = await this.collectProfileChain(projectId, profileId, new Set<string>());
    return {
      values: Object.assign({}, ...chain.map((entry) => entry.values)),
      maskedKeys: Array.from(new Set(chain.flatMap((entry) => entry.maskedKeys))).sort(
        (left, right) => left.localeCompare(right),
      ),
    };
  }

  private async collectProfileChain(
    projectId: string,
    profileId: string,
    visitedProfileIds: Set<string>,
  ): Promise<Profile[]> {
    if (visitedProfileIds.has(profileId)) {
      throw new HttpError(400, "Profile inheritance cycle detected.");
    }

    visitedProfileIds.add(profileId);
    const profile = await this.profileRepository.getById(profileId);
    if (!profile) {
      throw new HttpError(400, "Selected profile was not found.");
    }
    if (profile.projectId !== projectId) {
      throw new HttpError(400, "Selected profile must belong to the same project.");
    }

    if (!profile.extendsProfileId) {
      return [profile];
    }

    const parentChain: Profile[] = await this.collectProfileChain(
      projectId,
      profile.extendsProfileId,
      visitedProfileIds,
    );
    return [...parentChain, profile];
  }

  private buildAdapterRunRequest(
    project: Project,
    run: Run,
    resolvedProfiles: {
      configValues: Record<string, string>;
      configMaskedKeys: string[];
      envValues: Record<string, string>;
      envMaskedKeys: string[];
    },
  ): AdapterRunRequest {
    return {
      runId: run.id,
      projectId: run.projectId,
      projectName: project.name,
      accessMode: run.accessMode,
      projectRootDir: project.connection.projectRootDir ?? null,
      workspaceDirectory: project.connection.workspaceDirectory,
      pythonExecutable: project.connection.pythonExecutable ?? null,
      entrypointPath: project.connection.entrypointPath ?? null,
      luigiConfigPath: project.connection.luigiConfigPath ?? null,
      envSourcePath: project.connection.envSourcePath ?? null,
      schedulerBaseUrl: project.connection.schedulerBaseUrl ?? null,
      configValues: resolvedProfiles.configValues,
      configMaskedKeys: resolvedProfiles.configMaskedKeys,
      envValues: resolvedProfiles.envValues,
      envMaskedKeys: resolvedProfiles.envMaskedKeys,
      spec: run.spec,
    };
  }

  private async ensureRunRuntimePaths(runId: string) {
    const runDirectory = path.join(this.runtimeDirectory, runId);
    await fs.mkdir(runDirectory, {
      recursive: true,
    });

    return this.getRunRuntimePaths(runId);
  }

  private getRunRuntimePaths(runId: string) {
    const runDirectory = path.join(this.runtimeDirectory, runId);
    return {
      runDirectory,
      adapterEventsPath: path.join(runDirectory, "adapter-events.jsonl"),
      stderrPath: path.join(runDirectory, "stderr.log"),
      rawTaskInfoTreePath: path.join(runDirectory, "task-info-tree.json"),
      rawTaskInfoTablePath: path.join(runDirectory, "task-info-table.json"),
    };
  }

  private queuePersistence(context: ActiveRunContext, operation: () => Promise<void>) {
    const queuedOperation = context.persistenceChain.then(operation);
    context.persistenceChain = queuedOperation.catch(() => undefined);
    return queuedOperation;
  }

  private buildFallbackStatus(
    currentStatus: RunStatus,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): RunStatus {
    if (currentStatus === "stopping") {
      return "canceled";
    }

    if (exitCode === 0 && !signal) {
      return "success";
    }

    return "failed";
  }

  private buildFallbackCloseMessage(
    status: RunStatus,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ) {
    if (status === "canceled") {
      return "Run stopped before adapter emitted a terminal event.";
    }

    if (status === "success") {
      return "Run finished without an explicit terminal adapter event.";
    }

    if (signal) {
      return `Adapter process exited unexpectedly with signal ${signal}.`;
    }

    return `Adapter process exited unexpectedly with code ${exitCode ?? "unknown"}.`;
  }

  private getStreamEventTimestamp(event: Exclude<RunStreamEvent, { event: "run" }>) {
    switch (event.event) {
      case "log":
        return event.data.at;
      case "timeline":
        return event.data.at;
      case "scheduler":
        return event.data.capturedAt;
    }
  }

  private clearGracefulStopTimer(context: ActiveRunContext) {
    if (!context.gracefulStopTimer) {
      return;
    }

    clearTimeout(context.gracefulStopTimer);
    context.gracefulStopTimer = null;
  }

  private sendSignal(pid: number | undefined, signal: NodeJS.Signals) {
    if (!pid) {
      return;
    }

    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH" && errorCode !== "EINVAL") {
        throw error;
      }
    }

    try {
      process.kill(pid, signal);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH") {
        throw error;
      }
    }
  }

  private parseTaskInfoTableEntries(raw: unknown) {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const taskName = typeof entry.taskName === "string" ? entry.taskName : null;
      const uniqueId = typeof entry.uniqueId === "string" ? entry.uniqueId : null;
      const state =
        typeof entry.state === "string" && taskStateValues.has(entry.state as TaskState)
          ? (entry.state as TaskState)
          : null;

      if (!taskName || !uniqueId || !state) {
        return [];
      }

      return [
        {
          taskName,
          uniqueId,
          state,
          parameters: isRecord(entry.parameters) ? entry.parameters : {},
          outputs: Array.isArray(entry.outputs)
            ? entry.outputs.filter((value): value is string => typeof value === "string")
            : [],
          processingTimeSec:
            typeof entry.processingTimeSec === "number" ? entry.processingTimeSec : null,
          taskLog: isRecord(entry.taskLog) ? entry.taskLog : null,
          rerunReason:
            typeof entry.rerunReason === "string"
              ? entry.rerunReason
              : entry.rerunReason === null
                ? null
                : null,
          codeVersionHint:
            typeof entry.codeVersionHint === "string"
              ? entry.codeVersionHint
              : entry.codeVersionHint === null
                ? null
                : null,
          upstreamUniqueIds: Array.isArray(entry.upstreamUniqueIds)
            ? entry.upstreamUniqueIds.filter((value): value is string => typeof value === "string")
            : [],
          downstreamUniqueIds: Array.isArray(entry.downstreamUniqueIds)
            ? entry.downstreamUniqueIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        },
      ];
    });
  }

  private async readJsonFile(filePath: string): Promise<unknown | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content) as unknown;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        return null;
      }

      if (error instanceof SyntaxError) {
        return await fs.readFile(filePath, "utf8");
      }

      throw error;
    }
  }

  private async readAdapterEvents(filePath: string): Promise<AdapterEvent[]> {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        return [];
      }
      throw error;
    }

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [adapterEventSchema.parse(JSON.parse(line))];
        } catch {
          return [];
        }
      });
  }
}
