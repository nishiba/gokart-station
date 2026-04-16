import type { Project } from "@gokart-station/shared";
import { collectFileSnapshot, type FileSnapshotEntry } from "../lib/project-file-scan";
import type {
  WatchEventCreateInput,
  WatchEventRepository,
} from "../repositories/watch-event-repository";
import type { PathSandboxService } from "./path-sandbox-service";

export type ProjectWatchServiceOptions = {
  maxEventsPerProject?: number;
  maxScanDepth?: number;
  pollIntervalMs?: number;
};

type ProjectWatchState = {
  snapshot: Map<string, FileSnapshotEntry>;
  scanInFlight: boolean;
  timer: NodeJS.Timeout;
  project: Pick<Project, "id" | "connection">;
};

export class ProjectWatchService {
  private readonly maxEventsPerProject: number;
  private readonly maxScanDepth: number;
  private readonly pollIntervalMs: number;
  private readonly projectStates = new Map<string, ProjectWatchState>();

  constructor(
    private readonly watchEventRepository: WatchEventRepository,
    private readonly pathSandboxService: PathSandboxService,
    options: ProjectWatchServiceOptions = {},
  ) {
    this.maxEventsPerProject = options.maxEventsPerProject ?? 1_000;
    this.maxScanDepth = options.maxScanDepth ?? 8;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  async startOrRefresh(project: Pick<Project, "id" | "connection">) {
    await this.remove(project.id);

    const scopes = await this.pathSandboxService.resolveScopes(project.connection);
    const snapshot = await collectFileSnapshot(scopes, {
      maxDepth: this.maxScanDepth,
    });
    const timer = setInterval(() => {
      void this.scanProject(project.id);
    }, this.pollIntervalMs);
    timer.unref?.();

    this.projectStates.set(project.id, {
      project,
      scanInFlight: false,
      snapshot,
      timer,
    });
  }

  async remove(projectId: string) {
    const currentState = this.projectStates.get(projectId);
    if (!currentState) {
      return;
    }

    clearInterval(currentState.timer);
    this.projectStates.delete(projectId);
  }

  async dispose() {
    await Promise.all([...this.projectStates.keys()].map((projectId) => this.remove(projectId)));
  }

  private async scanProject(projectId: string) {
    const state = this.projectStates.get(projectId);
    if (!state || state.scanInFlight) {
      return;
    }

    state.scanInFlight = true;

    try {
      const scopes = await this.pathSandboxService.resolveScopes(state.project.connection);
      const nextSnapshot = await collectFileSnapshot(scopes, {
        maxDepth: this.maxScanDepth,
      });
      const occurredAt = new Date().toISOString();
      const events = [
        ...this.buildAddedAndChangedEvents(projectId, state.snapshot, nextSnapshot, occurredAt),
        ...this.buildRemovedEvents(projectId, state.snapshot, nextSnapshot, occurredAt),
      ];

      if (events.length > 0) {
        await this.watchEventRepository.createMany(events);
        await this.watchEventRepository.trimByProjectId(projectId, this.maxEventsPerProject);
      }

      state.snapshot = nextSnapshot;
    } catch {
      // ignore watcher scan failures and retry on the next polling cycle
    } finally {
      state.scanInFlight = false;
    }
  }

  private buildAddedAndChangedEvents(
    projectId: string,
    previousSnapshot: Map<string, FileSnapshotEntry>,
    nextSnapshot: Map<string, FileSnapshotEntry>,
    occurredAt: string,
  ): WatchEventCreateInput[] {
    const events: WatchEventCreateInput[] = [];

    for (const entry of nextSnapshot.values()) {
      const previousEntry = previousSnapshot.get(entry.absolutePath);
      if (!previousEntry) {
        events.push({
          projectId,
          kind: "add",
          absolutePath: entry.absolutePath,
          relativePath: entry.relativePath,
          inferredArtifactKind: entry.inferredArtifactKind ?? null,
          occurredAt,
        });
        continue;
      }

      if (previousEntry.mtimeMs !== entry.mtimeMs || previousEntry.sizeBytes !== entry.sizeBytes) {
        events.push({
          projectId,
          kind: "change",
          absolutePath: entry.absolutePath,
          relativePath: entry.relativePath,
          inferredArtifactKind: entry.inferredArtifactKind ?? null,
          occurredAt,
        });
      }
    }

    return events;
  }

  private buildRemovedEvents(
    projectId: string,
    previousSnapshot: Map<string, FileSnapshotEntry>,
    nextSnapshot: Map<string, FileSnapshotEntry>,
    occurredAt: string,
  ): WatchEventCreateInput[] {
    const events: WatchEventCreateInput[] = [];

    for (const entry of previousSnapshot.values()) {
      if (nextSnapshot.has(entry.absolutePath)) {
        continue;
      }

      events.push({
        projectId,
        kind: "unlink",
        absolutePath: entry.absolutePath,
        relativePath: entry.relativePath,
        inferredArtifactKind: entry.inferredArtifactKind ?? null,
        occurredAt,
      });
    }

    return events;
  }
}
