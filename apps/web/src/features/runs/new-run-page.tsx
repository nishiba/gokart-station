import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CopyPlus, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createEmptyParameterRow,
  ParameterEditor,
  type ParameterRow,
  parameterRowsFromValues,
  parameterRowsToRecord,
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
  selectClassName,
} from "@/components/surface";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, api, type ProfileListRecord, queryKeys, type RunListRecord } from "@/lib/api";

export const NewRunPage = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const projectId = params.projectId;
  const cloneFromRunId = searchParams.get("fromRun");
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [rootTaskName, setRootTaskName] = useState("PublishReport");
  const [label, setLabel] = useState("");
  const [parameterRows, setParameterRows] = useState<ParameterRow[]>([
    { ...createEmptyParameterRow(), key: "message", value: "hello from gokart-station" },
    { ...createEmptyParameterRow(), key: "report_date", value: "2026-04-15" },
    { ...createEmptyParameterRow(), key: "rerun_token", value: "ui" },
    { ...createEmptyParameterRow(), key: "simulateDelayMs", type: "number", value: "0" },
  ]);
  const [configProfileId, setConfigProfileId] = useState("");
  const [envProfileId, setEnvProfileId] = useState("");
  const [importRunId, setImportRunId] = useState("");
  const [workerCount, setWorkerCount] = useState("1");
  const [rerunMode, setRerunMode] = useState<
    "none" | "same_spec" | "force_rerun_flag" | "with_param_override" | "with_profile_override"
  >("same_spec");
  const [captureTaskInfoTree, setCaptureTaskInfoTree] = useState(true);
  const [captureTaskInfoTable, setCaptureTaskInfoTable] = useState(true);
  const [captureArtifactManifest, setCaptureArtifactManifest] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: projectId ? queryKeys.project(projectId) : ["projects", "missing"],
    queryFn: () => api.getProject(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const runsQuery = useQuery({
    queryKey: projectId ? queryKeys.runs(projectId) : ["runs", "missing"],
    queryFn: () => api.listRuns(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: projectId ? queryKeys.profiles(projectId) : ["profiles", "missing"],
    queryFn: () => api.listProfiles(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const resolvedConfigProfileQuery = useQuery({
    queryKey:
      configProfileId && projectId
        ? ["profiles", configProfileId, "resolved"]
        : ["profiles", "config", "none"],
    queryFn: () => api.resolveProfile(configProfileId),
    enabled: Boolean(configProfileId),
  });
  const resolvedEnvProfileQuery = useQuery({
    queryKey:
      envProfileId && projectId
        ? ["profiles", envProfileId, "resolved"]
        : ["profiles", "env", "none"],
    queryFn: () => api.resolveProfile(envProfileId),
    enabled: Boolean(envProfileId),
  });

  const createRunMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createRun>[1]) => api.createRun(projectId ?? "", body),
    onSuccess: (run) => {
      navigate(`/projects/${run.projectId}/runs/${run.id}`);
    },
  });

  useEffect(() => {
    if (!cloneFromRunId || !runsQuery.data || prefillApplied) {
      return;
    }

    const sourceRun = runsQuery.data.find((run) => run.id === cloneFromRunId);
    if (!sourceRun) {
      return;
    }

    setRootTaskName(sourceRun.spec.rootTaskName);
    setLabel(sourceRun.spec.label ?? "");
    setParameterRows(parameterRowsFromValues(sourceRun.spec.parameters));
    setConfigProfileId(sourceRun.spec.configProfileId ?? "");
    setEnvProfileId(sourceRun.spec.envProfileId ?? "");
    setWorkerCount(sourceRun.spec.workerCount ? String(sourceRun.spec.workerCount) : "1");
    setRerunMode(sourceRun.spec.rerunMode);
    setCaptureTaskInfoTree(sourceRun.spec.captureTaskInfoTree);
    setCaptureTaskInfoTable(sourceRun.spec.captureTaskInfoTable);
    setCaptureArtifactManifest(sourceRun.spec.captureArtifactManifest);
    setImportRunId(sourceRun.id);
    setPrefillApplied(true);
  }, [cloneFromRunId, prefillApplied, runsQuery.data]);

  if (!projectId || projectQuery.isLoading || profilesQuery.isLoading || runsQuery.isLoading) {
    return <LoadingState label="Preparing run-spec form..." />;
  }

  if (projectQuery.error || profilesQuery.error || runsQuery.error) {
    return (
      <ErrorState
        action={
          <Button
            onClick={() => {
              void projectQuery.refetch();
              void profilesQuery.refetch();
              void runsQuery.refetch();
            }}
            variant="outline"
          >
            Retry
          </Button>
        }
        message="The run-spec screen could not load project, profile, or prior run context."
        title="New run screen unavailable"
      />
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return (
      <ErrorState
        message="The project payload is missing, so run creation cannot be prepared."
        title="Project data unavailable"
      />
    );
  }

  const runs: RunListRecord = runsQuery.data ?? [];
  const profiles: ProfileListRecord = profilesQuery.data ?? [];
  const configProfiles = profiles.filter((profile) => profile.kind === "config");
  const envProfiles = profiles.filter((profile) => profile.kind === "env");
  const recentRootTasks = Array.from(new Set(runs.map((run) => run.spec.rootTaskName))).slice(0, 5);

  if (!project.capabilities.canRun) {
    return (
      <SectionCard
        description="Observer projects may inspect run history, but they cannot create or control runs."
        title="Read-only mode"
      >
        <InlineNotice title="Run creation is disabled for this project">
          Switch the connection to operator or managed and provide target repo spawn paths before
          opening the run spec surface.
        </InlineNotice>
        <div className="mt-4">
          <Link className={buttonVariants({ variant: "outline" })} to={`/projects/${project.id}`}>
            <ArrowLeft className="size-4" />
            Back to project
          </Link>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Link className={buttonVariants({ variant: "outline" })} to={`/projects/${project.id}`}>
            <ArrowLeft className="size-4" />
            Back to project
          </Link>
        }
        description="Build a run spec against the current connection, resolve config/env profiles, and dispatch it through the local control plane."
        title="New Run"
      />

      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge accessMode={project.connection.accessMode} />
        <CapabilityStrip capabilities={project.capabilities} />
      </div>

      {createRunMutation.error instanceof ApiError ? (
        <InlineNotice title="Run creation failed">{createRunMutation.error.message}</InlineNotice>
      ) : null}
      {formError ? <InlineNotice title="Run spec is invalid">{formError}</InlineNotice> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);

            try {
              const parameters = parameterRowsToRecord(parameterRows);
              void createRunMutation.mutateAsync({
                rootTaskName: rootTaskName.trim(),
                label: label.trim() || null,
                parameters,
                configProfileId: configProfileId || null,
                envProfileId: envProfileId || null,
                rerunMode,
                workerCount: workerCount.trim() ? Number(workerCount) : null,
                captureTaskInfoTree,
                captureTaskInfoTable,
                captureArtifactManifest,
              });
            } catch (error) {
              setFormError(error instanceof Error ? error.message : "Invalid run spec.");
            }
          }}
        >
          <SectionCard
            description="Root task selection stays explicit because station does not infer execution intent from browsing the target repo."
            title="Root Task"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <FieldLabel label="Root task name" required />
                <input
                  aria-label="Root task name"
                  className={inputClassName}
                  onChange={(event) => setRootTaskName(event.target.value)}
                  required
                  value={rootTaskName}
                />
              </div>
              <div className="space-y-2">
                <FieldLabel label="Run label" />
                <input
                  aria-label="Run label"
                  className={inputClassName}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="manual run"
                  value={label}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {recentRootTasks.map((task) => (
                  <button
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700"
                    key={task}
                    onClick={() => setRootTaskName(task)}
                    type="button"
                  >
                    {task}
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            description="Parameters support typed string, number, boolean, and JSON values. Import from a prior run when you need a quick clone."
            title="Parameters"
          >
            <div className="space-y-4">
              {runs.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    aria-label="Import parameters from previous run"
                    className={selectClassName}
                    onChange={(event) => setImportRunId(event.target.value)}
                    value={importRunId}
                  >
                    <option value="">Import from previous run…</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.spec.rootTaskName} · {run.spec.label ?? run.id}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => {
                      const sourceRun = runs.find((run) => run.id === importRunId);
                      if (!sourceRun) {
                        return;
                      }
                      setParameterRows(parameterRowsFromValues(sourceRun.spec.parameters));
                    }}
                    type="button"
                    variant="outline"
                  >
                    <CopyPlus className="size-4" />
                    Import
                  </Button>
                </div>
              ) : null}
              <ParameterEditor
                hint="JSON rows are parsed on submit. Invalid JSON blocks the form."
                label="Parameter set"
                onChange={setParameterRows}
                rows={parameterRows}
              />
            </div>
          </SectionCard>

          <SectionCard
            description="Resolve config and env profiles before submit so operator runs stay explainable."
            title="Profiles"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel label="Config profile" />
                <select
                  aria-label="Config profile"
                  className={selectClassName}
                  onChange={(event) => setConfigProfileId(event.target.value)}
                  value={configProfileId}
                >
                  <option value="">None</option>
                  {configProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <FieldLabel label="Env profile" />
                <select
                  aria-label="Env profile"
                  className={selectClassName}
                  onChange={(event) => setEnvProfileId(event.target.value)}
                  value={envProfileId}
                >
                  <option value="">None</option>
                  {envProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            description="Station always targets the central scheduler path. Capture flags keep task-info and artifact metadata explicit."
            title="Execution"
          >
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel label="Worker count" />
                  <input
                    aria-label="Worker count"
                    className={inputClassName}
                    min="1"
                    onChange={(event) => setWorkerCount(event.target.value)}
                    type="number"
                    value={workerCount}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel label="Rerun mode" />
                  <select
                    aria-label="Rerun mode"
                    className={selectClassName}
                    onChange={(event) =>
                      setRerunMode(
                        event.target.value as
                          | "none"
                          | "same_spec"
                          | "force_rerun_flag"
                          | "with_param_override"
                          | "with_profile_override",
                      )
                    }
                    value={rerunMode}
                  >
                    <option value="none">none</option>
                    <option value="same_spec">same_spec</option>
                    <option value="force_rerun_flag">force_rerun_flag</option>
                    <option value="with_param_override">with_param_override</option>
                    <option value="with_profile_override">with_profile_override</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {[
                  [captureTaskInfoTree, setCaptureTaskInfoTree, "Capture task-info tree"] as const,
                  [
                    captureTaskInfoTable,
                    setCaptureTaskInfoTable,
                    "Capture task-info table",
                  ] as const,
                  [
                    captureArtifactManifest,
                    setCaptureArtifactManifest,
                    "Capture artifact manifest",
                  ] as const,
                ].map(([value, setValue, labelText]) => (
                  <label
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700"
                    key={labelText}
                  >
                    <input
                      checked={value}
                      onChange={(event) => setValue(event.target.checked)}
                      type="checkbox"
                    />
                    {labelText}
                  </label>
                ))}
              </div>
            </div>
          </SectionCard>

          <div className="flex flex-wrap gap-3">
            <Button disabled={createRunMutation.isPending} type="submit">
              <PlayCircle className="size-4" />
              Run now
            </Button>
            <Button disabled type="button" variant="outline">
              Save draft
            </Button>
            <Button disabled type="button" variant="ghost">
              Save as template
            </Button>
          </div>
        </form>

        <div className="space-y-6">
          <SectionCard title="Connection Snapshot">
            <CodeBlock
              value={{
                projectName: project.name,
                accessMode: project.connection.accessMode,
                workspaceDirectory: project.connection.workspaceDirectory,
                projectRootDir: project.connection.projectRootDir,
                entrypointPath: project.connection.entrypointPath,
              }}
            />
          </SectionCard>

          <SectionCard title="Resolved Profile Preview">
            {configProfileId || envProfileId ? (
              <div className="space-y-4">
                {configProfileId ? (
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-950">Config profile</div>
                    <CodeBlock value={resolvedConfigProfileQuery.data ?? { loading: true }} />
                  </div>
                ) : null}
                {envProfileId ? (
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-950">Env profile</div>
                    <CodeBlock value={resolvedEnvProfileQuery.data ?? { loading: true }} />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                message="Select config or env profiles to preview the resolved key set before submit."
                title="No profile selected"
              />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
};
