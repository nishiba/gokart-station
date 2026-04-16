export type Id = string;

export type ProjectId = Id;
export type ProfileId = Id;
export type RunId = Id;
export type TaskNodeId = Id;
export type ArtifactId = Id;
export type WatchEventId = Id;
export type SchedulerSnapshotId = Id;
export type TimelineEventId = Id;

export type AccessMode = "observer" | "operator" | "managed";

export type RunStatus =
  | "draft"
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "success"
  | "failed"
  | "canceled";

export type TaskState =
  | "PENDING"
  | "RUNNING"
  | "DONE"
  | "FAILED"
  | "DISABLED"
  | "UNKNOWN"
  | "CANCELED";

export type SchedulerHealth = "unknown" | "healthy" | "partial" | "degraded" | "unreachable";

export type StopMode = "graceful" | "force";

export type RerunMode =
  | "none"
  | "same_spec"
  | "force_rerun_flag"
  | "with_param_override"
  | "with_profile_override";

export type ProfileKind = "config" | "env";

export type ArtifactKind =
  | "output"
  | "task_log"
  | "task_params"
  | "processing_time"
  | "module_versions"
  | "random_seed"
  | "task_info_tree"
  | "task_info_table"
  | "scheduler_snapshot"
  | "config_source"
  | "env_source"
  | "adapter_events"
  | "support_bundle"
  | "other";

export type WatchEventKind = "add" | "change" | "unlink";
export type LogStream = "stdout" | "stderr" | "system";
export type TimelineEventType =
  | "run_created"
  | "adapter_started"
  | "scheduler_connected"
  | "task_state_changed"
  | "artifact_detected"
  | "stop_requested"
  | "run_finished"
  | "run_failed";
export type ValidationIssueLevel = "error" | "warning";
export type AdapterEventType =
  | "run.started"
  | "run.status_changed"
  | "scheduler.snapshot"
  | "task.discovered"
  | "task.status_changed"
  | "task.log"
  | "artifact.discovered"
  | "raw.task_info_tree"
  | "raw.task_info_table"
  | "adapter.warning"
  | "adapter.error"
  | "run.finished";

export interface CapabilitySet {
  canReadWorkspace: boolean;
  canReadArtifacts: boolean;
  canRun: boolean;
  canStop: boolean;
  canRerun: boolean;
  canEditProfiles: boolean;
  canManageScheduler: boolean;
  canInstallAdapter: boolean;
}

export interface ProjectConnection {
  accessMode: AccessMode;
  projectRootDir?: string | null;
  pythonExecutable?: string | null;
  entrypointPath?: string | null;
  workspaceDirectory: string;
  allowWorkspaceDirectorySymlink?: boolean;
  luigiConfigPath?: string | null;
  envSourcePath?: string | null;
  schedulerBaseUrl?: string | null;
}

export interface Project {
  id: ProjectId;
  name: string;
  connection: ProjectConnection;
  capabilities: CapabilitySet;
  defaultConfigProfileId?: ProfileId | null;
  defaultEnvProfileId?: ProfileId | null;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: ProfileId;
  projectId: ProjectId;
  kind: ProfileKind;
  name: string;
  description?: string | null;
  extendsProfileId?: ProfileId | null;
  values: Record<string, string>;
  maskedKeys: string[];
  isDefault: boolean;
  enabledForModes: AccessMode[];
  createdAt: string;
  updatedAt: string;
}

export type PrimitiveParameterValue = string | number | boolean | null;
export type JsonParameterValue =
  | PrimitiveParameterValue
  | PrimitiveParameterValue[]
  | { [key: string]: JsonParameterValue };

export interface RunSpec {
  rootTaskName: string;
  label?: string | null | undefined;
  parameters: Record<string, PrimitiveParameterValue | JsonParameterValue>;
  configProfileId?: ProfileId | null | undefined;
  envProfileId?: ProfileId | null | undefined;
  rerunMode: RerunMode;
  workerCount?: number | null | undefined;
  captureTaskInfoTree: boolean;
  captureTaskInfoTable: boolean;
  captureArtifactManifest: boolean;
}

