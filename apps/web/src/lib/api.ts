import {
  artifactContentByIdResponseSchema,
  artifactsResponseSchema,
  type CreateProfileRequest,
  type CreateProjectRequest,
  type CreateRunRequest,
  createProfileRequestSchema,
  createProjectRequestSchema,
  createRunRequestSchema,
  deleteProfileResponseSchema,
  deleteProjectResponseSchema,
  fileTreeResponseSchema,
  graphResponseSchema,
  healthResponseSchema,
  lineageComparePreviousSuccessResponseSchema,
  lineageNodeResponseSchema,
  lineageResponseSchema,
  listProfilesResponseSchema,
  listProjectsResponseSchema,
  listRunsResponseSchema,
  logsResponseSchema,
  type ProfileKind,
  profileResponseSchema,
  projectResponseSchema,
  type RerunRunRequest,
  rawAdapterEventsResponseSchema,
  rawSchedulerResponseSchema,
  rawTaskInfoTableResponseSchema,
  rawTaskInfoTreeResponseSchema,
  rerunRunRequestSchema,
  resolveProfileResponseSchema,
  runResponseSchema,
  type SchedulerLifecycleRequest,
  type StopRunRequest,
  schedulerHealthResponseSchema,
  schedulerLifecycleRequestSchema,
  schedulerLogsResponseSchema,
  stopRunRequestSchema,
  supportBundleResponseArtifactSchema,
  timelineResponseSchema,
  type UpdateProfileRequest,
  type UpdateProjectRequest,
  updateProfileRequestSchema,
  updateProjectRequestSchema,
  validateProjectResponseSchema,
  watchEventsResponseSchema,
} from "@gokart-station/shared";

type RequestOptions = {
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
};

type SchemaParser<T> = {
  parse: (input: unknown) => T;
};

type ApiErrorPayload = {
  code?: string;
  message?: string;
  requiredCapability?: string;
  issues?: unknown;
};

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly payload: ApiErrorPayload | null,
  ) {
    super(payload?.message ?? `Request failed with status ${statusCode}.`);
    this.name = "ApiError";
  }
}

const requestJson = async <T>(
  url: string,
  schema: SchemaParser<T>,
  { body, method = "GET" }: RequestOptions = {},
) => {
  const init: RequestInit = {
    method,
  };
  if (body !== undefined) {
    init.headers = {
      "content-type": "application/json",
    };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiError(response.status, (payload as ApiErrorPayload | null) ?? null);
  }

  return schema.parse(payload);
};

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  const value = search.toString();
  return value ? `?${value}` : "";
};

