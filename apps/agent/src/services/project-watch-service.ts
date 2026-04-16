import { type FSWatcher, watch } from "node:fs";
import path from "node:path";
import type { Project } from "@gokart-station/shared";
import { collectFileSnapshot, type FileSnapshotEntry } from "../lib/project-file-scan";
import type {
  WatchEventCreateInput,
  WatchEventRepository,
} from "../repositories/watch-event-repository";
import type { PathSandboxService, SandboxScope } from "./path-sandbox-service";

export type ProjectWatchServiceOptions = {
  maxEventsPerProject?: number;
  maxScanDepth?: number;
  eventDebounceMs?: number;
  fallbackPollIntervalMs?: number;
  maxFallbackPollIntervalMs?: number;
  largeWorkspaceEntryThreshold?: number;
  hugeWorkspaceEntryThreshold?: number;
  preferNativeEvents?: boolean;
};

type ProjectWatchMode = "event" | "poll";

type ProjectWatchState = {
  snapshot: Map<string, FileSnapshotEntry>;
  scanInFlight: boolean;
  rescanRequested: boolean;
  refreshTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
  watchers: FSWatcher[];
  quietPollScans: number;
  mode: ProjectWatchMode;
  project: Pick<Project, "id" | "connection">;
};

type FallbackPollIntervalInput = {
  snapshotEntryCount: number;
  consecutiveQuietScans: number;
  basePollIntervalMs: number;
  maxPollIntervalMs: number;
  largeWorkspaceEntryThreshold: number;
  hugeWorkspaceEntryThreshold: number;
};

type WatchRoot = {
  watchPath: string;
  recursive: boolean;
};

const clearTimer = (timer: NodeJS.Timeout | null) => {
  if (timer) {
    clearTimeout(timer);
  }
};

