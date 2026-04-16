import type { ValidateProjectResponse } from "@gokart-station/shared";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, PlayCircle, SearchCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CapabilityStrip,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  ModalCard,
  ModeBadge,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/surface";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ApiError,
  api,
  type ProjectRecord,
  queryKeys,
  type RunListRecord,
  type SchedulerHealthRecord,
} from "@/lib/api";
import { formatDateTime, formatDuration, summarizePath } from "@/lib/format";
import { cn } from "@/lib/utils";
import { emptyProjectFormValues, ProjectForm, projectFormValuesToRequest } from "./project-form";

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [validationModal, setValidationModal] = useState<{
    projectName: string;
    result: ValidateProjectResponse;
  } | null>(null);
  const [validationCache, setValidationCache] = useState<Record<string, ValidateProjectResponse>>(
    {},
  );

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: api.listProjects,
  });
  const globalSchedulerQuery = useQuery({
    queryKey: queryKeys.schedulerHealth(),
    queryFn: () => api.getSchedulerHealth(),
  });

  const runsQueries = useQueries({
    queries: (projectsQuery.data ?? []).map((project) => ({
      queryKey: queryKeys.runs(project.id),
      queryFn: () => api.listRuns(project.id),
    })),
  });
  const schedulerQueries = useQueries({
    queries: (projectsQuery.data ?? []).map((project) => ({
      queryKey: queryKeys.schedulerHealth(project.id),
      queryFn: () => api.getSchedulerHealth(project.id),
    })),
  });

  const createProjectMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      navigate(`/projects/${project.id}`);
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });

  const validateProjectMutation = useMutation({
    mutationFn: async (projectId: string) => api.validateProject(projectId),
  });

  if (projectsQuery.isLoading) {
    return <LoadingState label="Loading registered gokart projects..." />;
  }

  if (projectsQuery.error) {
    return (
      <ErrorState
        action={
          <Button onClick={() => void projectsQuery.refetch()} variant="outline">
            Retry
          </Button>
        }
        message={
          projectsQuery.error instanceof Error
            ? projectsQuery.error.message
            : "Project fetch failed."
        }
        title="Projects could not be loaded"
      />
    );
  }

  const projects = projectsQuery.data ?? [];
  const controlModeProjects = projects.filter(
    (project) => project.connection.accessMode !== "observer",
  );
  const shouldShowSchedulerBanner =
    controlModeProjects.length > 0 &&
    globalSchedulerQuery.data &&
    globalSchedulerQuery.data.health !== "healthy";

  return (
    <div className="space-y-6">
      {validationModal ? (
        <ModalCard
          description="Validation is mode-aware. Observer focuses on workspace scope; operator and managed include target repo and scheduler checks."
          onClose={() => setValidationModal(null)}
          title={`${validationModal.projectName}: validation result`}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <StatusBadge status={validationModal.result.ok ? "success" : "warning"} />
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                Scheduler {validationModal.result.schedulerHealth}
              </span>
            </div>
            <CapabilityStrip capabilities={validationModal.result.resolvedCapabilities} />
            {validationModal.result.issues.length === 0 ? (
              <InlineNotice title="No warnings or errors" tone="success">
                The current connection satisfies the active mode boundary.
              </InlineNotice>
            ) : (
              <div className="space-y-3">
                {validationModal.result.issues.map((issue) => (
                  <div
                    className={cn(
                      "rounded-2xl border p-4",
                      issue.level === "error"
                        ? "border-rose-200 bg-rose-50"
                        : "border-amber-200 bg-amber-50",
                    )}
                    key={`${issue.code}-${issue.message}`}
                  >
                    <div className="text-sm font-semibold text-slate-950">
                      {issue.level.toUpperCase()} · {issue.code}
                    </div>
                    <div className="mt-1 text-sm text-slate-700">{issue.message}</div>
                    {issue.field ? (
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {issue.field}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ModalCard>
      ) : null}

      <PageHeader
        actions={
          <Button onClick={() => navigate("/projects")} variant="ghost">
            Control Surface
          </Button>
        }
        description="Register independent target gokart repositories, inspect capability boundaries, and launch operator flows without collapsing station into a file browser."
        title="Projects"
      />

      {shouldShowSchedulerBanner ? (
        <InlineNotice title="luigid is not healthy for control-plane projects">
          Operator and managed projects are registered, but the local scheduler is currently{" "}
          <strong>{globalSchedulerQuery.data?.health}</strong>. Use the connection screen to start
          or restart it before issuing new runs.
        </InlineNotice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_420px]">
        <div className="space-y-4">
          {projects.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => navigate("/projects")} variant="outline">
                  Create the first project
                </Button>
              }
              message="Start with an observer workspace or wire an operator connection to an external target repo."
              title="No gokart projects are registered yet"
            />
          ) : (
            projects.map((project: ProjectRecord, index: number) => {
              const runs = (runsQueries[index]?.data ?? []) as RunListRecord;
              const lastRun = runs[0] ?? null;
              const runningRunCount = runs.filter((run) =>
                ["queued", "starting", "running", "stopping"].includes(run.status),
              ).length;
              const scheduler = schedulerQueries[index]?.data as SchedulerHealthRecord | undefined;
              const validation = validationCache[project.id];

              return (
                <SectionCard
                  actions={
                    <>
                      <Link
                        className={buttonVariants({ size: "sm" })}
                        to={`/projects/${project.id}`}
                      >
                        Open Detail
                      </Link>
                      <Button
                        onClick={async () => {
                          const result = await validateProjectMutation.mutateAsync(project.id);
                          setValidationCache((current) => ({ ...current, [project.id]: result }));
                          setValidationModal({ projectName: project.name, result });
                        }}
                        size="sm"
                        variant="outline"
                      >
                        <SearchCheck className="size-4" />
                        Validate
                      </Button>
                      <Link
                        className={cn(
                          buttonVariants({ size: "sm", variant: "outline" }),
                          !project.capabilities.canRun ? "pointer-events-none opacity-50" : "",
                        )}
                        to={`/projects/${project.id}/runs/new`}
                      >
                        <PlayCircle className="size-4" />
                        Quick Run
                      </Link>
                      <Button
                        onClick={() => {
                          if (!window.confirm(`Delete project ${project.name}?`)) {
                            return;
                          }
                          void deleteProjectMutation.mutateAsync(project.id);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  }
                  description="Project detail stays separate from the station repo. Access mode and capabilities are derived from the current connection."
                  key={project.id}
                  title={project.name}
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <ModeBadge accessMode={project.connection.accessMode} />
                        <CapabilityStrip capabilities={project.capabilities} dense />
                        {project.connection.accessMode === "observer" ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                            read-only
                          </span>
                        ) : null}
                      </div>
                      <dl className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                          <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Target root
                          </dt>
                          <dd className="mt-2 font-medium">
                            {project.connection.projectRootDir
                              ? summarizePath(project.connection.projectRootDir)
                              : "Observer connection"}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                          <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Workspace
                          </dt>
                          <dd className="mt-2 font-medium">
                            {summarizePath(project.connection.workspaceDirectory)}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                          <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Entrypoint
                          </dt>
                          <dd className="mt-2 font-medium">
                            {project.connection.entrypointPath ?? "Not required in observer"}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                          <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Scheduler
                          </dt>
                          <dd className="mt-2 flex items-center gap-2 font-medium">
                            <StatusBadge status={scheduler?.health ?? "idle"} />
                            {scheduler?.message ?? "No scheduler check yet"}
                          </dd>
                        </div>
                      </dl>
                      {validation ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={validation.ok ? "success" : "warning"} />
                            <span className="text-sm text-slate-700">
                              {validation.issues.length === 0
                                ? "Last validation passed without issues."
                                : `${validation.issues.length} issue(s) captured in the last validation run.`}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                      <StatTile
                        accent={lastRun ? <StatusBadge status={lastRun.status} /> : null}
                        label="Last Run"
                        value={
                          lastRun ? formatDuration(lastRun.startedAt, lastRun.finishedAt) : "None"
                        }
                      />
                      <StatTile label="Running" value={runningRunCount} />
                      <StatTile label="Updated" value={formatDateTime(project.updatedAt)} />
                    </div>
                  </div>
                </SectionCard>
              );
            })
          )}
        </div>

        <SectionCard
          description="Observer only needs a workspace directory. Operator and managed require explicit spawn paths before run control is enabled."
          title="Register Project"
        >
          {createProjectMutation.error instanceof ApiError ? (
            <InlineNotice title="Project creation failed">
              {createProjectMutation.error.message}
            </InlineNotice>
          ) : null}
          <ProjectForm
            busy={createProjectMutation.isPending}
            configProfiles={[]}
            envProfiles={[]}
            initialValues={emptyProjectFormValues}
            onSubmit={async (values) => {
              await createProjectMutation.mutateAsync(projectFormValuesToRequest(values));
            }}
            submitLabel="Create project"
          />
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 text-amber-700" />
              <div className="space-y-2 text-sm leading-6 text-slate-700">
                <p>
                  The station repo and the target gokart repo stay in different directories. Point
                  `projectRootDir` at the target repo, and keep the station workspace separate.
                </p>
                <Link
                  className="inline-flex items-center gap-2 font-medium text-primary"
                  to="/projects"
                >
                  Review registered projects
                  <ExternalLink className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
