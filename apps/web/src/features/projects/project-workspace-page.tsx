import type { AccessMode, ProfileKind, StopMode } from "@gokart-station/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Square,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createEmptyStringRow,
  StringRecordEditor,
  type StringRow,
  stringRowsFromRecord,
  stringRowsToRecord,
} from "@/components/key-value-editor";
import {
  CapabilityStrip,
  CodeBlock,
  EmptyState,
  ErrorState,
  FieldLabel,
  InlineNotice,
  inputClassName,
  LoadingState,
  ModeBadge,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
  selectClassName,
} from "@/components/surface";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ApiError,
  api,
  type FileTreeNodeRecord,
  type ProfileListRecord,
  type ProfileRecord,
  queryKeys,
  type RunListRecord,
  type RunRecord,
  type SupportBundleArtifactRecord,
  type ValidationRecord,
  type WatchEventsRecord,
} from "@/lib/api";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProjectForm, projectFormValuesToRequest, projectToFormValues } from "./project-form";

type ProjectTab = "overview" | "runs" | "profiles" | "files" | "watch" | "connection";

type ProfileDraft = {
  id: string | null;
  kind: ProfileKind;
  name: string;
  description: string;
  extendsProfileId: string;
  values: StringRow[];
  maskedKeys: string;
  isDefault: boolean;
  enabledForModes: AccessMode[];
};

const isRunActive = (run: RunRecord) =>
  ["queued", "starting", "running", "stopping"].includes(run.status);

const emptyProfileDraft = (kind: ProfileKind): ProfileDraft => ({
  id: null,
  kind,
  name: "",
  description: "",
  extendsProfileId: "",
  values: [createEmptyStringRow()],
  maskedKeys: "",
  isDefault: false,
  enabledForModes: ["operator", "managed"],
});

const profileToDraft = (profile: ProfileRecord): ProfileDraft => ({
  id: profile.id,
  kind: profile.kind,
  name: profile.name,
  description: profile.description ?? "",
  extendsProfileId: profile.extendsProfileId ?? "",
  values: stringRowsFromRecord(profile.values),
  maskedKeys: profile.maskedKeys.join(", "),
  isDefault: profile.isDefault,
  enabledForModes: profile.enabledForModes,
});

const findFileTreeNode = (
  nodes: FileTreeNodeRecord[],
  relativePath: string | null,
): FileTreeNodeRecord | null => {
  if (!relativePath) {
    return null;
  }

  for (const node of nodes) {
    if (node.relativePath === relativePath) {
      return node;
    }

    if (node.children) {
      const childMatch = findFileTreeNode(node.children, relativePath);
      if (childMatch) {
        return childMatch;
      }
    }
  }

  return null;
};

const firstFileTreeNode = (nodes: FileTreeNodeRecord[]): FileTreeNodeRecord | null => {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      return firstFileTreeNode(node.children) ?? node;
    }

    return node;
  }

  return null;
};

