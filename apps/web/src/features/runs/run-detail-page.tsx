import type { LogEvent, TaskGraphEdge } from "@gokart-station/shared";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Background, Controls, type Edge, MiniMap, type Node, ReactFlow } from "@xyflow/react";
import { ArrowLeft, Download, Pause, RotateCcw, Search, Square } from "lucide-react";
import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
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
  inputClassName,
  LoadingState,
  ModeBadge,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/surface";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  api,
  type CompareRecord,
  type GraphRecord,
  type LineageRecord,
  queryKeys,
  type RunRecord,
  type TimelineRecord,
} from "@/lib/api";
import { formatBytes, formatDateTime, formatDuration, summarizePath } from "@/lib/format";
import { cn } from "@/lib/utils";

type RunTab = "timeline" | "graph" | "lineage" | "logs" | "artifacts" | "raw";

const isTerminalRun = (run: RunRecord) => ["success", "failed", "canceled"].includes(run.status);
const logIdentity = (log: LogEvent) => `${log.at}|${log.stream}|${log.line}`;
const diffIsMeaningful = (compare: CompareRecord | undefined) => {
  if (!compare?.previous) {
    return false;
  }

  return (
    Object.keys(compare.diff.parameterDiff).length > 0 ||
    compare.diff.stateChanged ||
    compare.diff.processingTimeDiffSec !== null ||
    compare.diff.outputPathDiff.added.length > 0 ||
    compare.diff.outputPathDiff.removed.length > 0
  );
};

const compareResolutionTone = (compare: CompareRecord | undefined) => {
  const status = compare?.diff.compareResolution.status;
  if (status === "matched") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (status === "ambiguous") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
};

const formatCompareResolutionLabel = (compare: CompareRecord | undefined) => {
  const status = compare?.diff.compareResolution.status;
  if (status === "matched") {
    return "compare resolved";
  }

  if (status === "ambiguous") {
    return "ambiguous compare target";
  }

  if (status === "no_previous_success") {
    return "no previous success";
  }

  if (status === "no_candidate") {
    return "no compare target";
  }

  return "compare unavailable";
};

const formatCompareStrategyLabel = (
  strategy: CompareRecord["diff"]["compareResolution"]["strategy"],
) => {
  switch (strategy) {
    case "task_name_unique_candidate":
      return "single same-task candidate";
    case "unique_id":
      return "uniqueId";
    case "parameter_fingerprint":
      return "parameter fingerprint";
    case "topology_signature":
      return "topology signature";
    case "output_path_signature":
      return "output path signature";
    default:
      return "not resolved";
  }
};

const collectConnectedNodeIds = (seedNodeIds: string[], edges: TaskGraphEdge[]) => {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }

  const visited = new Set(seedNodeIds);
  const queue = [...seedNodeIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return visited;
};

const buildFlowGraph = (
  graph: GraphRecord,
  selectedTaskNodeId: string | null,
  changedNodeIds: Set<string>,
  failedOnly: boolean,
  changedOnly: boolean,
) => {
  let visibleNodeIds = new Set(graph.nodes.map((node) => node.id));
  if (failedOnly) {
    visibleNodeIds = collectConnectedNodeIds(
      graph.nodes.filter((node) => node.state === "FAILED").map((node) => node.id),
      graph.edges,
    );
  }

  if (changedOnly) {
    visibleNodeIds = collectConnectedNodeIds([...changedNodeIds], graph.edges);
  }

  const filteredNodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const filteredEdges = graph.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );

  const depthByNodeId = new Map<string, number>(filteredNodes.map((node) => [node.id, 0]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of filteredEdges) {
      const nextDepth = (depthByNodeId.get(edge.source) ?? 0) + 1;
      if ((depthByNodeId.get(edge.target) ?? 0) < nextDepth) {
        depthByNodeId.set(edge.target, nextDepth);
        changed = true;
      }
    }
  }

  const lanesByDepth = new Map<number, number>();
  const nodes: Node[] = filteredNodes.map((node) => {
    const depth = depthByNodeId.get(node.id) ?? 0;
    const lane = lanesByDepth.get(depth) ?? 0;
    lanesByDepth.set(depth, lane + 1);

    const tone =
      node.state === "FAILED"
        ? "bg-rose-50 border-rose-300"
        : node.state === "DONE"
          ? "bg-emerald-50 border-emerald-300"
          : node.state === "RUNNING"
            ? "bg-sky-50 border-sky-300"
            : "bg-slate-50 border-slate-300";

    return {
      id: node.id,
      position: { x: depth * 260, y: lane * 140 },
      data: {
        label: (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-950">{node.taskName}</span>
              {changedNodeIds.has(node.id) ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-900">
                  changed
                </span>
              ) : null}
            </div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{node.state}</div>
            <div className="text-xs text-slate-500">
              {node.processingTimeSec != null ? `${node.processingTimeSec}s` : "No duration"}
            </div>
          </div>
        ),
      },
      selected: node.id === selectedTaskNodeId,
      style: {
        borderRadius: 20,
        borderWidth: 1,
        padding: 12,
        width: 220,
      },
      className: cn("shadow-md", tone),
    };
  });

  const edges: Edge[] = filteredEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: true,
  }));

  return { nodes, edges };
};