export const api = {
  getHealth: () => requestJson("/api/health", healthResponseSchema),
  listProjects: () => requestJson("/api/projects", listProjectsResponseSchema),
  getProject: (projectId: string) =>
    requestJson(`/api/projects/${projectId}`, projectResponseSchema),
  createProject: (body: CreateProjectRequest) => {
    return requestJson("/api/projects", projectResponseSchema, {
      method: "POST",
      body: createProjectRequestSchema.parse(body),
    });
  },
  updateProject: (projectId: string, body: UpdateProjectRequest) => {
    return requestJson(`/api/projects/${projectId}`, projectResponseSchema, {
      method: "PATCH",
      body: updateProjectRequestSchema.parse(body),
    });
  },
  deleteProject: (projectId: string) => {
    return requestJson(`/api/projects/${projectId}`, deleteProjectResponseSchema, {
      method: "DELETE",
    });
  },
  validateProject: (projectId: string) => {
    return requestJson(`/api/projects/${projectId}/validate`, validateProjectResponseSchema, {
      method: "POST",
    });
  },
  listProfiles: (projectId: string, kind?: ProfileKind) => {
    return requestJson(
      `/api/projects/${projectId}/profiles${query({ kind })}`,
      listProfilesResponseSchema,
    );
  },
  createProfile: (projectId: string, body: CreateProfileRequest) => {
    return requestJson(`/api/projects/${projectId}/profiles`, profileResponseSchema, {
      method: "POST",
      body: createProfileRequestSchema.parse(body),
    });
  },
  getProfile: (profileId: string) =>
    requestJson(`/api/profiles/${profileId}`, profileResponseSchema),
  updateProfile: (profileId: string, body: UpdateProfileRequest) => {
    return requestJson(`/api/profiles/${profileId}`, profileResponseSchema, {
      method: "PATCH",
      body: updateProfileRequestSchema.parse(body),
    });
  },
  deleteProfile: (profileId: string) => {
    return requestJson(`/api/profiles/${profileId}`, deleteProfileResponseSchema, {
      method: "DELETE",
    });
  },
  resolveProfile: (profileId: string) => {
    return requestJson(`/api/profiles/${profileId}/resolve`, resolveProfileResponseSchema, {
      method: "POST",
    });
  },
  getSchedulerHealth: (projectId?: string) => {
    return requestJson(
      `/api/scheduler/health${query({ projectId })}`,
      schedulerHealthResponseSchema,
    );
  },
  startScheduler: (body: SchedulerLifecycleRequest) => {
    return requestJson("/api/scheduler/start", schedulerHealthResponseSchema, {
      method: "POST",
      body: schedulerLifecycleRequestSchema.parse(body),
    });
  },
  stopScheduler: (body: SchedulerLifecycleRequest) => {
    return requestJson("/api/scheduler/stop", schedulerHealthResponseSchema, {
      method: "POST",
      body: schedulerLifecycleRequestSchema.parse(body),
    });
  },
  restartScheduler: (body: SchedulerLifecycleRequest) => {
    return requestJson("/api/scheduler/restart", schedulerHealthResponseSchema, {
      method: "POST",
      body: schedulerLifecycleRequestSchema.parse(body),
    });
  },
  getSchedulerLogs: (limit = 200) => {
    return requestJson(`/api/scheduler/logs${query({ limit })}`, schedulerLogsResponseSchema);
  },
  listRuns: (projectId: string) => {
    return requestJson(`/api/projects/${projectId}/runs`, listRunsResponseSchema);
  },
  createRun: (projectId: string, body: CreateRunRequest) => {
    return requestJson(`/api/projects/${projectId}/runs`, runResponseSchema, {
      method: "POST",
      body: createRunRequestSchema.parse(body),
    });
  },
  getRun: (runId: string) => requestJson(`/api/runs/${runId}`, runResponseSchema),
  stopRun: (runId: string, body: StopRunRequest) => {
    return requestJson(`/api/runs/${runId}/stop`, runResponseSchema, {
      method: "POST",
      body: stopRunRequestSchema.parse(body),
    });
  },
  rerunRun: (runId: string, body: RerunRunRequest) => {
    return requestJson(`/api/runs/${runId}/rerun`, runResponseSchema, {
      method: "POST",
      body: rerunRunRequestSchema.parse(body),
    });
  },
  getLogs: (runId: string) => requestJson(`/api/runs/${runId}/logs`, logsResponseSchema),
  getTimeline: (runId: string) =>
    requestJson(`/api/runs/${runId}/timeline`, timelineResponseSchema),
  getGraph: (runId: string) => requestJson(`/api/runs/${runId}/graph`, graphResponseSchema),
  getLineage: (runId: string) => requestJson(`/api/runs/${runId}/lineage`, lineageResponseSchema),
  getLineageNode: (runId: string, taskNodeId: string) => {
    return requestJson(`/api/runs/${runId}/lineage/${taskNodeId}`, lineageNodeResponseSchema);
  },
  comparePreviousSuccess: (runId: string, taskNodeId: string) => {
    return requestJson(
      `/api/runs/${runId}/lineage/${taskNodeId}/compare-previous-success`,
      lineageComparePreviousSuccessResponseSchema,
    );
  },
  getArtifacts: (runId: string) =>
    requestJson(`/api/runs/${runId}/artifacts`, artifactsResponseSchema),
  getArtifactContent: (artifactId: string) => {
    return requestJson(`/api/artifacts/${artifactId}/content`, artifactContentByIdResponseSchema);
  },
  getRawTaskInfoTree: (runId: string) => {
    return requestJson(`/api/runs/${runId}/raw/task-info-tree`, rawTaskInfoTreeResponseSchema);
  },
  getRawTaskInfoTable: (runId: string) => {
    return requestJson(`/api/runs/${runId}/raw/task-info-table`, rawTaskInfoTableResponseSchema);
  },
  getRawScheduler: (runId: string) => {
    return requestJson(`/api/runs/${runId}/raw/scheduler`, rawSchedulerResponseSchema);
  },
  getRawAdapterEvents: (runId: string) => {
    return requestJson(`/api/runs/${runId}/raw/adapter-events`, rawAdapterEventsResponseSchema);
  },
  getFilesTree: (projectId: string) => {
    return requestJson(`/api/projects/${projectId}/files/tree`, fileTreeResponseSchema);
  },
  getWatchEvents: (projectId: string, limit = 200) => {
    return requestJson(
      `/api/projects/${projectId}/watch-events${query({ limit })}`,
      watchEventsResponseSchema,
    );
  },
  createSupportBundle: (projectId: string) => {
    return requestJson(
      `/api/projects/${projectId}/support-bundle`,
      supportBundleResponseArtifactSchema,
      {
        method: "POST",
      },
    );
  },
};

