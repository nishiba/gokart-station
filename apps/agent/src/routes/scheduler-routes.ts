import {
  schedulerHealthQuerySchema,
  schedulerHealthResponseSchema,
  schedulerLifecycleRequestSchema,
  schedulerLogsQuerySchema,
  schedulerLogsResponseSchema,
} from "@gokart-station/shared";
import type { FastifyInstance } from "fastify";
import { parseWithSchema } from "../lib/zod";
import type { ProjectService } from "../services/project-service";
import type { SchedulerService } from "../services/scheduler-service";

type SchedulerRoutesDependencies = {
  projectService: ProjectService;
  schedulerService: SchedulerService;
};

export const registerSchedulerRoutes = (
  app: FastifyInstance,
  { projectService, schedulerService }: SchedulerRoutesDependencies,
) => {
  app.get("/api/scheduler/health", async (request) => {
    const query = parseWithSchema(schedulerHealthQuerySchema, request.query ?? {});

    if (!query.projectId) {
      return schedulerHealthResponseSchema.parse(await schedulerService.getHealth());
    }

    const project = await projectService.requireProject(query.projectId);
    return schedulerHealthResponseSchema.parse(
      await schedulerService.getHealth(project.connection.schedulerBaseUrl),
    );
  });

  app.post("/api/scheduler/start", async (request) => {
    const body = parseWithSchema(schedulerLifecycleRequestSchema, request.body);
    const project = await projectService.requireSchedulerLifecycleProject(body.projectId);
    return schedulerHealthResponseSchema.parse(
      await schedulerService.start(project.connection.schedulerBaseUrl),
    );
  });

  app.post("/api/scheduler/stop", async (request) => {
    const body = parseWithSchema(schedulerLifecycleRequestSchema, request.body);
    const project = await projectService.requireSchedulerLifecycleProject(body.projectId);
    return schedulerHealthResponseSchema.parse(
      await schedulerService.stop(project.connection.schedulerBaseUrl),
    );
  });

  app.post("/api/scheduler/restart", async (request) => {
    const body = parseWithSchema(schedulerLifecycleRequestSchema, request.body);
    const project = await projectService.requireSchedulerLifecycleProject(body.projectId);
    return schedulerHealthResponseSchema.parse(
      await schedulerService.restart(project.connection.schedulerBaseUrl),
    );
  });

  app.get("/api/scheduler/logs", async (request) => {
    const query = parseWithSchema(schedulerLogsQuerySchema, request.query ?? {});
    return schedulerLogsResponseSchema.parse(await schedulerService.getLogs(query.limit));
  });
};