const FileTreeBranch = ({
  depth = 0,
  nodes,
  onSelect,
  selectedPath,
}: {
  depth?: number;
  nodes: FileTreeNodeRecord[];
  onSelect: (relativePath: string) => void;
  selectedPath: string | null;
}) => {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.relativePath}>
          <button
            className={cn(
              "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-100",
              selectedPath === node.relativePath
                ? "bg-slate-950 text-white hover:bg-slate-900"
                : "text-slate-700",
            )}
            onClick={() => onSelect(node.relativePath)}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
            type="button"
          >
            <span className="truncate font-medium">
              {node.isDirectory ? "dir" : "file"} · {node.name}
            </span>
            {node.inferredArtifactKind ? (
              <span
                className={cn(
                  "ml-3 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                  selectedPath === node.relativePath
                    ? "border-white/30 text-white/80"
                    : "border-slate-200 text-slate-500",
                )}
              >
                {node.inferredArtifactKind}
              </span>
            ) : null}
          </button>
          {node.children && node.children.length > 0 ? (
            <FileTreeBranch
              depth={depth + 1}
              nodes={node.children}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
};

export const ProjectWorkspacePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const params = useParams();
  const projectId = params.projectId;
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft("config"));
  const [validationResult, setValidationResult] = useState<ValidationRecord | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [latestSupportBundle, setLatestSupportBundle] =
    useState<SupportBundleArtifactRecord | null>(null);

  const activeTab: ProjectTab = location.pathname.endsWith("/profiles")
    ? "profiles"
    : location.pathname.endsWith("/connection")
      ? "connection"
      : ((searchParams.get("tab") as ProjectTab | null) ?? "overview");

  const setActiveTab = (tab: ProjectTab) => {
    if (!projectId) {
      return;
    }

    if (tab === "profiles") {
      navigate(`/projects/${projectId}/profiles`);
      return;
    }

    if (tab === "connection") {
      navigate(`/projects/${projectId}/connection`);
      return;
    }

    navigate({
      pathname: `/projects/${projectId}`,
      search: tab === "overview" ? "" : `?tab=${tab}`,
    });
  };

  const projectQuery = useQuery({
    queryKey: projectId ? queryKeys.project(projectId) : ["projects", "missing"],
    queryFn: () => api.getProject(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const runsQuery = useQuery({
    queryKey: projectId ? queryKeys.runs(projectId) : ["runs", "missing"],
    queryFn: () => api.listRuns(projectId ?? ""),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some(isRunActive) ? 1_000 : false;
    },
  });
  const profilesQuery = useQuery({
    queryKey: projectId ? queryKeys.profiles(projectId) : ["profiles", "missing"],
    queryFn: () => api.listProfiles(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const schedulerHealthQuery = useQuery({
    queryKey: projectId ? queryKeys.schedulerHealth(projectId) : ["scheduler", "missing"],
    queryFn: () => api.getSchedulerHealth(projectId),
    enabled: Boolean(projectId),
  });
  const schedulerLogsQuery = useQuery({
    queryKey: queryKeys.schedulerLogs(20),
    queryFn: () => api.getSchedulerLogs(20),
    enabled: Boolean(projectId) && activeTab === "connection",
  });
  const fileTreeQuery = useQuery({
    queryKey: projectId ? queryKeys.filesTree(projectId) : ["projects", "files", "missing"],
    queryFn: () => api.getFilesTree(projectId ?? ""),
    enabled: Boolean(projectId) && activeTab === "files",
  });
  const watchEventsQuery = useQuery({
    queryKey: projectId ? queryKeys.watchEvents(projectId, 200) : ["projects", "watch", "missing"],
    queryFn: () => api.getWatchEvents(projectId ?? "", 200),
    enabled: Boolean(projectId) && activeTab === "watch",
  });
  const resolvedProfileQuery = useQuery({
    queryKey:
      profileDraft.id && projectId
        ? ["profiles", profileDraft.id, "resolved"]
        : ["profiles", "resolved", "none"],
    queryFn: () => api.resolveProfile(profileDraft.id ?? ""),
    enabled: Boolean(profileDraft.id) && activeTab === "profiles",
  });

  useEffect(() => {
    if (!profilesQuery.data) {
      return;
    }

    const matchingProfile =
      profilesQuery.data.find((profile) => profile.id === profileDraft.id) ??
      profilesQuery.data[0] ??
      null;
    if (matchingProfile) {
      setProfileDraft(profileToDraft(matchingProfile));
      return;
    }

    setProfileDraft(emptyProfileDraft("config"));
  }, [profilesQuery.data, profileDraft.id]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    setLatestSupportBundle(null);
    setSelectedFilePath(null);
  }, [projectId]);

  useEffect(() => {
    if (!fileTreeQuery.data || fileTreeQuery.data.length === 0) {
      return;
    }

    const currentSelection = findFileTreeNode(fileTreeQuery.data, selectedFilePath);
    if (currentSelection) {
      return;
    }

    const firstNode = firstFileTreeNode(fileTreeQuery.data);
    if (firstNode) {
      setSelectedFilePath(firstNode.relativePath);
    }
  }, [fileTreeQuery.data, selectedFilePath]);

  const validateProjectMutation = useMutation({
    mutationFn: async () => api.validateProject(projectId ?? ""),
    onSuccess: (result) => {
      setValidationResult(result);
    },
  });
  const updateProjectMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.updateProject>[1]) =>
      api.updateProject(projectId ?? "", body),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      setValidationResult(null);
    },
  });
  const createProfileMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createProfile>[1]) =>
      api.createProfile(projectId ?? "", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles(projectId ?? "") });
    },
  });
  const updateProfileMutation = useMutation({
    mutationFn: ({
      profileId,
      body,
    }: {
      profileId: string;
      body: Parameters<typeof api.updateProfile>[1];
    }) => api.updateProfile(profileId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles(projectId ?? "") });
    },
  });
  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => api.deleteProfile(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles(projectId ?? "") });
    },
  });
  const rerunMutation = useMutation({
    mutationFn: ({ runId, body }: { runId: string; body: Parameters<typeof api.rerunRun>[1] }) =>
      api.rerunRun(runId, body),
    onSuccess: (run) => navigate(`/projects/${run.projectId}/runs/${run.id}`),
  });
  const stopMutation = useMutation({
    mutationFn: ({ runId, mode }: { runId: string; mode: StopMode }) =>
      api.stopRun(runId, { mode }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(projectId ?? "") });
    },
  });
  const schedulerLifecycleMutation = useMutation({
    mutationFn: async (action: "start" | "stop" | "restart") => {
      if (!projectId) {
        throw new Error("Project is not available.");
      }

      if (action === "start") {
        return api.startScheduler({ projectId });
      }
      if (action === "stop") {
        return api.stopScheduler({ projectId });
      }

      return api.restartScheduler({ projectId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedulerHealth(projectId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedulerLogs(20) });
    },
  });
  const supportBundleMutation = useMutation({
    mutationFn: async () => api.createSupportBundle(projectId ?? ""),
    onSuccess: (artifact) => {
      setLatestSupportBundle(artifact);
    },
  });

  if (!projectId || projectQuery.isLoading || runsQuery.isLoading || profilesQuery.isLoading) {
    return <LoadingState label="Loading project control surface..." />;
  }

  if (projectQuery.error || runsQuery.error || profilesQuery.error) {
    return (
      <ErrorState
        action={
          <Button
            onClick={() => {
              void projectQuery.refetch();
              void runsQuery.refetch();
              void profilesQuery.refetch();
            }}
            variant="outline"
          >
            Retry
          </Button>
        }
        message="Project detail could not be assembled from the current API responses."
        title="Project surface failed to load"
      />
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return (
      <ErrorState
        message="Project detail did not return a project payload."
        title="Project surface missing data"
      />
    );
  }

  const runs: RunListRecord = runsQuery.data ?? [];
  const profiles: ProfileListRecord = profilesQuery.data ?? [];
  const configProfiles = profiles.filter((profile) => profile.kind === "config");
  const envProfiles = profiles.filter((profile) => profile.kind === "env");
  const activeRuns = runs.filter(isRunActive);
  const failedRuns = runs.filter((run) => run.status === "failed").slice(0, 5);
  const capabilityError =
    createProfileMutation.error instanceof ApiError ||
    updateProfileMutation.error instanceof ApiError
      ? (createProfileMutation.error ?? updateProfileMutation.error)
      : null;
  const selectedFileNode = findFileTreeNode(fileTreeQuery.data ?? [], selectedFilePath);
  const watchEvents: WatchEventsRecord = watchEventsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Button onClick={() => void validateProjectMutation.mutateAsync()} variant="outline">
              <RefreshCw className="size-4" />
              Validate project
            </Button>
            <Link
              className={cn(
                buttonVariants(),
                !project.capabilities.canRun ? "pointer-events-none opacity-50" : "",
              )}
              to={`/projects/${project.id}/runs/new`}
            >
              <PlayCircle className="size-4" />
              New run
            </Link>
          </>
        }
        description="Overview, run table, profiles, file/watch diagnostics, and connection controls stay in one mode-aware control surface."
        title={project.name}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge accessMode={project.connection.accessMode} />
        <CapabilityStrip capabilities={project.capabilities} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-[1.5rem] border border-white/70 bg-white/85 p-2 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.45)] backdrop-blur">
        {(["overview", "runs", "profiles", "files", "watch", "connection"] as ProjectTab[]).map(
          (tab) => (
            <button
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                activeTab === tab ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100",
              )}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ),
        )}
      </div>

      {validationResult ? (
        <SectionCard
          description="The current capability snapshot reflects the last explicit validation run."
          title="Latest Validation"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={validationResult.ok ? "success" : "warning"} />
              <StatusBadge status={validationResult.schedulerHealth} />
            </div>
            <CapabilityStrip capabilities={validationResult.resolvedCapabilities} />
            {validationResult.issues.length === 0 ? (
              <InlineNotice title="No current validation issues" tone="success">
                The connection satisfies the active access mode boundary.
              </InlineNotice>
            ) : (
              <div className="grid gap-3">
                {validationResult.issues.map((issue) => (
                  <div
                    className={cn(
                      "rounded-2xl border p-4 text-sm",
                      issue.level === "error"
                        ? "border-rose-200 bg-rose-50"
                        : "border-amber-200 bg-amber-50",
                    )}
                    key={`${issue.code}-${issue.message}`}
                  >
                    <div className="font-semibold text-slate-950">
                      {issue.level.toUpperCase()} · {issue.code}
                    </div>
                    <div className="mt-1 text-slate-700">{issue.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <SectionCard
            description="Home stays a control surface: capability snapshot, scheduler health, recent failures, and workspace summary are all visible before diving into run detail."
            title="Overview"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatTile
                accent={<StatusBadge status={schedulerHealthQuery.data?.health ?? "idle"} />}
                label="Scheduler"
                value={
                  schedulerHealthQuery.data?.message ??
                  schedulerHealthQuery.data?.health ??
                  "Unknown"
                }
              />
              <StatTile label="Active runs" value={activeRuns.length} />
              <StatTile label="Recent failures" value={failedRuns.length} />
              <StatTile label="Profiles" value={`${configProfiles.length + envProfiles.length}`} />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Workspace Summary
                </div>
                <dl className="mt-3 space-y-3 text-sm text-slate-700">
                  <div>
                    <dt className="font-semibold text-slate-950">Workspace</dt>
                    <dd>{project.connection.workspaceDirectory}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-950">Target root</dt>
                    <dd>{project.connection.projectRootDir ?? "Observer workspace only"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-950">Entrypoint</dt>
                    <dd>{project.connection.entrypointPath ?? "Not configured"}</dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Profile Summary
                </div>
                <dl className="mt-3 space-y-3 text-sm text-slate-700">
                  <div>
                    <dt className="font-semibold text-slate-950">Config profiles</dt>
                    <dd>{configProfiles.length}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-950">Env profiles</dt>
                    <dd>{envProfiles.length}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-950">Default config</dt>
                    <dd>{configProfiles.find((profile) => profile.isDefault)?.name ?? "None"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-950">Default env</dt>
                    <dd>{envProfiles.find((profile) => profile.isDefault)?.name ?? "None"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent failure path">
            {failedRuns.length === 0 ? (
              <EmptyState
                message="This project has no failed runs in the current local database."
                title="No recent failures"
              />
            ) : (
              <div className="space-y-3">
                {failedRuns.map((run) => (
                  <Link
                    className="block rounded-2xl border border-slate-200 bg-slate-50/80 p-4 transition hover:border-slate-300"
                    key={run.id}
                    to={`/projects/${project.id}/runs/${run.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{run.spec.rootTaskName}</div>
                        <div className="text-sm text-slate-600">
                          {run.spec.label ?? "Unlabeled run"} · {formatDateTime(run.createdAt)}
                        </div>
                      </div>
                      <StatusBadge status={run.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "runs" ? (
        <SectionCard
          actions={
            <Link
              className={buttonVariants({ size: "sm" })}
              to={`/projects/${project.id}/runs/new`}
            >
              <PlayCircle className="size-4" />
              New run
            </Link>
          }
          description="Observer can inspect the full run list, but rerun and stop stay disabled until control capabilities are present."
          title="Runs"
        >
          {runs.length === 0 ? (
            <EmptyState
              message="Create the first run spec to start building local run history."
              title="No runs yet"
            />
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Root task</th>
                    <th className="px-3 py-2">Profiles</th>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Exit</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr className="border-t border-slate-200" key={run.id}>
                      <td className="px-3 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-950">{run.spec.rootTaskName}</div>
                        <div className="text-slate-500">{run.spec.label ?? "No label"}</div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        cfg:{run.spec.configProfileId ?? "none"} / env:
                        {run.spec.envProfileId ?? "none"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{formatDateTime(run.startedAt)}</td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{run.exitCode ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            to={`/projects/${project.id}/runs/${run.id}`}
                          >
                            Open
                          </Link>
                          <Link
                            className={buttonVariants({ size: "sm", variant: "ghost" })}
                            to={`/projects/${project.id}/runs/new?fromRun=${run.id}`}
                          >
                            Clone spec
                          </Link>
                          {project.capabilities.canRerun ? (
                            <Button
                              onClick={() =>
                                void rerunMutation.mutateAsync({
                                  runId: run.id,
                                  body: { rerunMode: "same_spec" },
                                })
                              }
                              size="sm"
                              variant="ghost"
                            >
                              <RotateCcw className="size-4" />
                              Rerun
                            </Button>
                          ) : null}
                          {project.capabilities.canStop && isRunActive(run) ? (
                            <Button
                              onClick={() =>
                                void stopMutation.mutateAsync({
                                  runId: run.id,
                                  mode: "graceful",
                                })
                              }
                              size="sm"
                              variant="ghost"
                            >
                              <Square className="size-4" />
                              Stop
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {activeTab === "profiles" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_420px]">
          <SectionCard
            description="Observer can inspect profile lineage and resolved values. Operator and managed can edit config and env surfaces."
            title="Profiles"
          >
            {capabilityError instanceof ApiError ? (
              <InlineNotice title="Profile mutation failed">{capabilityError.message}</InlineNotice>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">Config profiles</div>
                    {!project.capabilities.canEditProfiles ? (
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        read-only
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {configProfiles.length === 0 ? (
                      <EmptyState
                        message="No config profiles are registered for this project."
                        title="Empty"
                      />
                    ) : (
                      configProfiles.map((profile) => (
                        <button
                          className={cn(
                            "w-full rounded-2xl border px-4 py-3 text-left transition",
                            profileDraft.id === profile.id
                              ? "border-primary bg-primary/5"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                          key={profile.id}
                          onClick={() => setProfileDraft(profileToDraft(profile))}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-slate-950">{profile.name}</div>
                            {profile.isDefault ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-900">
                                default
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 text-sm text-slate-600">
                            {Object.keys(profile.values).length} override(s) ·{" "}
                            {formatDateTime(profile.updatedAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-950">Env profiles</div>
                  <div className="space-y-2">
                    {envProfiles.length === 0 ? (
                      <EmptyState message="No env profiles are registered." title="Empty" />
                    ) : (
                      envProfiles.map((profile) => (
                        <button
                          className={cn(
                            "w-full rounded-2xl border px-4 py-3 text-left transition",
                            profileDraft.id === profile.id
                              ? "border-primary bg-primary/5"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                          key={profile.id}
                          onClick={() => setProfileDraft(profileToDraft(profile))}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-slate-950">{profile.name}</div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              {profile.maskedKeys.length} masked
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-slate-600">
                            {Object.keys(profile.values).length} override(s) ·{" "}
                            {formatDateTime(profile.updatedAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {project.capabilities.canEditProfiles ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setProfileDraft(emptyProfileDraft("config"))}
                      variant="outline"
                    >
                      New config
                    </Button>
                    <Button
                      onClick={() => setProfileDraft(emptyProfileDraft("env"))}
                      variant="outline"
                    >
                      New env
                    </Button>
                  </div>
                ) : (
                  <InlineNotice title="Observer mode">
                    Profile editing stays disabled in observer mode.
                  </InlineNotice>
                )}
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = {
                      kind: profileDraft.kind,
                      name: profileDraft.name.trim(),
                      description: profileDraft.description.trim() || null,
                      extendsProfileId: profileDraft.extendsProfileId || null,
                      values: stringRowsToRecord(profileDraft.values),
                      maskedKeys: profileDraft.maskedKeys
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 0),
                      isDefault: profileDraft.isDefault,
                      enabledForModes: profileDraft.enabledForModes,
                    };

                    if (profileDraft.id) {
                      void updateProfileMutation.mutateAsync({ profileId: profileDraft.id, body });
                      return;
                    }

                    void createProfileMutation.mutateAsync(body);
                  }}
                >
                  <SectionCard
                    title={profileDraft.id ? "Profile Editor" : "New Profile"}
                    description="Inheritance and resolved preview stay visible so operator changes remain explainable."
                  >
                    <div className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel label="Kind" required />
                          <select
                            className={selectClassName}
                            disabled={!project.capabilities.canEditProfiles}
                            onChange={(event) =>
                              setProfileDraft((current) => ({
                                ...current,
                                kind: event.target.value as ProfileKind,
                              }))
                            }
                            value={profileDraft.kind}
                          >
                            <option value="config">config</option>
                            <option value="env">env</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel label="Name" required />
                          <input
                            className={inputClassName}
                            disabled={!project.capabilities.canEditProfiles}
                            onChange={(event) =>
                              setProfileDraft((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                            required
                            value={profileDraft.name}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel label="Description" />
                        <input
                          className={inputClassName}
                          disabled={!project.capabilities.canEditProfiles}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          value={profileDraft.description}
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel label="Extends" />
                        <select
                          className={selectClassName}
                          disabled={!project.capabilities.canEditProfiles}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              extendsProfileId: event.target.value,
                            }))
                          }
                          value={profileDraft.extendsProfileId}
                        >
                          <option value="">None</option>
                          {profiles
                            .filter(
                              (profile) =>
                                profile.kind === profileDraft.kind &&
                                profile.id !== profileDraft.id,
                            )
                            .map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <StringRecordEditor
                        hint="Env profiles still store string values; masking only affects display."
                        label="Overrides"
                        onChange={(rows) =>
                          setProfileDraft((current) => ({ ...current, values: rows }))
                        }
                        rows={profileDraft.values}
                      />
                      <div className="space-y-2">
                        <FieldLabel hint="Comma-separated" label="Masked keys" />
                        <input
                          className={inputClassName}
                          disabled={!project.capabilities.canEditProfiles}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              maskedKeys: event.target.value,
                            }))
                          }
                          value={profileDraft.maskedKeys}
                        />
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                          <input
                            checked={profileDraft.isDefault}
                            disabled={!project.capabilities.canEditProfiles}
                            onChange={(event) =>
                              setProfileDraft((current) => ({
                                ...current,
                                isDefault: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          Default profile
                        </label>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <div className="text-sm font-medium text-slate-900">Enabled modes</div>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-700">
                            {(["observer", "operator", "managed"] as AccessMode[]).map((mode) => (
                              <label className="flex items-center gap-2" key={mode}>
                                <input
                                  checked={profileDraft.enabledForModes.includes(mode)}
                                  disabled={!project.capabilities.canEditProfiles}
                                  onChange={(event) =>
                                    setProfileDraft((current) => ({
                                      ...current,
                                      enabledForModes: event.target.checked
                                        ? [...current.enabledForModes, mode]
                                        : current.enabledForModes.filter((entry) => entry !== mode),
                                    }))
                                  }
                                  type="checkbox"
                                />
                                {mode}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {project.capabilities.canEditProfiles ? (
                          <Button type="submit">
                            <SquarePen className="size-4" />
                            {profileDraft.id ? "Save profile" : "Create profile"}
                          </Button>
                        ) : null}
                        {profileDraft.id ? (
                          <Button
                            onClick={() => {
                              const profileId = profileDraft.id;
                              if (!profileId) {
                                return;
                              }
                              if (!window.confirm(`Delete profile ${profileDraft.name}?`)) {
                                return;
                              }
                              void deleteProfileMutation.mutateAsync(profileId);
                              setProfileDraft(emptyProfileDraft(profileDraft.kind));
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </SectionCard>
                </form>

                <SectionCard title="Resolved Preview">
                  {resolvedProfileQuery.data ? (
                    <CodeBlock value={resolvedProfileQuery.data} />
                  ) : (
                    <EmptyState
                      message="Select an existing profile to inspect the inherited resolved values."
                      title="No resolved preview yet"
                    />
                  )}
                </SectionCard>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "files" ? (
        <SectionCard
          actions={
            <Button onClick={() => void fileTreeQuery.refetch()} size="sm" variant="outline">
              <RefreshCw className="size-4" />
              Refresh tree
            </Button>
          }
          description="The file tree stays sandbox-aware. Observer remains workspace-first; operator can inspect target-root metadata without turning the home surface into a file browser."
          title="Files"
        >
          {fileTreeQuery.isLoading ? (
            <LoadingState label="Loading sandboxed file tree..." />
          ) : fileTreeQuery.error ? (
            <ErrorState
              message="The file tree could not be loaded from the current project sandbox."
              title="File tree unavailable"
            />
          ) : !fileTreeQuery.data || fileTreeQuery.data.length === 0 ? (
            <EmptyState
              message="No sandboxed files were returned for the current connection."
              title="File tree empty"
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <div className="max-h-[38rem] overflow-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                <FileTreeBranch
                  nodes={fileTreeQuery.data}
                  onSelect={setSelectedFilePath}
                  selectedPath={selectedFilePath}
                />
              </div>
              <div className="space-y-4">
                {selectedFileNode ? (
                  <CodeBlock
                    value={{
                      name: selectedFileNode.name,
                      relativePath: selectedFileNode.relativePath,
                      absolutePath: selectedFileNode.absolutePath,
                      isDirectory: selectedFileNode.isDirectory,
                      sizeBytes: selectedFileNode.sizeBytes ?? null,
                      inferredArtifactKind: selectedFileNode.inferredArtifactKind ?? null,
                      childCount: selectedFileNode.children?.length ?? 0,
                    }}
                  />
                ) : (
                  <EmptyState
                    message="Select a node from the file tree to inspect its metadata."
                    title="No file selected"
                  />
                )}
                <InlineNotice title="Known limitation" tone="info">
                  This release exposes metadata-only file browsing. Direct text preview and edit are
                  intentionally out of scope.
                </InlineNotice>
              </div>
            </div>
          )}
        </SectionCard>
      ) : null}

      {activeTab === "watch" ? (
        <SectionCard
          actions={
            <>
              <Button onClick={() => void watchEventsQuery.refetch()} size="sm" variant="outline">
                <RefreshCw className="size-4" />
                Refresh watch
              </Button>
              <Button
                onClick={() => void supportBundleMutation.mutateAsync()}
                size="sm"
                variant="outline"
              >
                <Download className="size-4" />
                Export support bundle
              </Button>
            </>
          }
          description="Watch events are planned as a supplemental signal, not the source of truth."
          title="Watch"
        >
          <div className="space-y-4">
            <InlineNotice title="Supplemental signal" tone="info">
              Watch events help explain filesystem movement, but run state still follows scheduler
              state and adapter metadata first.
            </InlineNotice>
            {supportBundleMutation.error instanceof ApiError ? (
              <InlineNotice title="Support bundle export failed">
                {supportBundleMutation.error.message}
              </InlineNotice>
            ) : null}
            {latestSupportBundle ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status="success" />
                  <span className="text-sm text-slate-700">
                    Support bundle manifest written to {latestSupportBundle.relativePath}
                  </span>
                </div>
                <CodeBlock
                  value={{
                    absolutePath: latestSupportBundle.absolutePath,
                    relativePath: latestSupportBundle.relativePath,
                    sizeBytes: latestSupportBundle.sizeBytes ?? null,
                    size: latestSupportBundle.sizeBytes
                      ? formatBytes(latestSupportBundle.sizeBytes)
                      : null,
                    kind: latestSupportBundle.kind,
                    createdAt: latestSupportBundle.createdAt,
                  }}
                />
              </div>
            ) : null}
            {watchEventsQuery.isLoading ? (
              <LoadingState label="Loading watch events..." />
            ) : watchEventsQuery.error ? (
              <ErrorState
                message="Watch events could not be loaded for this project."
                title="Watch event table unavailable"
              />
            ) : watchEvents.length === 0 ? (
              <EmptyState
                message="No watch events are recorded yet for the current project sandbox."
                title="Watch event table empty"
              />
            ) : (
              <div className="overflow-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Occurred</th>
                      <th className="px-3 py-2">Kind</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Related run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchEvents.map((event) => (
                      <tr className="border-t border-slate-200" key={event.id}>
                        <td className="px-3 py-3 text-slate-600">
                          {formatDateTime(event.occurredAt)}
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                            {event.kind}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div className="font-medium text-slate-950">{event.relativePath}</div>
                          <div className="text-xs text-slate-500">
                            {event.inferredArtifactKind ?? "artifact kind unknown"}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{event.runId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "connection" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_420px]">
          <SectionCard
            description="Access mode, paths, validation, and scheduler lifecycle are controlled here."
            title="Connection"
          >
            {updateProjectMutation.error instanceof ApiError ? (
              <InlineNotice title="Connection update failed">
                {updateProjectMutation.error.message}
              </InlineNotice>
            ) : null}
            <ProjectForm
              busy={updateProjectMutation.isPending}
              configProfiles={configProfiles}
              envProfiles={envProfiles}
              initialValues={projectToFormValues(project)}
              onSubmit={async (values) => {
                await updateProjectMutation.mutateAsync(projectFormValuesToRequest(values));
                await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
              }}
              submitLabel="Save connection"
            />
          </SectionCard>

          <div className="space-y-6">
            <SectionCard title="Capability Matrix">
              <CapabilityStrip capabilities={project.capabilities} />
            </SectionCard>
            <SectionCard title="Scheduler Lifecycle">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={schedulerHealthQuery.data?.health ?? "idle"} />
                  <span className="text-sm text-slate-600">
                    {schedulerHealthQuery.data?.message ?? "No scheduler message"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !project.capabilities.canManageScheduler ||
                      schedulerLifecycleMutation.isPending
                    }
                    onClick={() => void schedulerLifecycleMutation.mutateAsync("start")}
                    type="button"
                    variant="outline"
                  >
                    Start
                  </Button>
                  <Button
                    disabled={
                      !project.capabilities.canManageScheduler ||
                      schedulerLifecycleMutation.isPending
                    }
                    onClick={() => void schedulerLifecycleMutation.mutateAsync("restart")}
                    type="button"
                    variant="outline"
                  >
                    Restart
                  </Button>
                  <Button
                    disabled={
                      !project.capabilities.canManageScheduler ||
                      schedulerLifecycleMutation.isPending
                    }
                    onClick={() => void schedulerLifecycleMutation.mutateAsync("stop")}
                    type="button"
                    variant="ghost"
                  >
                    Stop
                  </Button>
                </div>
                <CodeBlock value={schedulerHealthQuery.data ?? { health: "unknown" }} />
              </div>
            </SectionCard>
            <SectionCard title="Scheduler Logs">
              {schedulerLogsQuery.data ? (
                <CodeBlock
                  value={schedulerLogsQuery.data.lines
                    .map((line) => `${line.stream}: ${line.line}`)
                    .join("\n")}
                />
              ) : (
                <EmptyState
                  message="Scheduler logs are only fetched when this tab is active."
                  title="No scheduler logs loaded"
                />
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}
    </div>
  );
};
