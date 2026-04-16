import type { ArtifactKind, WatchEvent, WatchEventKind } from "@gokart-station/shared";
import type { PrismaClient } from "@prisma/client";

export type WatchEventCreateInput = {
  projectId: string;
  runId?: string | null | undefined;
  kind: WatchEventKind;
  absolutePath: string;
  relativePath: string;
  inferredArtifactKind?: ArtifactKind | null | undefined;
  occurredAt: string;
};

const mapWatchEvent = (
  record: Awaited<ReturnType<PrismaClient["watchEvent"]["findFirstOrThrow"]>>,
): WatchEvent => {
  return {
    id: record.id,
    projectId: record.projectId,
    runId: record.runId,
    kind: record.kind as WatchEventKind,
    absolutePath: record.absolutePath,
    relativePath: record.relativePath,
    inferredArtifactKind: (record.inferredArtifactKind as ArtifactKind | null) ?? null,
    occurredAt: record.occurredAt.toISOString(),
  };
};

export class WatchEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProjectId(projectId: string, limit = 200) {
    const records = await this.prisma.watchEvent.findMany({
      where: {
        projectId,
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    return records.map(mapWatchEvent);
  }

  async createMany(events: WatchEventCreateInput[]) {
    if (events.length === 0) {
      return;
    }

    await this.prisma.watchEvent.createMany({
      data: events.map((event) => ({
        projectId: event.projectId,
        runId: event.runId ?? null,
        kind: event.kind,
        absolutePath: event.absolutePath,
        relativePath: event.relativePath,
        inferredArtifactKind: event.inferredArtifactKind ?? null,
        occurredAt: new Date(event.occurredAt),
      })),
    });
  }

  async trimByProjectId(projectId: string, keepLatest: number) {
    const overflowRecords = await this.prisma.watchEvent.findMany({
      where: {
        projectId,
      },
      select: {
        id: true,
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: keepLatest,
    });

    if (overflowRecords.length === 0) {
      return;
    }

    await this.prisma.watchEvent.deleteMany({
      where: {
        id: {
          in: overflowRecords.map((record) => record.id),
        },
      },
    });
  }
}