export interface AdapterRunRequest {
  runId: RunId;
  projectId: ProjectId;
  projectName: string;
  accessMode: AccessMode;
  projectRootDir?: string | null | undefined;
  workspaceDirectory: string;
  pythonExecutable?: string | null | undefined;
  entrypointPath?: string | null | undefined;
  luigiConfigPath?: string | null | undefined;
  envSourcePath?: string | null | undefined;
  schedulerBaseUrl?: string | null | undefined;
  configValues: Record<string, string>;
  configMaskedKeys: string[];
  envValues: Record<string, string>;
  envMaskedKeys: string[];
  spec: RunSpec;
}

export interface Run {
  id: RunId;
  projectId: ProjectId;
  spec: RunSpec;
  accessMode: AccessMode;
  status: RunStatus;
  exitCode?: number | null;
  stopMode?: StopMode | null;
  adapterPid?: number | null;
  processGroupId?: number | null;
  schedulerTaskId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerSnapshot {
  id: SchedulerSnapshotId;
  runId?: RunId | null;
  projectId: ProjectId;
  health: SchedulerHealth;
  activeTaskCount: number;
  pendingTaskCount: number;
  failedTaskCount: number;
  workerCount: number;
  raw: unknown;
  capturedAt: string;
}

export interface TaskLineageNode {
  id: TaskNodeId;
  runId: RunId;
  taskName: string;
  uniqueId: string;
  state: TaskState;
  parameters: Record<string, unknown>;
  outputs: string[];
  processingTimeSec?: number | null;
  taskLog?: Record<string, unknown> | null;
  rerunReason?: string | null;
  codeVersionHint?: string | null;
  upstreamNodeIds: TaskNodeId[];
  downstreamNodeIds: TaskNodeId[];
  createdAt: string;
  updatedAt: string;
}

export type CompareResolutionStatus =
  | "matched"
  | "no_previous_success"
  | "no_candidate"
  | "ambiguous";

export type CompareResolutionStrategy =
  | "task_name_unique_candidate"
  | "unique_id"
  | "parameter_fingerprint"
  | "topology_signature"
  | "output_path_signature";

export interface CompareResolutionAttempt {
  strategy: CompareResolutionStrategy;
  candidateTaskNodeIds: TaskNodeId[];
  candidateCount: number;
}

export interface CompareResolutionMetadata {
  status: CompareResolutionStatus;
  strategy?: CompareResolutionStrategy | null;
  previousRunId?: RunId | null;
  matchedTaskNodeId?: TaskNodeId | null;
  sameTaskNameCandidateTaskNodeIds: TaskNodeId[];
  attempts: CompareResolutionAttempt[];
  evidence: {
    currentUniqueId: string;
    currentParameterFingerprint: string;
    currentUpstreamSignature: string;
    currentDownstreamSignature: string;
    currentOutputPathSignature: string;
  };
  message: string;
}

export interface TaskGraph {
  runId: RunId;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
}

export interface TaskGraphNode {
  id: TaskNodeId;
  taskName: string;
  uniqueId: string;
  state: TaskState;
  processingTimeSec?: number | null;
  changedFromPreviousRun?: boolean;
}

export interface TaskGraphEdge {
  id: string;
  source: TaskNodeId;
  target: TaskNodeId;
}

export interface ArtifactManifestEntry {
  id: ArtifactId;
  projectId: ProjectId;
  runId?: RunId | null;
  taskNodeId?: TaskNodeId | null;
  kind: ArtifactKind;
  absolutePath: string;
  relativePath: string;
  sizeBytes?: number | null;
  mimeType?: string | null;
  previewable: boolean;
  modifiedAt?: string | null;
  createdAt: string;
}

export interface WatchEvent {
  id: WatchEventId;
  projectId: ProjectId;
  runId?: RunId | null;
  kind: WatchEventKind;
  absolutePath: string;
  relativePath: string;
  inferredArtifactKind?: ArtifactKind | null;
  occurredAt: string;
}

export interface LogEvent {
  runId: RunId;
  stream: LogStream;
  line: string;
  at: string;
}

export interface TimelineEvent {
  id: TimelineEventId;
  runId: RunId;
  type: TimelineEventType;
  message: string;
  at: string;
  payload?: unknown;
}

export interface ValidationIssue {
  code: string;
  message: string;
  level: ValidationIssueLevel;
  field?: string;
}

export interface ProjectValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  schedulerHealth: SchedulerHealth;
  resolvedCapabilities: CapabilitySet;
}

