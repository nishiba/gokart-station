import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app";
import { createPrismaClient } from "../src/lib/database";
import { RunRepository } from "../src/repositories/run-repository";
import { removeDirectoryWithRetries } from "./helpers/cleanup";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const createObserverProject = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  tempRootDir: string,
) => {
  const workspaceDirectory = path.join(tempRootDir, "workspace");
  await fs.mkdir(workspaceDirectory, {
    recursive: true,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "lineage-compare-project",
      connection: {
        accessMode: "observer",
        workspaceDirectory,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  return {
    project: response.json(),
    workspaceDirectory,
  };
};

const createRunSpec = () => {
  return {
    rootTaskName: "SyntheticFanoutCompare",
    label: null,
    parameters: {},
    rerunMode: "same_spec" as const,
    captureTaskInfoTree: true,
    captureTaskInfoTable: true,
    captureArtifactManifest: true,
  };
};

const createSyntheticEntries = (
  runLabel: string,
  branchNames: string[],
  branchOverrides: Partial<
    Record<string, { uniqueId?: string; parameters?: Record<string, unknown> }>
  > = {},
) => {
  const sharedInputUniqueId = `SharedInput(run=${runLabel})`;
  const joinTaskUniqueId = `JoinTask(run=${runLabel})`;
  const branchUniqueIds = new Map(
    branchNames.map((branchName) => [
      branchName,
      branchOverrides[branchName]?.uniqueId ?? `BranchTask(branch=${branchName})`,
    ]),
  );

  return [
    {
      taskName: "SharedInput",
      uniqueId: sharedInputUniqueId,
      state: "DONE" as const,
      parameters: {
        runLabel,
      },
      outputs: [`/tmp/${runLabel}/shared-input.json`],
      processingTimeSec: 0.01,
      upstreamUniqueIds: [],
      downstreamUniqueIds: branchNames.map((branchName) => branchUniqueIds.get(branchName) ?? ""),
    },
    ...branchNames.map((branchName, index) => ({
      taskName: "BranchTask",
      uniqueId: branchUniqueIds.get(branchName) ?? "",
      state: "DONE" as const,
      parameters: {
        branchName,
        ...(branchOverrides[branchName]?.parameters ?? {}),
      },
      outputs: [`/tmp/${runLabel}/branch-${branchName}.json`],
      processingTimeSec: Number((0.1 + index * 0.01).toFixed(2)),
      upstreamUniqueIds: [sharedInputUniqueId],
      downstreamUniqueIds: [joinTaskUniqueId],
    })),
    {
      taskName: "JoinTask",
      uniqueId: joinTaskUniqueId,
      state: "DONE" as const,
      parameters: {
        runLabel,
      },
      outputs: [`/tmp/${runLabel}/join.json`],
      processingTimeSec: 0.02,
      upstreamUniqueIds: branchNames.map((branchName) => branchUniqueIds.get(branchName) ?? ""),
      downstreamUniqueIds: [],
    },
  ];
};

test("compare-previous-success resolves fan-out nodes without taskName collisions and marks ambiguous targets explicitly", async () => {
  const tempRootDir = await createTempDirectory("gokart-station-lineage-compare-");
  const databaseUrl = `file:${path.join(tempRootDir, "test.db")}`;
  const app = await buildApp({ databaseUrl });
  const prisma = createPrismaClient(databaseUrl);
  const runRepository = new RunRepository(prisma);

  try {
    const { project } = await createObserverProject(app, tempRootDir);
    const previousRun = await runRepository.create(project.id, "observer", createRunSpec());
    const matchedRun = await runRepository.create(project.id, "observer", createRunSpec());
    const ambiguousRun = await runRepository.create(project.id, "observer", createRunSpec());

    await prisma.run.update({
      where: { id: previousRun.id },
      data: {
        createdAt: new Date("2026-04-16T00:00:00.000Z"),
      },
    });
    await prisma.run.update({
      where: { id: matchedRun.id },
      data: {
        createdAt: new Date("2026-04-16T00:01:00.000Z"),
      },
    });
    await prisma.run.update({
      where: { id: ambiguousRun.id },
      data: {
        createdAt: new Date("2026-04-16T00:02:00.000Z"),
      },
    });

    await Promise.all([
      runRepository.updateStatus(previousRun.id, {
        status: "success",
        startedAt: "2026-04-16T00:00:01.000Z",
        finishedAt: "2026-04-16T00:00:05.000Z",
      }),
      runRepository.updateStatus(matchedRun.id, {
        status: "success",
        startedAt: "2026-04-16T00:01:01.000Z",
        finishedAt: "2026-04-16T00:01:05.000Z",
      }),
      runRepository.updateStatus(ambiguousRun.id, {
        status: "success",
        startedAt: "2026-04-16T00:02:01.000Z",
        finishedAt: "2026-04-16T00:02:05.000Z",
      }),
    ]);

    await runRepository.syncTaskInfoTable(
      previousRun.id,
      createSyntheticEntries("previous", ["left", "right"]),
    );
    await runRepository.syncTaskInfoTable(
      matchedRun.id,
      createSyntheticEntries("matched", ["left", "right"]),
    );
    await runRepository.syncTaskInfoTable(
      ambiguousRun.id,
      createSyntheticEntries("ambiguous", ["current"], {
        current: {
          uniqueId: "BranchTask(branch=current)",
          parameters: {
            branchName: "current",
          },
        },
      }),
    );

    const matchedLineage = await runRepository.listLineage(matchedRun.id);
    const matchedRightNode = matchedLineage.find(
      (node) => node.taskName === "BranchTask" && node.parameters.branchName === "right",
    );
    assert.ok(matchedRightNode);

    const matchedCompareResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${matchedRun.id}/lineage/${matchedRightNode.id}/compare-previous-success`,
    });
    assert.equal(matchedCompareResponse.statusCode, 200);
    const matchedCompare = matchedCompareResponse.json();
    assert.equal(matchedCompare.previous?.parameters.branchName, "right");
    assert.equal(matchedCompare.diff.compareResolution.status, "matched");
    assert.equal(matchedCompare.diff.compareResolution.strategy, "unique_id");
    assert.equal(matchedCompare.diff.compareResolution.previousRunId, previousRun.id);
    assert.deepEqual(
      matchedCompare.diff.compareResolution.sameTaskNameCandidateTaskNodeIds.length,
      2,
    );
    assert.equal(
      matchedCompare.diff.compareResolution.attempts.find(
        (attempt: { strategy: string }) => attempt.strategy === "unique_id",
      )?.candidateCount,
      1,
    );

    const ambiguousLineage = await runRepository.listLineage(ambiguousRun.id);
    const ambiguousCurrentNode = ambiguousLineage.find(
      (node) => node.taskName === "BranchTask" && node.parameters.branchName === "current",
    );
    assert.ok(ambiguousCurrentNode);

    const ambiguousCompareResponse = await app.inject({
      method: "GET",
      url: `/api/runs/${ambiguousRun.id}/lineage/${ambiguousCurrentNode.id}/compare-previous-success`,
    });
    assert.equal(ambiguousCompareResponse.statusCode, 200);
    const ambiguousCompare = ambiguousCompareResponse.json();
    assert.equal(ambiguousCompare.previous, null);
    assert.equal(ambiguousCompare.diff.compareResolution.status, "ambiguous");
    assert.equal(ambiguousCompare.diff.compareResolution.strategy, null);
    assert.equal(ambiguousCompare.diff.compareResolution.previousRunId, matchedRun.id);
    assert.equal(
      ambiguousCompare.diff.compareResolution.sameTaskNameCandidateTaskNodeIds.length,
      2,
    );
    assert.equal(
      ambiguousCompare.diff.compareResolution.attempts.find(
        (attempt: { strategy: string }) => attempt.strategy === "topology_signature",
      )?.candidateCount,
      2,
    );
    assert.equal(
      ambiguousCompare.diff.compareResolution.attempts.find(
        (attempt: { strategy: string }) => attempt.strategy === "parameter_fingerprint",
      )?.candidateCount,
      0,
    );
  } finally {
    await app.close();
    await prisma.$disconnect();
    await removeDirectoryWithRetries(tempRootDir);
  }
});
