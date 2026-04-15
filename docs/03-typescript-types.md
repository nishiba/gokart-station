# 03. TypeScript Types

以下は `packages/shared/src/domain/types.ts` の基準版である。

```ts
export type Id = string;

export type ProjectId = Id;
export type ProfileId = Id;
export type RunId = Id;
export type TaskNodeId = Id;
export type ArtifactId = Id;
export type WatchEventId = Id;
export type SchedulerSnapshotId = Id;

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

export type SchedulerHealth =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unreachable";

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
  label?: string | null;
  parameters: Record<string, PrimitiveParameterValue | JsonParameterValue>;
  configProfileId?: ProfileId | null;
  envProfileId?: ProfileId | null;
  rerunMode: RerunMode;
  workerCount?: number | null;
  captureTaskInfoTree: boolean;
  captureTaskInfoTable: boolean;
  captureArtifactManifest: boolean;
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
  stream: "stdout" | "stderr" | "system";
  line: string;
  at: string;
}

export interface TimelineEvent {
  id: string;
  runId: RunId;
  type:
    | "run_created"
    | "adapter_started"
    | "scheduler_connected"
    | "task_state_changed"
    | "artifact_detected"
    | "stop_requested"
    | "run_finished"
    | "run_failed";
  message: string;
  at: string;
  payload?: unknown;
}

export interface ValidationIssue {
  code: string;
  message: string;
  level: "error" | "warning";
  field?: string;
}

export interface ProjectValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  schedulerHealth: SchedulerHealth;
  resolvedCapabilities: CapabilitySet;
}
```

## 型設計の補足

- `Project.connection.accessMode` が observer / operator / managed を表す
- `Project.capabilities` は mode と path 解決結果から導出される read model である
- observer mode では `projectRootDir`, `pythonExecutable`, `entrypointPath` は `null` を許容する
- run は `accessMode` を固定して保存し、後から project mode を変えても過去 run の意味を壊さない
