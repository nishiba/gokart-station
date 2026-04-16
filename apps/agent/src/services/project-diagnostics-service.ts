import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactManifestEntry,
  FileTreeResponse,
  ProjectConnection,
  Run,
  WatchEvent,
} from "@gokart-station/shared";
import { defaultSupportBundleRuntimeDirectory } from "../config";
import { buildFileTree } from "../lib/project-file-scan";
import type { CapabilitySnapshotRepository } from "../repositories/capability-snapshot-repository";
import type { WatchEventRepository } from "../repositories/watch-event-repository";
import type { PathSandboxService } from "./path-sandbox-service";
import type { ProjectService } from "./project-service";
import type { RunService } from "./run-service";
import type { SchedulerService } from "./scheduler-service";

export type ProjectDiagnosticsServiceOptions = {
  fileTreeMaxDepth?: number;
  supportBundleRuntimeDirectory?: string;
};

const supportBundleManifestFileName = "bundle.json";

const summarizeRun = (run: Run) => {
  return {
    id: run.id,
    accessMode: run.accessMode,
    status: run.status,
    exitCode: run.exitCode ?? null,
    stopMode: run.stopMode ?? null,
    errorSummary: run.errorSummary ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    spec: {
      rootTaskName: run.spec.rootTaskName,
      label: run.spec.label ?? null,
      rerunMode: run.spec.rerunMode,
      workerCount: run.spec.workerCount ?? null,
      parameterKeys: Object.keys(run.spec.parameters).sort((left, right) =>
        left.localeCompare(right),
      ),
    },
  };
};

export class ProjectDiagnosticsService {
  private readonly fileTreeMaxDepth: number;
  private readonly supportBundleRuntimeDirectory: string;

  constructor(
    private readonly projectService: ProjectService,
    private readonly runService: RunService,
    private readonly watchEventRepository: WatchEventRepository,
    private readonly capabilitySnapshotRepository: CapabilitySnapshotRepository,
    private readonly pathSandboxService: PathSandboxService,
    private readonly schedulerService: SchedulerService,
    options: ProjectDiagnosticsServiceOptions = {},
  ) {
    this.fileTreeMaxDepth = options.fileTreeMaxDepth ?? 4;
    this.supportBundleRuntimeDirectory =
      options.supportBundleRuntimeDirectory ?? defaultSupportBundleRuntimeDirectory;
  }

  async getFilesTree(projectId: string): Promise<FileTreeResponse> {
    const project = await this.projectService.requireProject(projectId);
    return this.getFilesTreeForConnection(project.connection);
  }

  async getWatchEvents(projectId: string, limit?: number): Promise<WatchEvent[]> {
    await this.projectService.requireProject(projectId);
    return this.watchEventRepository.listByProjectId(projectId, limit ?? 200);
  }

  async createSupportBundle(projectId: string): Promise<ArtifactManifestEntry> {
    const project = await this.projectService.requireProject(projectId);
    const validation = await this.projectService.validateProject(projectId);
    const capabilitySnapshot = await this.capabilitySnapshotRepository.getLatest(projectId);
    const [fileTree, watchEvents, recentRuns, schedulerHealth, schedulerSnapshot, schedulerLogs] =
      await Promise.all([
        this.getFilesTreeForConnection(project.connection),
        this.watchEventRepository.listByProjectId(projectId, 200),
        this.runService.listRuns(projectId),
        this.schedulerService.getHealth(project.connection.schedulerBaseUrl),
        this.schedulerService.getSnapshot(project.connection.schedulerBaseUrl),
        this.schedulerService.getLogs(50),
      ]);

    const bundleId = `${Date.now()}-${randomUUID()}`;
    const bundleDirectory = path.join(this.supportBundleRuntimeDirectory, projectId, bundleId);
    await fs.mkdir(bundleDirectory, {
      recursive: true,
    });

    await this.writeJsonFile(path.join(bundleDirectory, "validation.json"), validation);
    await this.writeJsonFile(path.join(bundleDirectory, "file-tree.json"), fileTree);
    await this.writeJsonFile(path.join(bundleDirectory, "watch-events.json"), watchEvents);
    await this.writeJsonFile(
      path.join(bundleDirectory, "recent-runs.json"),
      recentRuns.map(summarizeRun),
    );
    await this.writeJsonFile(path.join(bundleDirectory, "scheduler-health.json"), schedulerHealth);
    await this.writeJsonFile(
      path.join(bundleDirectory, "scheduler-snapshot.json"),
      schedulerSnapshot,
    );
    await this.writeJsonFile(path.join(bundleDirectory, "scheduler-logs.json"), schedulerLogs);

    const latestRun = recentRuns[0] ?? null;
    let latestRunManifest: {
      run: ReturnType<typeof summarizeRun>;
      fileNames: string[];
    } | null = null;

    if (latestRun) {
      latestRunManifest = await this.writeLatestRunBundle(bundleDirectory, latestRun);
    }

    const manifest = {
      bundleId,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        accessMode: project.connection.accessMode,
        connection: project.connection,
        capabilities: project.capabilities,
      },
      validation,
      capabilitySnapshot,
      fileTreeRootCount: fileTree.length,
      watchEventCount: watchEvents.length,
      recentRunCount: recentRuns.length,
      scheduler: {
        health: schedulerHealth,
        snapshot: schedulerSnapshot,
        logLineCount: schedulerLogs.lines.length,
      },
      files: {
        validation: "validation.json",
        fileTree: "file-tree.json",
        watchEvents: "watch-events.json",
        recentRuns: "recent-runs.json",
        schedulerHealth: "scheduler-health.json",
        schedulerSnapshot: "scheduler-snapshot.json",
        schedulerLogs: "scheduler-logs.json",
      },
      latestRun: latestRunManifest,
    };