export interface AdapterEventBase {
  type: AdapterEventType;
  runId: RunId;
  at: string;
}

export interface AdapterTaskReference {
  taskName: string;
  uniqueId: string;
}

export interface AdapterTaskDiscoveredPayload extends AdapterTaskReference {
  state: TaskState;
  parameters: Record<string, unknown>;
  outputs: string[];
  upstreamUniqueIds: string[];
  downstreamUniqueIds: string[];
  processingTimeSec?: number | null | undefined;
}

export interface AdapterArtifactPayload {
  kind: ArtifactKind;
  absolutePath: string;
  relativePath: string;
  sizeBytes?: number | null | undefined;
  mimeType?: string | null | undefined;
  previewable: boolean;
}

export interface RunStartedAdapterEvent extends AdapterEventBase {
  type: "run.started";
  projectId: ProjectId;
  rootTaskName: string;
  workspaceDirectory: string;
  projectRootDir?: string | null | undefined;
  schedulerBaseUrl?: string | null | undefined;
}

export interface RunStatusChangedAdapterEvent extends AdapterEventBase {
  type: "run.status_changed";
  status: RunStatus;
  reason?: string | null | undefined;
}

export interface SchedulerSnapshotAdapterEvent extends AdapterEventBase {
  type: "scheduler.snapshot";
  schedulerBaseUrl?: string | null | undefined;
  health: SchedulerHealth;
  activeTaskCount: number;
  pendingTaskCount: number;
  failedTaskCount: number;
  workerCount: number;
  raw: unknown;
}

export interface TaskDiscoveredAdapterEvent extends AdapterEventBase, AdapterTaskDiscoveredPayload {
  type: "task.discovered";
}

export interface TaskStatusChangedAdapterEvent extends AdapterEventBase, AdapterTaskReference {
  type: "task.status_changed";
  state: TaskState;
  message?: string | null | undefined;
}

export interface TaskLogAdapterEvent extends AdapterEventBase, AdapterTaskReference {
  type: "task.log";
  stream: "stdout" | "stderr";
  line: string;
}

export interface ArtifactDiscoveredAdapterEvent extends AdapterEventBase, AdapterArtifactPayload {
  type: "artifact.discovered";
  taskName?: string | null | undefined;
  uniqueId?: string | null | undefined;
}

export interface RawTaskInfoTreeAdapterEvent extends AdapterEventBase {
  type: "raw.task_info_tree";
  raw: unknown;
}

export interface RawTaskInfoTableAdapterEvent extends AdapterEventBase {
  type: "raw.task_info_table";
  raw: unknown;
}

export interface AdapterWarningEvent extends AdapterEventBase {
  type: "adapter.warning";
  code: string;
  message: string;
  detail?: unknown | undefined;
}

export interface AdapterErrorEvent extends AdapterEventBase {
  type: "adapter.error";
  code: string;
  message: string;
  detail?: unknown | undefined;
}

export interface RunFinishedAdapterEvent extends AdapterEventBase {
  type: "run.finished";
  status: "success" | "failed" | "canceled";
  exitCode?: number | null | undefined;
  errorSummary?: string | null | undefined;
}

export type AdapterEvent =
  | RunStartedAdapterEvent
  | RunStatusChangedAdapterEvent
  | SchedulerSnapshotAdapterEvent
  | TaskDiscoveredAdapterEvent
  | TaskStatusChangedAdapterEvent
  | TaskLogAdapterEvent
  | ArtifactDiscoveredAdapterEvent
  | RawTaskInfoTreeAdapterEvent
  | RawTaskInfoTableAdapterEvent
  | AdapterWarningEvent
  | AdapterErrorEvent
  | RunFinishedAdapterEvent;