const isPathInsideRoot = (rootDir: string, candidatePath: string) => {
  const relativePath = path.relative(rootDir, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const computeFallbackPollInterval = ({
  snapshotEntryCount,
  consecutiveQuietScans,
  basePollIntervalMs,
  maxPollIntervalMs,
  largeWorkspaceEntryThreshold,
  hugeWorkspaceEntryThreshold,
}: FallbackPollIntervalInput) => {
  const workspaceMultiplier =
    snapshotEntryCount >= hugeWorkspaceEntryThreshold
      ? 4
      : snapshotEntryCount >= largeWorkspaceEntryThreshold
        ? 2
        : 1;
  const quietMultiplier = Math.min(2 ** consecutiveQuietScans, 4);

  return Math.min(maxPollIntervalMs, basePollIntervalMs * workspaceMultiplier * quietMultiplier);
};

export class ProjectWatchService {
  private readonly maxEventsPerProject: number;
  private readonly maxScanDepth: number;
  private readonly eventDebounceMs: number;
  private readonly fallbackPollIntervalMs: number;
  private readonly maxFallbackPollIntervalMs: number;
  private readonly largeWorkspaceEntryThreshold: number;
  private readonly hugeWorkspaceEntryThreshold: number;
  private readonly preferNativeEvents: boolean;
  private readonly projectStates = new Map<string, ProjectWatchState>();

  constructor(
    private readonly watchEventRepository: WatchEventRepository,
    private readonly pathSandboxService: PathSandboxService,
    options: ProjectWatchServiceOptions = {},
  ) {
    this.maxEventsPerProject = options.maxEventsPerProject ?? 1_000;
    this.maxScanDepth = options.maxScanDepth ?? 8;
    this.eventDebounceMs = options.eventDebounceMs ?? 120;
    this.fallbackPollIntervalMs = options.fallbackPollIntervalMs ?? 2_000;
    this.maxFallbackPollIntervalMs = options.maxFallbackPollIntervalMs ?? 15_000;
    this.largeWorkspaceEntryThreshold = options.largeWorkspaceEntryThreshold ?? 2_000;
    this.hugeWorkspaceEntryThreshold = options.hugeWorkspaceEntryThreshold ?? 10_000;
    this.preferNativeEvents = options.preferNativeEvents ?? true;
  }

  async startOrRefresh(project: Pick<Project, "id" | "connection">) {
    await this.remove(project.id);

    const scopes = await this.pathSandboxService.resolveScopes(project.connection);
    const snapshot = await collectFileSnapshot(scopes, {
      maxDepth: this.maxScanDepth,
    });
    const state: ProjectWatchState = {
      project,
      snapshot,
      scanInFlight: false,
      rescanRequested: false,
      refreshTimer: null,
      pollTimer: null,
      watchers: [],
      quietPollScans: 0,
      mode: "poll",
    };

    this.projectStates.set(project.id, state);

    if (this.preferNativeEvents) {
      const watchers = this.createWatchers(project.id, scopes);
      if (watchers.length > 0) {
        state.watchers = watchers;
        state.mode = "event";
        return;
      }
    }

    this.schedulePoll(state, this.fallbackPollIntervalMs);
  }

  async remove(projectId: string) {
    const currentState = this.projectStates.get(projectId);
    if (!currentState) {
      return;
    }

    clearTimer(currentState.refreshTimer);
    clearTimer(currentState.pollTimer);
    this.closeWatchers(currentState.watchers);
    this.projectStates.delete(projectId);
  }

  async dispose() {
    await Promise.all([...this.projectStates.keys()].map((projectId) => this.remove(projectId)));
  }

  private createWatchers(projectId: string, scopes: SandboxScope[]) {
    const watchRoots = this.buildWatchRoots(scopes);
    if (watchRoots.length === 0) {
      return [];
    }

    const watchers: FSWatcher[] = [];

    try {
      for (const watchRoot of watchRoots) {
        const watcher = watch(
          watchRoot.watchPath,
          {
            persistent: false,
            recursive: watchRoot.recursive,
          },
          () => {
            this.queueRefresh(projectId, this.eventDebounceMs);
          },
        );

        watcher.on("error", () => {
          void this.switchToPolling(projectId);
        });
        watchers.push(watcher);
      }
    } catch {
      this.closeWatchers(watchers);
      return [];
    }

    return watchers;
  }

  private buildWatchRoots(scopes: SandboxScope[]) {
    const recursiveRoots = scopes
      .filter((scope) => scope.kind === "directory")
      .map((scope) => scope.realPath)
      .sort((left, right) => left.length - right.length);
    const minimalRecursiveRoots: string[] = [];

    for (const rootPath of recursiveRoots) {
      if (minimalRecursiveRoots.some((parentPath) => isPathInsideRoot(parentPath, rootPath))) {
        continue;
      }

      minimalRecursiveRoots.push(rootPath);
    }

    const watchRoots = new Map<string, WatchRoot>();
    for (const rootPath of minimalRecursiveRoots) {
      watchRoots.set(rootPath, {
        watchPath: rootPath,
        recursive: true,
      });
    }

    for (const scope of scopes.filter((candidate) => candidate.kind === "file")) {
      const parentDirectoryPath = path.dirname(scope.realPath);
      if (
        minimalRecursiveRoots.some((rootPath) => isPathInsideRoot(rootPath, parentDirectoryPath))
      ) {
        continue;
      }

      watchRoots.set(parentDirectoryPath, {
        watchPath: parentDirectoryPath,
        recursive: false,
      });
    }

    return [...watchRoots.values()];
  }

  private closeWatchers(watchers: FSWatcher[]) {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // ignore watcher close failures during cleanup
      }
    }
  }

  private queueRefresh(projectId: string, delayMs: number) {
    const state = this.projectStates.get(projectId);
    if (!state) {
      return;
    }

    clearTimer(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void this.refreshProject(projectId);
    }, delayMs);
    state.refreshTimer.unref?.();
  }

  private schedulePoll(state: ProjectWatchState, delayMs: number) {
    clearTimer(state.pollTimer);
    state.pollTimer = setTimeout(() => {
      state.pollTimer = null;
      void this.refreshProject(state.project.id);
    }, delayMs);
    state.pollTimer.unref?.();
  }

  private async switchToPolling(projectId: string) {
    const state = this.projectStates.get(projectId);
    if (!state || state.mode === "poll") {
      return;
    }

    this.closeWatchers(state.watchers);
    state.watchers = [];
    state.mode = "poll";
    state.quietPollScans = 0;
    this.schedulePoll(state, this.fallbackPollIntervalMs);
  }

  private async refreshProject(projectId: string) {
    const state = this.projectStates.get(projectId);
    if (!state) {
      return;
    }

    clearTimer(state.refreshTimer);
    state.refreshTimer = null;

    if (state.scanInFlight) {
      state.rescanRequested = true;
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
      if (state.mode === "poll") {
        state.quietPollScans = events.length === 0 ? state.quietPollScans + 1 : 0;
      }
    } catch {
      if (state.mode === "event") {
        await this.switchToPolling(projectId);
      } else {
        state.quietPollScans += 1;
      }
    } finally {
      state.scanInFlight = false;

      if (this.projectStates.has(projectId)) {
        if (state.rescanRequested) {
          state.rescanRequested = false;
          this.queueRefresh(projectId, state.mode === "event" ? this.eventDebounceMs : 0);
        } else if (state.mode === "poll") {
          const delayMs = computeFallbackPollInterval({
            snapshotEntryCount: state.snapshot.size,
            consecutiveQuietScans: state.quietPollScans,
            basePollIntervalMs: this.fallbackPollIntervalMs,
            maxPollIntervalMs: this.maxFallbackPollIntervalMs,
            largeWorkspaceEntryThreshold: this.largeWorkspaceEntryThreshold,
            hugeWorkspaceEntryThreshold: this.hugeWorkspaceEntryThreshold,
          });
          this.schedulePoll(state, delayMs);
        }
      }
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