export const queryKeys = {
  health: ["health"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  validation: (projectId: string) => ["projects", projectId, "validation"] as const,
  profiles: (projectId: string, kind?: ProfileKind) =>
    ["projects", projectId, "profiles", kind ?? "all"] as const,
  schedulerHealth: (projectId?: string) => ["scheduler", "health", projectId ?? "global"] as const,
  schedulerLogs: (limit: number) => ["scheduler", "logs", limit] as const,
  runs: (projectId: string) => ["projects", projectId, "runs"] as const,
  run: (runId: string) => ["runs", runId] as const,
  logs: (runId: string) => ["runs", runId, "logs"] as const,
  timeline: (runId: string) => ["runs", runId, "timeline"] as const,
  graph: (runId: string) => ["runs", runId, "graph"] as const,
  lineage: (runId: string) => ["runs", runId, "lineage"] as const,
  lineageNode: (runId: string, taskNodeId: string) =>
    ["runs", runId, "lineage", taskNodeId] as const,
  compare: (runId: string, taskNodeId: string) =>
    ["runs", runId, "lineage", taskNodeId, "compare"] as const,
  artifacts: (runId: string) => ["runs", runId, "artifacts"] as const,
  artifactContent: (artifactId: string) => ["artifacts", artifactId, "content"] as const,
  rawTree: (runId: string) => ["runs", runId, "raw", "tree"] as const,
  rawTable: (runId: string) => ["runs", runId, "raw", "table"] as const,
  rawScheduler: (runId: string) => ["runs", runId, "raw", "scheduler"] as const,
  rawAdapterEvents: (runId: string) => ["runs", runId, "raw", "adapter-events"] as const,
  filesTree: (projectId: string) => ["projects", projectId, "files", "tree"] as const,
  watchEvents: (projectId: string, limit: number) =>
    ["projects", projectId, "watch-events", limit] as const,
};

export type HealthRecord = Awaited<ReturnType<(typeof api)["getHealth"]>>;
export type ProjectListRecord = Awaited<ReturnType<(typeof api)["listProjects"]>>;
export type ProjectRecord = Awaited<ReturnType<(typeof api)["getProject"]>>;
export type ValidationRecord = Awaited<ReturnType<(typeof api)["validateProject"]>>;
export type ProfileListRecord = Awaited<ReturnType<(typeof api)["listProfiles"]>>;
export type ProfileRecord = Awaited<ReturnType<(typeof api)["getProfile"]>>;
export type RunListRecord = Awaited<ReturnType<(typeof api)["listRuns"]>>;
export type RunRecord = Awaited<ReturnType<(typeof api)["getRun"]>>;
export type TimelineRecord = Awaited<ReturnType<(typeof api)["getTimeline"]>>;
export type GraphRecord = Awaited<ReturnType<(typeof api)["getGraph"]>>;
export type LineageRecord = Awaited<ReturnType<(typeof api)["getLineage"]>>;
export type CompareRecord = Awaited<ReturnType<(typeof api)["comparePreviousSuccess"]>>;
export type ArtifactListRecord = Awaited<ReturnType<(typeof api)["getArtifacts"]>>;
export type ArtifactRecord = ArtifactListRecord[number];
export type SchedulerHealthRecord = Awaited<ReturnType<(typeof api)["getSchedulerHealth"]>>;
export type FileTreeRecord = Awaited<ReturnType<(typeof api)["getFilesTree"]>>;
export type FileTreeNodeRecord = FileTreeRecord[number];
export type WatchEventsRecord = Awaited<ReturnType<(typeof api)["getWatchEvents"]>>;
export type SupportBundleArtifactRecord = Awaited<ReturnType<(typeof api)["createSupportBundle"]>>;
