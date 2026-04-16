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
  | "partial"
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

export interface CompareResolutionMetadata {
  status: CompareResolutionStatus;
  strategy?: CompareResolutionStrategy | null;
  previousRunId?: RunId | null;
  matchedTaskNodeId?: TaskNodeId | null;
  sameTaskNameCandidateTaskNodeIds: TaskNodeId[];
  attempts: Array<{
    strategy: CompareResolutionStrategy;
    candidateTaskNodeIds: TaskNodeId[];
    candidateCount: number;
  }>;
  evidence: {
    currentUniqueId: string;
    currentParameterFingerprint: string;
    currentUpstreamSignature: string;
    currentDownstreamSignature: string;
    currentOutputPathSignature: string;
  };
  message: string;
}

export interface LineageComparePreviousSuccessResponse {
  current: TaskLineageNode;
  previous: TaskLineageNode | null;
  diff: {
    parameterDiff: Record<string, { current?: unknown; previous?: unknown }>;
    stateChanged: boolean;
    processingTimeDiffSec: number | null;
    outputPathDiff: { added: string[]; removed: string[] };
    compareResolution: CompareResolutionMetadata;
  };
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

## Python adapter contract

Python adapter process とは `RunSpec` そのものではなく、次の envelope を受け渡す。

```ts
export interface AdapterRunRequest {
  runId: RunId;
  projectId: ProjectId;
  projectName: string;
  accessMode: AccessMode;
  projectRootDir?: string | null;
  workspaceDirectory: string;
  pythonExecutable?: string | null;
  entrypointPath?: string | null;
  luigiConfigPath?: string | null;
  envSourcePath?: string | null;
  schedulerBaseUrl?: string | null;
  configValues: Record<string, string>;
  configMaskedKeys: string[];
  envValues: Record<string, string>;
  envMaskedKeys: string[];
  spec: RunSpec;
}
```

- `configValues` は flat object のまま保存するが、adapter 実行時には `section.option` 形式の key を Luigi config INI に materialize して target process に渡す
- `section.` を含まない key は `[DEFAULT]` に materialize してよい
- `configMaskedKeys` / `envMaskedKeys` に含まれる値は adapter が target stdout / stderr / raw task info を event 化する前に再マスクする

adapter event contract は JSONL の discriminated union とする。

```ts
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
```

### event payload rule

- 全 event は `type`, `runId`, `at` を持つ
- `task.discovered` は `taskName`, `uniqueId`, `state`, `parameters`, `outputs`, `upstreamUniqueIds`, `downstreamUniqueIds` を持つ
- `task.status_changed` は `taskName`, `uniqueId`, `state` を持つ
- `task.log` は `taskName`, `uniqueId`, `stream`, `line` を持つ
- `scheduler.snapshot` は `health`, `activeTaskCount`, `pendingTaskCount`, `failedTaskCount`, `workerCount`, `raw` を持つ
- `scheduler.snapshot.raw` は `healthProbe`, `snapshotSource`, `completeness`, `counts`, `endpoints`, `errors` を持てる
- `compare-previous-success` は `compareResolution` を持ち、`matched | no_previous_success | no_candidate | ambiguous` と解決根拠を返す
- `artifact.discovered` は `kind`, `absolutePath`, `relativePath`, `previewable` を持つ
- `raw.task_info_tree` / `raw.task_info_table` は `raw` を持つ
- `adapter.warning` / `adapter.error` は `code`, `message` を持つ
- `run.finished` は `status`, `exitCode?`, `errorSummary?` を持つ

## Run SSE stream contract

`GET /api/runs/:runId/logs/stream` は SSE を返し、`event` 名は次に固定する。

```ts
export type RunStreamEvent =
  | { event: "run"; data: Run }
  | { event: "log"; data: LogEvent }
  | { event: "timeline"; data: TimelineEvent }
  | { event: "scheduler"; data: SchedulerSnapshot };
```

- 接続直後に既存の persisted event を replay してよい
- run が active な間は後続 event を push する
- run が terminal (`success | failed | canceled`) に入ったら stream は close してよい

## Artifact Preview / Raw DTO

artifact preview は text と binary を分ける。

```ts
export type ArtifactContentResponse =
  | {
      artifactId: ArtifactId;
      mimeType?: string | null;
      contentType: "text";
      text: string;
      truncated: boolean;
      byteLength: number;
    }
  | {
      artifactId: ArtifactId;
      mimeType?: string | null;
      contentType: "binary";
      base64: string;
      truncated: boolean;
      byteLength: number;
    };

export interface RawPayloadResponse {
  raw: unknown;
}
```

- `GET /api/artifacts/:artifactId/content` は `ArtifactContentResponse`
- `GET /api/runs/:runId/raw/*` は `RawPayloadResponse`
