import {
  type CreateProjectRequest,
  capabilityErrorResponseSchema,
  type Project,
  type ProjectConnection,
  type ProjectValidationResult,
  type UpdateProjectRequest,
} from "@gokart-station/shared";
import { HttpError } from "../lib/http-errors";
import type { CapabilitySnapshotRepository } from "../repositories/capability-snapshot-repository";
import type { ProjectRepository } from "../repositories/project-repository";
import type { CapabilityService } from "./capability-service";
import type { PathSandboxService } from "./path-sandbox-service";
import type { ProjectWatchService } from "./project-watch-service";
import type { SchedulerService } from "./scheduler-service";

export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly capabilitySnapshotRepository: CapabilitySnapshotRepository,
    private readonly capabilityService: CapabilityService,
    private readonly pathSandboxService: PathSandboxService,
    private readonly schedulerService: SchedulerService,
    private readonly projectWatchService: ProjectWatchService,
  ) {}

  listProjects() {
    return this.projectRepository.list((accessMode) =>
      this.capabilityService.getBaseCapabilities(accessMode),
    );
  }

  getProject(projectId: string) {
    return this.projectRepository.getById(projectId, (accessMode) =>
      this.capabilityService.getBaseCapabilities(accessMode),
    );
  }

  async createProject(input: CreateProjectRequest) {
    const project = await this.projectRepository.create(input, (accessMode) =>
      this.capabilityService.getBaseCapabilities(accessMode),
    );

    await this.projectWatchService.startOrRefresh(project);
    return project;
  }

  async updateProject(projectId: string, input: UpdateProjectRequest) {
    const project = await this.projectRepository.update(projectId, input, (accessMode) =>
      this.capabilityService.getBaseCapabilities(accessMode),
    );

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    await this.projectWatchService.startOrRefresh(project);
    return project;
  }

  async deleteProject(projectId: string) {
    const project = await this.projectRepository.getConnectionById(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    await this.projectWatchService.remove(projectId);
    await this.projectRepository.delete(projectId);
    return { ok: true } as const;
  }

  async validateProject(projectId: string): Promise<ProjectValidationResult> {
    const project = await this.projectRepository.getConnectionById(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const issues = await this.pathSandboxService.validateConnection(project.connection);
    const schedulerStatus = await this.schedulerService.getHealth(
      project.connection.schedulerBaseUrl,
    );

    if (
      project.connection.accessMode !== "observer" &&
      (schedulerStatus.health === "unreachable" ||
        schedulerStatus.health === "degraded" ||
        (schedulerStatus.health === "unknown" && Boolean(project.connection.schedulerBaseUrl)))
    ) {
      issues.push({
        code: "scheduler_unreachable",
        message: "Scheduler health check returned a non-healthy status.",
        level: "warning",
        field: "schedulerBaseUrl",
      });
    }

    if (!project.connection.schedulerBaseUrl && project.connection.accessMode !== "observer") {
      issues.push({
        code: "scheduler_default_used",
        message: "schedulerBaseUrl is not configured; default localhost health checks are used.",
        level: "warning",
        field: "schedulerBaseUrl",
      });
    }

    const validationResult = this.capabilityService.buildValidationResult(
      project.connection,
      issues,
      schedulerStatus.health,
    );

    await this.capabilitySnapshotRepository.save(projectId, validationResult);

    return validationResult;
  }

  async requireProject(projectId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }
    return project;
  }

  async initializeProjectWatches() {
    const projects = await this.listProjects();
    await Promise.all(projects.map((project) => this.projectWatchService.startOrRefresh(project)));
  }

  async requireSchedulerLifecycleProject(projectId: string): Promise<Project> {
    const project = await this.requireProject(projectId);
    this.ensureSchedulerLifecycleAllowed(project.connection);
    return project;
  }

  async requireRunnableProject(projectId: string): Promise<Project> {
    const project = await this.requireProject(projectId);
    this.ensureRunCreationAllowed(project.connection);
    return project;
  }

  ensureProfileMutationAllowed(connection: ProjectConnection) {
    if (connection.accessMode === "observer") {
      throw new HttpError(
        403,
        "Profiles are read-only in observer mode.",
        capabilityErrorResponseSchema.parse({
          code: "forbidden",
          message: "Profiles are read-only in observer mode.",
          requiredCapability: "canEditProfiles",
        }),
      );
    }
  }

  ensureSchedulerLifecycleAllowed(connection: ProjectConnection) {
    if (!this.capabilityService.getBaseCapabilities(connection.accessMode).canManageScheduler) {
      throw new HttpError(
        403,
        "Scheduler lifecycle control is unavailable in observer mode.",
        capabilityErrorResponseSchema.parse({
          code: "forbidden",
          message: "Scheduler lifecycle control is unavailable in observer mode.",
          requiredCapability: "canManageScheduler",
        }),
      );
    }
  }

  ensureRunCreationAllowed(connection: ProjectConnection) {
    if (!this.capabilityService.getBaseCapabilities(connection.accessMode).canRun) {
      throw new HttpError(403, "Run creation is unavailable in observer mode.", {
        code: "forbidden",
        message: "Run creation is unavailable in observer mode.",
        requiredCapability: "canRun",
      });
    }
  }

  ensureRunStopAllowed(connection: ProjectConnection) {
    if (!this.capabilityService.getBaseCapabilities(connection.accessMode).canStop) {
      throw new HttpError(403, "Run stop is unavailable in observer mode.", {
        code: "forbidden",
        message: "Run stop is unavailable in observer mode.",
        requiredCapability: "canStop",
      });
    }
  }

  ensureRunRerunAllowed(connection: ProjectConnection) {
    if (!this.capabilityService.getBaseCapabilities(connection.accessMode).canRerun) {
      throw new HttpError(403, "Run rerun is unavailable in observer mode.", {
        code: "forbidden",
        message: "Run rerun is unavailable in observer mode.",
        requiredCapability: "canRerun",
      });
    }
  }
}