    const manifestPath = path.join(bundleDirectory, supportBundleManifestFileName);
    await this.writeJsonFile(manifestPath, manifest);

    const manifestStats = await fs.stat(manifestPath);
    const createdAt = new Date().toISOString();
    return {
      id: `support_bundle_${bundleId}`,
      projectId,
      runId: latestRun?.id ?? null,
      taskNodeId: null,
      kind: "support_bundle",
      absolutePath: manifestPath,
      relativePath: path.relative(this.supportBundleRuntimeDirectory, manifestPath),
      sizeBytes: manifestStats.size,
      mimeType: "application/json",
      previewable: true,
      modifiedAt: manifestStats.mtime.toISOString(),
      createdAt,
    };
  }

  private async getFilesTreeForConnection(projectConnection: ProjectConnection) {
    const scopes = await this.pathSandboxService.resolveScopes(projectConnection);
    return buildFileTree(scopes, {
      maxDepth: this.fileTreeMaxDepth,
    });
  }

  private async writeLatestRunBundle(bundleDirectory: string, run: Run) {
    const [logs, timeline, artifacts, rawTree, rawTable, rawScheduler, rawAdapterEvents] =
      await Promise.all([
        this.runService.getLogs(run.id, {
          limit: 200,
          order: "desc",
        }),
        this.runService.getTimeline(run.id),
        this.runService.getArtifacts(run.id),
        this.runService.getRawTaskInfoTree(run.id),
        this.runService.getRawTaskInfoTable(run.id),
        this.runService.getRawScheduler(run.id),
        this.runService.getRawAdapterEvents(run.id),
      ]);

    const runDirectory = path.join(bundleDirectory, "latest-run");
    await fs.mkdir(runDirectory, {
      recursive: true,
    });

    await this.writeTextFile(
      path.join(runDirectory, "logs.txt"),
      [...logs]
        .reverse()
        .map((entry) => `[${entry.at}] [${entry.stream}] ${entry.line}`)
        .join("\n"),
    );
    await this.writeJsonFile(path.join(runDirectory, "timeline.json"), timeline);
    await this.writeJsonFile(path.join(runDirectory, "artifacts.json"), artifacts);
    await this.writeJsonFile(path.join(runDirectory, "task-info-tree.json"), rawTree.raw);
    await this.writeJsonFile(path.join(runDirectory, "task-info-table.json"), rawTable.raw);
    await this.writeJsonFile(path.join(runDirectory, "scheduler.json"), rawScheduler.raw);
    await this.writeJsonFile(path.join(runDirectory, "adapter-events.json"), rawAdapterEvents.raw);

    return {
      run: summarizeRun(run),
      fileNames: [
        "latest-run/logs.txt",
        "latest-run/timeline.json",
        "latest-run/artifacts.json",
        "latest-run/task-info-tree.json",
        "latest-run/task-info-table.json",
        "latest-run/scheduler.json",
        "latest-run/adapter-events.json",
      ],
    };
  }

  private async writeJsonFile(filePath: string, value: unknown) {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async writeTextFile(filePath: string, value: string) {
    await fs.writeFile(filePath, value.length === 0 ? "" : `${value}\n`, "utf8");
  }
}
