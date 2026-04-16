import {
  createProjectRequestSchema,
  deleteProjectResponseSchema,
  fileTreeResponseSchema,
  idSchema,
  projectResponseSchema,
  supportBundleResponseArtifactSchema,
  updateProjectRequestSchema,
  validateProjectResponseSchema,
  watchEventsQuerySchema,
  watchEventsResponseSchema,
} from "@gokart-station/shared";
import type { FastifyInstance } from "fastify";
import { parseWithSchema } from "../lib/zod";
import type { ProjectDiagnosticsService } from "../services/project-diagnostics-service";
import type { ProjectService } from "../services/project-service";

type ProjectRoutesDependencies = {
  projectDiagnosticsService: ProjectDiagnosticsService;
  projectService: ProjectService;
};

export const registerProjectRoutes = (
  app: FastifyInstance,
  { projectDiagnosticsService, projectService }: ProjectRoutesDependencies,
) => {
  app.get("/api/projects", async () => {
    return projectService.listProjects();
  });

  app.post("/api/projects", async (request, reply) => {
    const body = parseWithSchema(createProjectRequestSchema, request.body);
    const project = await projectService.createProject(body);
    reply.code(201);
    return projectResponseSchema.parse(project);
  });

  app.get("/api/projects/:projectId", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const project = await projectService.requireProject(projectId);
    return projectResponseSchema.parse(project);
  });

  app.patch("/api/projects/:projectId", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const body = parseWithSchema(updateProjectRequestSchema, request.body);
    const project = await projectService.updateProject(projectId, body);
    return projectResponseSchema.parse(project);
  });

  app.delete("/api/projects/:projectId", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const response = await projectService.deleteProject(projectId);
    return deleteProjectResponseSchema.parse(response);
  });

  app.post("/api/projects/:projectId/validate", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const validationResult = await projectService.validateProject(projectId);
    return validateProjectResponseSchema.parse(validationResult);
  });

  app.get("/api/projects/:projectId/files/tree", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    return fileTreeResponseSchema.parse(await projectDiagnosticsService.getFilesTree(projectId));
  });

  app.get("/api/projects/:projectId/watch-events", async (request) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const query = parseWithSchema(watchEventsQuerySchema, request.query ?? {});
    return watchEventsResponseSchema.parse(
      await projectDiagnosticsService.getWatchEvents(projectId, query.limit),
    );
  });

  app.post("/api/projects/:projectId/support-bundle", async (request, reply) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const bundleArtifact = await projectDiagnosticsService.createSupportBundle(projectId);
    reply.code(201);
    return supportBundleResponseArtifactSchema.parse(bundleArtifact);
  });
};
