import {
  artifactContentByIdResponseSchema,
  artifactsResponseSchema,
  createRunRequestSchema,
  graphResponseSchema,
  idSchema,
  lineageComparePreviousSuccessResponseSchema,
  lineageNodeResponseSchema,
  lineageResponseSchema,
  listRunsResponseSchema,
  logsQuerySchema,
  logsResponseSchema,
  type RunStreamEvent,
  rawAdapterEventsResponseSchema,
  rawSchedulerResponseSchema,
  rawTaskInfoTableResponseSchema,
  rawTaskInfoTreeResponseSchema,
  rerunRunRequestSchema,
  runResponseSchema,
  stopRunRequestSchema,
  timelineResponseSchema,
} from "@gokart-station/shared";
import type { FastifyInstance } from "fastify";
import { parseWithSchema } from "../lib/zod";
import type { RunService } from "../services/run-service";

type RunRoutesDependencies = {
  runService: RunService;
};

const formatSseEvent = (event: RunStreamEvent) => {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
};

const isTerminalStatus = (status: string) => {
  return status === "success" || status === "failed" || status === "canceled";
};

export const registerRunRoutes = (app: FastifyInstance, { runService }: RunRoutesDependencies) => {
  app.get("/api/projects/:projectId/runs", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    return listRunsResponseSchema.parse(await runService.listRuns(projectId));
  });

  app.post("/api/projects/:projectId/runs", async (request, reply) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const body = parseWithSchema(createRunRequestSchema, request.body);
    const run = await runService.createRun(projectId, body);
    reply.code(201);
    return runResponseSchema.parse(run);
  });

  app.get("/api/runs/:runId", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return runResponseSchema.parse(await runService.getRun(runId));
  });

  app.post("/api/runs/:runId/stop", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const body = parseWithSchema(stopRunRequestSchema, request.body ?? {});
    return runResponseSchema.parse(await runService.stopRun(runId, body));
  });

  app.post("/api/runs/:runId/rerun", async (request, reply) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const body = parseWithSchema(rerunRunRequestSchema, request.body ?? {});
    const run = await runService.rerunRun(runId, body);
    reply.code(201);
    return runResponseSchema.parse(run);
  });

  app.get("/api/runs/:runId/logs", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const query = parseWithSchema(logsQuerySchema, request.query ?? {});
    const options = {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    };
    return logsResponseSchema.parse(await runService.getLogs(runId, options));
  });

  app.get("/api/runs/:runId/timeline", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return timelineResponseSchema.parse(await runService.getTimeline(runId));
  });

  app.get("/api/runs/:runId/graph", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return graphResponseSchema.parse(await runService.getGraph(runId));
  });

  app.get("/api/runs/:runId/lineage", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return lineageResponseSchema.parse(await runService.getLineage(runId));
  });

  app.get("/api/runs/:runId/lineage/:taskNodeId", async (request) => {
    const params = request.params as { runId: string; taskNodeId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const taskNodeId = parseWithSchema(idSchema, params.taskNodeId);
    return lineageNodeResponseSchema.parse(await runService.getLineageNode(runId, taskNodeId));
  });

  app.get("/api/runs/:runId/lineage/:taskNodeId/compare-previous-success", async (request) => {
    const params = request.params as { runId: string; taskNodeId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const taskNodeId = parseWithSchema(idSchema, params.taskNodeId);
    return lineageComparePreviousSuccessResponseSchema.parse(
      await runService.compareLineageNodeWithPreviousSuccess(runId, taskNodeId),
    );
  });

  app.get("/api/runs/:runId/artifacts", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return artifactsResponseSchema.parse(await runService.getArtifacts(runId));
  });

  app.get("/api/artifacts/:artifactId/content", async (request) => {
    const params = request.params as { artifactId: string };
    const artifactId = parseWithSchema(idSchema, params.artifactId);
    return artifactContentByIdResponseSchema.parse(await runService.getArtifactContent(artifactId));
  });

  app.get("/api/runs/:runId/raw/task-info-tree", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return rawTaskInfoTreeResponseSchema.parse(await runService.getRawTaskInfoTree(runId));
  });

  app.get("/api/runs/:runId/raw/task-info-table", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return rawTaskInfoTableResponseSchema.parse(await runService.getRawTaskInfoTable(runId));
  });

  app.get("/api/runs/:runId/raw/scheduler", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return rawSchedulerResponseSchema.parse(await runService.getRawScheduler(runId));
  });

  app.get("/api/runs/:runId/raw/adapter-events", async (request) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    return rawAdapterEventsResponseSchema.parse(await runService.getRawAdapterEvents(runId));
  });

  app.get("/api/runs/:runId/logs/stream", async (request, reply) => {
    const params = request.params as { runId: string };
    const runId = parseWithSchema(idSchema, params.runId);
    const { run, replayEvents, isActive } = await runService.getStreamReplay(runId);

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    reply.raw.write(formatSseEvent({ event: "run", data: run }));
    for (const event of replayEvents) {
      reply.raw.write(formatSseEvent(event));
    }

    if (!isActive || isTerminalStatus(run.status)) {
      reply.raw.end();
      return;
    }

    const unsubscribe = runService.subscribe(runId, (event) => {
      if (reply.raw.writableEnded) {
        unsubscribe();
        return;
      }

      reply.raw.write(formatSseEvent(event));
      if (event.event === "run" && isTerminalStatus(event.data.status)) {
        unsubscribe();
        reply.raw.end();
      }
    });

    const latestRun = await runService.getRun(runId);
    if (!runService.isRunActive(runId) || isTerminalStatus(latestRun.status)) {
      if (latestRun.updatedAt !== run.updatedAt || latestRun.status !== run.status) {
        reply.raw.write(formatSseEvent({ event: "run", data: latestRun }));
      }
      unsubscribe();
      reply.raw.end();
      return;
    }

    const cleanup = () => {
      unsubscribe();
    };

    request.raw.once("close", cleanup);
    reply.raw.once("close", cleanup);
  });
};
