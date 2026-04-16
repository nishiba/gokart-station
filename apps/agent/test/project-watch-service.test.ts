import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProjectConnection, WatchEvent } from "@gokart-station/shared";
import type { WatchEventCreateInput } from "../src/repositories/watch-event-repository";
import { PathSandboxService } from "../src/services/path-sandbox-service";
import {
  computeFallbackPollInterval,
  ProjectWatchService,
} from "../src/services/project-watch-service";
import { removeDirectoryWithRetries } from "./helpers/cleanup";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const waitFor = async (predicate: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for predicate after ${timeoutMs}ms.`);
};

class InMemoryWatchEventRepository {
  readonly events: WatchEvent[] = [];

  async createMany(events: WatchEventCreateInput[]) {
    this.events.push(
      ...events.map((event, index) => ({
        id: `watch-${this.events.length + index + 1}`,
        runId: event.runId ?? null,
        ...event,
      })),
    );
  }

  async trimByProjectId(projectId: string, limit: number) {
    const matchingEvents = this.events.filter((event) => event.projectId === projectId);
    if (matchingEvents.length <= limit) {
      return;
    }

    const overflow = matchingEvents.length - limit;
    let remainingOverflow = overflow;
    const retainedEvents: WatchEvent[] = [];

    for (const event of this.events) {
      if (event.projectId === projectId && remainingOverflow > 0) {
        remainingOverflow -= 1;
        continue;
      }

      retainedEvents.push(event);
    }

    this.events.splice(0, this.events.length, ...retainedEvents);
  }
}

test("project watch service prefers native file events before polling fallback", async () => {
  const tempRootDir = await createTempDirectory("gokart-station-watch-service-");
  const workspaceDirectory = path.join(tempRootDir, "workspace");
  const watchEventRepository = new InMemoryWatchEventRepository();
  const watchService = new ProjectWatchService(
    watchEventRepository as never,
    new PathSandboxService(),
    {
      eventDebounceMs: 25,
      fallbackPollIntervalMs: 10_000,
      maxFallbackPollIntervalMs: 10_000,
    },
  );

  try {
    await fs.mkdir(workspaceDirectory, {
      recursive: true,
    });

    const resolvedWorkspaceDirectory = await fs.realpath(workspaceDirectory);

    const connection: ProjectConnection = {
      accessMode: "observer",
      workspaceDirectory: resolvedWorkspaceDirectory,
      allowWorkspaceDirectorySymlink: false,
    };

    await watchService.startOrRefresh({
      id: "project-1",
      connection,
    });

    const startedAt = Date.now();
    await fs.writeFile(
      path.join(resolvedWorkspaceDirectory, "watch-me.json"),
      '{"ok":true}\n',
      "utf8",
    );

    await waitFor(() => {
      return watchEventRepository.events.some((event) =>
        event.relativePath.endsWith("watch-me.json"),
      );
    }, 1_500);

    assert.ok(
      Date.now() - startedAt < 2_000,
      "watch event should arrive before the long polling fallback interval elapses",
    );
  } finally {
    await watchService.dispose();
    await removeDirectoryWithRetries(tempRootDir);
  }
});

test("fallback polling interval backs off for quiet or large workspaces", () => {
  const baseCase = computeFallbackPollInterval({
    snapshotEntryCount: 100,
    consecutiveQuietScans: 0,
    basePollIntervalMs: 2_000,
    maxPollIntervalMs: 15_000,
    largeWorkspaceEntryThreshold: 2_000,
    hugeWorkspaceEntryThreshold: 10_000,
  });
  const largeWorkspaceCase = computeFallbackPollInterval({
    snapshotEntryCount: 3_000,
    consecutiveQuietScans: 0,
    basePollIntervalMs: 2_000,
    maxPollIntervalMs: 15_000,
    largeWorkspaceEntryThreshold: 2_000,
    hugeWorkspaceEntryThreshold: 10_000,
  });
  const quietWorkspaceCase = computeFallbackPollInterval({
    snapshotEntryCount: 100,
    consecutiveQuietScans: 2,
    basePollIntervalMs: 2_000,
    maxPollIntervalMs: 15_000,
    largeWorkspaceEntryThreshold: 2_000,
    hugeWorkspaceEntryThreshold: 10_000,
  });

  assert.equal(baseCase, 2_000);
  assert.ok(largeWorkspaceCase > baseCase);
  assert.ok(quietWorkspaceCase > baseCase);
});