const LogTerminal = ({ logs, paused }: { logs: LogEvent[]; paused: boolean }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const renderLogs = useEffectEvent((items: LogEvent[]) => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.reset();
    for (const log of items) {
      terminalRef.current.writeln(`[${log.stream}] ${log.line}`);
    }

    if (!paused) {
      terminalRef.current.scrollToBottom();
    }
  });

  useEffect(() => {
    if (!rootRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      fontSize: 12,
      theme: {
        background: "#0f172a",
        foreground: "#f8fafc",
        brightGreen: "#86efac",
        brightRed: "#fda4af",
        brightBlue: "#7dd3fc",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(rootRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(rootRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    renderLogs(logs);
  }, [logs]);

  return (
    <div className="h-[28rem] rounded-2xl border border-slate-200 bg-slate-950 p-2" ref={rootRef} />
  );
};

export const RunDetailPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = params.projectId;
  const runId = params.runId;
  const activeTab = (searchParams.get("tab") as RunTab | null) ?? "timeline";
  const [selectedTaskNodeId, setSelectedTaskNodeId] = useState<string | null>(null);
  const [logsSearch, setLogsSearch] = useState("");
  const deferredLogsSearch = useDeferredValue(logsSearch);
  const [pausedLogs, setPausedLogs] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [rerunOverrideOpen, setRerunOverrideOpen] = useState(false);
  const [rerunParameterRows, setRerunParameterRows] = useState<ParameterRow[]>([
    createEmptyParameterRow(),
  ]);
  const [rerunLabel, setRerunLabel] = useState("");

  const projectQuery = useQuery({
    queryKey: projectId ? queryKeys.project(projectId) : ["projects", "missing"],
    queryFn: () => api.getProject(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const runQuery = useQuery({
    queryKey: runId ? queryKeys.run(runId) : ["runs", "missing"],
    queryFn: () => api.getRun(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const run = query.state.data;
      return run && !isTerminalRun(run) ? 1_000 : false;
    },
  });
  const logsQuery = useQuery({
    queryKey: runId ? queryKeys.logs(runId) : ["runs", "logs", "missing"],
    queryFn: () => api.getLogs(runId ?? ""),
    enabled: Boolean(runId),
  });
  const timelineQuery = useQuery({
    queryKey: runId ? queryKeys.timeline(runId) : ["runs", "timeline", "missing"],
    queryFn: () => api.getTimeline(runId ?? ""),
    enabled: Boolean(runId) && activeTab === "timeline",
  });
  const graphQuery = useQuery({
    queryKey: runId ? queryKeys.graph(runId) : ["runs", "graph", "missing"],
    queryFn: () => api.getGraph(runId ?? ""),
    enabled: Boolean(runId) && (activeTab === "graph" || activeTab === "lineage"),
  });
  const lineageQuery = useQuery({
    queryKey: runId ? queryKeys.lineage(runId) : ["runs", "lineage", "missing"],
    queryFn: () => api.getLineage(runId ?? ""),
    enabled: Boolean(runId) && (activeTab === "graph" || activeTab === "lineage"),
  });
  const artifactsQuery = useQuery({
    queryKey: runId ? queryKeys.artifacts(runId) : ["runs", "artifacts", "missing"],
    queryFn: () => api.getArtifacts(runId ?? ""),
    enabled: Boolean(runId) && activeTab === "artifacts",
  });
  const rawQueries = useQueries({
    queries: [
      {
        queryKey: runId ? queryKeys.rawTree(runId) : ["runs", "raw", "tree", "missing"],
        queryFn: () => api.getRawTaskInfoTree(runId ?? ""),
        enabled: Boolean(runId) && activeTab === "raw",
      },
      {
        queryKey: runId ? queryKeys.rawTable(runId) : ["runs", "raw", "table", "missing"],
        queryFn: () => api.getRawTaskInfoTable(runId ?? ""),
        enabled: Boolean(runId) && activeTab === "raw",
      },
      {
        queryKey: runId ? queryKeys.rawScheduler(runId) : ["runs", "raw", "scheduler", "missing"],
        queryFn: () => api.getRawScheduler(runId ?? ""),
        enabled: Boolean(runId) && activeTab === "raw",
      },
      {
        queryKey: runId
          ? queryKeys.rawAdapterEvents(runId)
          : ["runs", "raw", "adapter-events", "missing"],
        queryFn: () => api.getRawAdapterEvents(runId ?? ""),
        enabled: Boolean(runId) && activeTab === "raw",
      },
    ],
  });

  const compareQueries = useQueries({
    queries: (lineageQuery.data ?? []).map((node) => ({
      queryKey: runId ? queryKeys.compare(runId, node.id) : ["runs", "compare", node.id],
      queryFn: () => api.comparePreviousSuccess(runId ?? "", node.id),
      enabled: Boolean(runId) && (activeTab === "graph" || activeTab === "lineage"),
    })),
  });

  const artifactContentQuery = useQuery({
    queryKey:
      selectedArtifactId && runId
        ? queryKeys.artifactContent(selectedArtifactId)
        : ["artifacts", "content", "none"],
    queryFn: () => api.getArtifactContent(selectedArtifactId ?? ""),
    enabled: Boolean(selectedArtifactId) && activeTab === "artifacts",
  });

  useEffect(() => {
    if (!lineageQuery.data || lineageQuery.data.length === 0) {
      return;
    }
    if (selectedTaskNodeId && lineageQuery.data.some((node) => node.id === selectedTaskNodeId)) {
      return;
    }

    const firstNode = lineageQuery.data[0];
    if (firstNode) {
      setSelectedTaskNodeId(firstNode.id);
    }
  }, [lineageQuery.data, selectedTaskNodeId]);

  useEffect(() => {
    if (!artifactsQuery.data || artifactsQuery.data.length === 0) {
      return;
    }
    if (
      selectedArtifactId &&
      artifactsQuery.data.some((artifact) => artifact.id === selectedArtifactId)
    ) {
      return;
    }

    const preferred =
      artifactsQuery.data.find((artifact) => artifact.previewable) ?? artifactsQuery.data[0];
    if (preferred) {
      setSelectedArtifactId(preferred.id);
    }
  }, [artifactsQuery.data, selectedArtifactId]);

  const stopMutation = useMutation({
    mutationFn: (mode: "graceful" | "force") => api.stopRun(runId ?? "", { mode }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.run(runId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(projectId ?? "") });
    },
  });
  const rerunMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.rerunRun>[1]) => api.rerunRun(runId ?? "", body),
    onSuccess: (run) => navigate(`/projects/${run.projectId}/runs/${run.id}`),
  });

  const handleRunEvent = useEffectEvent((payload: RunRecord) => {
    queryClient.setQueryData(queryKeys.run(payload.id), payload);
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs(projectId ?? "") });
  });
  const handleLogEvent = useEffectEvent((payload: LogEvent) => {
    queryClient.setQueryData(queryKeys.logs(payload.runId), (current: LogEvent[] | undefined) => {
      const existing = current ?? [];
      return existing.some((entry) => logIdentity(entry) === logIdentity(payload))
        ? existing
        : [...existing, payload];
    });
  });
  const handleTimelineEvent = useEffectEvent((payload: TimelineRecord[number]) => {
    queryClient.setQueryData(
      queryKeys.timeline(payload.runId),
      (current: TimelineRecord | undefined) => {
        const existing = current ?? [];
        return existing.some((entry) => entry.id === payload.id)
          ? existing
          : [...existing, payload];
      },
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.graph(payload.runId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(payload.runId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(payload.runId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.rawTree(payload.runId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.rawTable(payload.runId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.rawAdapterEvents(payload.runId) });
  });
  const handleSchedulerEvent = useEffectEvent(() => {
    if (!runId) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.rawScheduler(runId) });
  });

  useEffect(() => {
    if (!runId || !runQuery.data || isTerminalRun(runQuery.data)) {
      return;
    }

    const source = new EventSource(`/api/runs/${runId}/logs/stream`);
    source.addEventListener("run", (event) => {
      handleRunEvent(JSON.parse(event.data) as RunRecord);
    });
    source.addEventListener("log", (event) => {
      handleLogEvent(JSON.parse(event.data) as LogEvent);
    });
    source.addEventListener("timeline", (event) => {
      handleTimelineEvent(JSON.parse(event.data) as TimelineRecord[number]);
    });
    source.addEventListener("scheduler", () => {
      handleSchedulerEvent();
    });
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [runId, runQuery.data]);

  if (!projectId || !runId || projectQuery.isLoading || runQuery.isLoading || logsQuery.isLoading) {
    return <LoadingState label="Loading run detail..." />;
  }

  if (projectQuery.error || runQuery.error || logsQuery.error) {
    return (
      <ErrorState
        action={
          <Button
            onClick={() => {
              void projectQuery.refetch();
              void runQuery.refetch();
              void logsQuery.refetch();
            }}
            variant="outline"
          >
            Retry
          </Button>
        }
        message="Run detail could not load the required project, run, or log state."
        title="Run detail unavailable"
      />
    );
  }

  const project = projectQuery.data;
  const run = runQuery.data;
  if (!project || !run) {
    return (
      <ErrorState
        message="Run detail is missing the project or run payload."
        title="Run detail missing data"
      />
    );
  }

  const logs = logsQuery.data ?? [];
  const filteredLogs = logs.filter((log) => {
    return `[${log.stream}] ${log.line}`.toLowerCase().includes(deferredLogsSearch.toLowerCase());
  });
  const lineage: LineageRecord = lineageQuery.data ?? [];
  const compareMap = new Map<string, CompareRecord>(
    compareQueries
      .map((query) => query.data)
      .filter((value): value is CompareRecord => value !== undefined)
      .map((value) => [value.current.id, value]),
  );
  const changedNodeIds = new Set(
    [...compareMap.values()].filter(diffIsMeaningful).map((entry) => entry.current.id),
  );
  const selectedLineageNode =
    lineage.find((node) => node.id === selectedTaskNodeId) ?? lineage[0] ?? null;
  const selectedCompare =
    selectedLineageNode && selectedTaskNodeId ? compareMap.get(selectedTaskNodeId) : undefined;
  const flowGraph =
    graphQuery.data && selectedTaskNodeId
      ? buildFlowGraph(graphQuery.data, selectedTaskNodeId, changedNodeIds, failedOnly, changedOnly)
      : { nodes: [] as Node[], edges: [] as Edge[] };

  return (
    <div className="space-y-6">
      {rerunOverrideOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-950">Rerun with override</h3>
                <p className="text-sm text-slate-600">
                  Override label and parameters, then issue a new run from the current spec.
                </p>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
                onClick={() => setRerunOverrideOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <FieldLabel label="Rerun label" />
                <input
                  className={inputClassName}
                  onChange={(event) => setRerunLabel(event.target.value)}
                  value={rerunLabel}
                />
              </div>
              <ParameterEditor
                label="Parameter overrides"
                onChange={setRerunParameterRows}
                rows={rerunParameterRows}
              />
              <div className="flex justify-end gap-2">
                <Button onClick={() => setRerunOverrideOpen(false)} type="button" variant="ghost">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const parameters = parameterRowsToRecord(rerunParameterRows);
                    void rerunMutation.mutateAsync({
                      rerunMode: "with_param_override",
                      label: rerunLabel || null,
                      parameters,
                    });
                  }}
                  type="button"
                >
                  Create rerun
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline" })} to={`/projects/${project.id}`}>
              <ArrowLeft className="size-4" />
              Back
            </Link>
            {project.capabilities.canStop && !isTerminalRun(run) ? (
              <>
                <Button onClick={() => void stopMutation.mutateAsync("graceful")} variant="outline">
                  <Square className="size-4" />
                  Graceful stop
                </Button>
                <Button onClick={() => void stopMutation.mutateAsync("force")} variant="ghost">
                  Force stop
                </Button>
              </>
            ) : null}
            {project.capabilities.canRerun ? (
              <>
                <Button onClick={() => void rerunMutation.mutateAsync({ rerunMode: "same_spec" })}>
                  <RotateCcw className="size-4" />
                  Rerun same spec
                </Button>
                <Button
                  onClick={() => {
                    setRerunParameterRows(parameterRowsFromValues(run.spec.parameters));
                    setRerunLabel(run.spec.label ?? "");
                    setRerunOverrideOpen(true);
                  }}
                  variant="outline"
                >
                  Rerun with override
                </Button>
              </>
            ) : null}
          </div>
        }
        description="Graph, lineage, logs, artifacts, and raw adapter payloads stay split so control, observability, and compare work can happen without conflating the views."
        title={run.spec.label ?? run.spec.rootTaskName}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge accessMode={run.accessMode} />
        <CapabilityStrip capabilities={project.capabilities} dense />
      </div>

      <SectionCard title="Run Header">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Status
            </div>
            <div className="mt-3 flex items-center gap-2">
              <StatusBadge status={run.status} />
              <span className="text-sm text-slate-600">{run.spec.rootTaskName}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Timing
            </div>
            <div className="mt-3 text-sm text-slate-700">
              {formatDateTime(run.startedAt)} · {formatDuration(run.startedAt, run.finishedAt)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Profiles
            </div>
            <div className="mt-3 text-sm text-slate-700">
              cfg:{run.spec.configProfileId ?? "none"} / env:{run.spec.envProfileId ?? "none"}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Adapter
            </div>
            <div className="mt-3 text-sm text-slate-700">
              pid {run.adapterPid ?? "—"} / group {run.processGroupId ?? "—"}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="flex flex-wrap gap-2 rounded-[1.5rem] border border-white/70 bg-white/85 p-2 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.45)] backdrop-blur">
        {(["timeline", "graph", "lineage", "logs", "artifacts", "raw"] as RunTab[]).map((tab) => (
          <button
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition",
              activeTab === tab ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100",
            )}
            key={tab}
            onClick={() => setSearchParams((current) => ({ ...Object.fromEntries(current), tab }))}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "timeline" ? (
        <SectionCard title="Timeline">
          {timelineQuery.isLoading ? (
            <LoadingState label="Loading timeline..." />
          ) : timelineQuery.data && timelineQuery.data.length > 0 ? (
            <div className="space-y-3">
              {timelineQuery.data.map((event) => (
                <div
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
                  key={event.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-semibold text-slate-950">{event.message}</div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {event.type}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{formatDateTime(event.at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No timeline events are persisted yet." title="Timeline empty" />
          )}
        </SectionCard>
      ) : null}

      {activeTab === "graph" ? (
        <SectionCard
          actions={
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                <input
                  checked={failedOnly}
                  onChange={(event) => setFailedOnly(event.target.checked)}
                  type="checkbox"
                />
                failed path only
              </label>
              <label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                <input
                  checked={changedOnly}
                  onChange={(event) => setChangedOnly(event.target.checked)}
                  type="checkbox"
                />
                changed lineage only
              </label>
            </div>
          }
          title="Graph"
        >
          {graphQuery.isLoading || lineageQuery.isLoading ? (
            <LoadingState label="Loading task graph..." />
          ) : flowGraph.nodes.length === 0 ? (
            <EmptyState
              message="No graph nodes are available for this run yet."
              title="Graph unavailable"
            />
          ) : (
            <div className="h-[34rem] rounded-2xl border border-slate-200 bg-slate-50/80">
              <ReactFlow
                edges={flowGraph.edges}
                fitView
                nodes={flowGraph.nodes}
                onNodeClick={(_event, node) => {
                  setSelectedTaskNodeId(node.id);
                  setSearchParams((current) => ({
                    ...Object.fromEntries(current),
                    tab: "lineage",
                  }));
                }}
              >
                <MiniMap />
                <Controls />
                <Background />
              </ReactFlow>
            </div>
          )}
        </SectionCard>
      ) : null}

      {activeTab === "lineage" ? (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <SectionCard title="Lineage Index">
            {lineage.length === 0 ? (
              <EmptyState message="No lineage nodes are persisted yet." title="Lineage empty" />
            ) : (
              <div className="space-y-2">
                {lineage.map((node) => (
                  <button
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      selectedTaskNodeId === node.id
                        ? "border-primary bg-primary/5"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    key={node.id}
                    onClick={() => setSelectedTaskNodeId(node.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-950">{node.taskName}</div>
                      <StatusBadge status={node.state} />
                    </div>
                    <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {node.uniqueId}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Selected Task Lineage">
            {selectedLineageNode ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selectedLineageNode.state} />
                  {selectedCompare && diffIsMeaningful(selectedCompare) ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                      changed from previous success
                    </span>
                  ) : null}
                  {selectedCompare ? (
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                        compareResolutionTone(selectedCompare),
                      )}
                    >
                      {formatCompareResolutionLabel(selectedCompare)}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <CodeBlock
                    value={{
                      uniqueId: selectedLineageNode.uniqueId,
                      upstreamNodeIds: selectedLineageNode.upstreamNodeIds,
                      downstreamNodeIds: selectedLineageNode.downstreamNodeIds,
                      processingTimeSec: selectedLineageNode.processingTimeSec,
                      rerunReason: selectedLineageNode.rerunReason,
                      codeVersionHint: selectedLineageNode.codeVersionHint,
                    }}
                  />
                  <CodeBlock value={selectedLineageNode.parameters} />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-950">Outputs</div>
                  {selectedLineageNode.outputs.length === 0 ? (
                    <EmptyState
                      message="No output paths were recorded for this node."
                      title="No outputs"
                    />
                  ) : (
                    <div className="space-y-2">
                      {selectedLineageNode.outputs.map((outputPath) => (
                        <div
                          className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700"
                          key={outputPath}
                        >
                          {summarizePath(outputPath)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-950">Task log summary</div>
                  <CodeBlock value={selectedLineageNode.taskLog ?? { entries: [] }} />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-950">
                    Previous-success compare
                  </div>
                  {selectedCompare ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                      <div className="font-semibold text-slate-950">
                        {selectedCompare.diff.compareResolution.message}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                        <span>status {selectedCompare.diff.compareResolution.status}</span>
                        <span>
                          strategy{" "}
                          {formatCompareStrategyLabel(
                            selectedCompare.diff.compareResolution.strategy,
                          )}
                        </span>
                        <span>
                          candidates{" "}
                          {
                            selectedCompare.diff.compareResolution.sameTaskNameCandidateTaskNodeIds
                              .length
                          }
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <CodeBlock value={selectedCompare ?? { previous: null, diff: {} }} />
                </div>
              </div>
            ) : (
              <EmptyState
                message="Pick a task node from the lineage index to inspect it."
                title="No task selected"
              />
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "logs" ? (
        <SectionCard
          actions={
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                <Search className="size-3" />
                <input
                  className="bg-transparent outline-none"
                  onChange={(event) => setLogsSearch(event.target.value)}
                  placeholder="search logs"
                  value={logsSearch}
                />
              </label>
              <Button
                onClick={() => setPausedLogs((current) => !current)}
                size="sm"
                variant="outline"
              >
                <Pause className="size-4" />
                {pausedLogs ? "Resume autoscroll" : "Pause autoscroll"}
              </Button>
              <Button
                onClick={() => {
                  const blob = new Blob(
                    [
                      filteredLogs
                        .map((log) => `[${log.at}] [${log.stream}] ${log.line}`)
                        .join("\n"),
                    ],
                    { type: "text/plain" },
                  );
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `${run.id}-logs.txt`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
                size="sm"
                variant="ghost"
              >
                <Download className="size-4" />
                Download
              </Button>
            </div>
          }
          title="Logs"
        >
          <div className="space-y-4">
            <LogTerminal logs={filteredLogs} paused={pausedLogs} />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                stdout {logs.filter((log) => log.stream === "stdout").length}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                stderr {logs.filter((log) => log.stream === "stderr").length}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                system {logs.filter((log) => log.stream === "system").length}
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "artifacts" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <SectionCard title="Artifacts">
            {artifactsQuery.isLoading ? (
              <LoadingState label="Loading artifact manifest..." />
            ) : artifactsQuery.data && artifactsQuery.data.length > 0 ? (
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Kind</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Task</th>
                      <th className="px-3 py-2">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifactsQuery.data.map((artifact) => (
                      <tr
                        className={cn(
                          "cursor-pointer border-t border-slate-200",
                          selectedArtifactId === artifact.id ? "bg-primary/5" : "",
                        )}
                        key={artifact.id}
                        onClick={() => setSelectedArtifactId(artifact.id)}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-slate-950">{artifact.kind}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{artifact.relativePath}</td>
                        <td className="px-3 py-3 text-slate-600">
                          {formatBytes(artifact.sizeBytes)}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{artifact.taskNodeId ?? "n/a"}</td>
                        <td className="px-3 py-3 text-slate-600">
                          {artifact.previewable ? "available" : "binary"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                message="No artifacts have been recorded yet."
                title="Artifact manifest empty"
              />
            )}
          </SectionCard>

          <SectionCard title="Artifact Preview">
            {artifactContentQuery.data ? (
              artifactContentQuery.data.contentType === "text" ? (
                <CodeBlock value={artifactContentQuery.data.text} />
              ) : (
                <CodeBlock
                  value={{
                    artifactId: artifactContentQuery.data.artifactId,
                    mimeType: artifactContentQuery.data.mimeType,
                    byteLength: artifactContentQuery.data.byteLength,
                    truncated: artifactContentQuery.data.truncated,
                    base64Preview: artifactContentQuery.data.base64,
                  }}
                />
              )
            ) : (
              <EmptyState
                message="Choose an artifact from the manifest to load preview content."
                title="No artifact selected"
              />
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "raw" ? (
        <div className="space-y-6">
          <SectionCard title="Raw task-info tree">
            {rawQueries[0].data ? (
              <CodeBlock value={rawQueries[0].data.raw} />
            ) : (
              <LoadingState label="Loading raw tree..." />
            )}
          </SectionCard>
          <SectionCard title="Raw task-info table">
            {rawQueries[1].data ? (
              <CodeBlock value={rawQueries[1].data.raw} />
            ) : (
              <LoadingState label="Loading raw table..." />
            )}
          </SectionCard>
          <SectionCard title="Raw scheduler payloads">
            {rawQueries[2].data ? (
              <CodeBlock value={rawQueries[2].data.raw} />
            ) : (
              <LoadingState label="Loading scheduler raw payloads..." />
            )}
          </SectionCard>
          <SectionCard title="Raw adapter events">
            {rawQueries[3].data ? (
              <CodeBlock value={rawQueries[3].data.raw} />
            ) : (
              <LoadingState label="Loading adapter events..." />
            )}
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
};
