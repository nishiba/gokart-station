import Fastify from "fastify";
import { createPrismaClient, ensureDatabaseInitialized } from "./lib/database";
import { HttpError } from "./lib/http-errors";
import { CapabilitySnapshotRepository } from "./repositories/capability-snapshot-repository";
import { ProfileRepository } from "./repositories/profile-repository";
import { ProjectRepository } from "./repositories/project-repository";
import { RunRepository } from "./repositories/run-repository";
import { WatchEventRepository } from "./repositories/watch-event-repository";
import { registerHealthRoutes } from "./routes/health-routes";
import { registerProfileRoutes } from "./routes/profile-routes";
import { registerProjectRoutes } from "./routes/project-routes";
import { registerRunRoutes } from "./routes/run-routes";
import { registerSchedulerRoutes } from "./routes/scheduler-routes";
import { AdapterService } from "./services/adapter-service";
import { CapabilityService } from "./services/capability-service";
import { PathSandboxService } from "./services/path-sandbox-service";
import { ProfileService } from "./services/profile-service";
import {
  ProjectDiagnosticsService,
  type ProjectDiagnosticsServiceOptions,
} from "./services/project-diagnostics-service";
import { ProjectService } from "./services/project-service";
import {
  ProjectWatchService,
  type ProjectWatchServiceOptions,
} from "./services/project-watch-service";
import { RunService } from "./services/run-service";
import { SchedulerService, type SchedulerServiceOptions } from "./services/scheduler-service";

export type BuildAppOptions = {
  databaseUrl?: string;
  projectDiagnostics?: ProjectDiagnosticsServiceOptions;
  projectWatch?: ProjectWatchServiceOptions;
  scheduler?: SchedulerServiceOptions;
};

const buildLoggerOptions = () => {
  if (process.env.NODE_ENV !== "development") {
    return true;
  }

  return {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  };
};

export const buildApp = async (options: BuildAppOptions = {}) => {
  const { databaseUrl, projectDiagnostics, projectWatch, scheduler } = options;
  await ensureDatabaseInitialized(databaseUrl);
  const prisma = createPrismaClient(databaseUrl);

  const projectRepository = new ProjectRepository(prisma);
  const profileRepository = new ProfileRepository(prisma);
  const runRepository = new RunRepository(prisma);
  const capabilitySnapshotRepository = new CapabilitySnapshotRepository(prisma);
  const watchEventRepository = new WatchEventRepository(prisma);
  const capabilityService = new CapabilityService();
  const pathSandboxService = new PathSandboxService();
  const schedulerService = new SchedulerService(scheduler);
  const adapterService = new AdapterService();
  const projectWatchService = new ProjectWatchService(
    watchEventRepository,
    pathSandboxService,
    projectWatch,
  );
  const projectService = new ProjectService(
    projectRepository,
    capabilitySnapshotRepository,
    capabilityService,
    pathSandboxService,
    schedulerService,
    projectWatchService,
  );
  const profileService = new ProfileService(profileRepository, projectRepository, projectService);
  const runService = new RunService(
    runRepository,
    profileRepository,
    projectService,
    adapterService,
  );
  const projectDiagnosticsService = new ProjectDiagnosticsService(
    projectService,
    runService,
    watchEventRepository,
    capabilitySnapshotRepository,
    pathSandboxService,
    schedulerService,
    projectDiagnostics,
  );

  const app = Fastify({
    logger: buildLoggerOptions(),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send(error.payload ?? { message: error.message });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      code: "internal_error",
      message: "Unexpected server error.",
    });
  });

  app.addHook("onClose", async () => {
    await runService.dispose();
    await projectWatchService.dispose();
    await schedulerService.dispose();
    await prisma.$disconnect();
  });

  registerHealthRoutes(app);
  registerSchedulerRoutes(app, {
    projectService,
    schedulerService,
  });
  registerProjectRoutes(app, {
    projectDiagnosticsService,
    projectService,
  });
  registerProfileRoutes(app, {
    profileService,
  });
  registerRunRoutes(app, {
    runService,
  });

  await projectService.initializeProjectWatches();

  return app;
};
