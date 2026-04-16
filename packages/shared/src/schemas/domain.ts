import { z } from "zod";
import type { JsonParameterValue } from "../domain/types";
import {
  filePathSchema,
  idSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  stringRecordSchema,
  unknownRecordSchema,
  urlSchema,
} from "./common";

export const accessModeSchema = z.enum(["observer", "operator", "managed"]);
export const runStatusSchema = z.enum([
  "draft",
  "queued",
  "starting",
  "running",
  "stopping",
  "success",
  "failed",
  "canceled",
]);
export const taskStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "DISABLED",
  "UNKNOWN",
  "CANCELED",
]);
export const schedulerHealthSchema = z.enum(["unknown", "healthy", "degraded", "unreachable"]);
export const stopModeSchema = z.enum(["graceful", "force"]);
export const rerunModeSchema = z.enum([
  "none",
  "same_spec",
  "force_rerun_flag",
  "with_param_override",
  "with_profile_override",
]);
export const profileKindSchema = z.enum(["config", "env"]);
export const artifactKindSchema = z.enum([
  "output",
  "task_log",
  "task_params",
  "processing_time",
  "module_versions",
  "random_seed",
  "task_info_tree",
  "task_info_table",
  "scheduler_snapshot",
  "config_source",
  "env_source",
  "adapter_events",
  "support_bundle",
  "other",
]);
export const watchEventKindSchema = z.enum(["add", "change", "unlink"]);
export const logStreamSchema = z.enum(["stdout", "stderr", "system"]);
export const timelineEventTypeSchema = z.enum([
  "run_created",
  "adapter_started",
  "scheduler_connected",
  "task_state_changed",
  "artifact_detected",
  "stop_requested",
  "run_finished",
  "run_failed",
]);
export const validationIssueLevelSchema = z.enum(["error", "warning"]);

export const primitiveParameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const jsonParameterValueSchema: z.ZodType<JsonParameterValue> = z.lazy(() =>
  z.union([
    primitiveParameterValueSchema,
    z.array(primitiveParameterValueSchema),
    z.record(z.string(), jsonParameterValueSchema),
  ]),
);

export const capabilitySetSchema = z.object({
  canReadWorkspace: z.boolean(),
  canReadArtifacts: z.boolean(),
  canRun: z.boolean(),
  canStop: z.boolean(),
  canRerun: z.boolean(),
  canEditProfiles: z.boolean(),
  canManageScheduler: z.boolean(),
  canInstallAdapter: z.boolean(),
});

export const projectConnectionSchema = z.object({
  accessMode: accessModeSchema,
  projectRootDir: filePathSchema.nullable().optional(),
  pythonExecutable: filePathSchema.nullable().optional(),
  entrypointPath: filePathSchema.nullable().optional(),
  workspaceDirectory: filePathSchema,
  luigiConfigPath: filePathSchema.nullable().optional(),
  envSourcePath: filePathSchema.nullable().optional(),
  schedulerBaseUrl: urlSchema.nullable().optional(),
});

export const projectSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
  connection: projectConnectionSchema,
  capabilities: capabilitySetSchema,
  defaultConfigProfileId: idSchema.nullable().optional(),
  defaultEnvProfileId: idSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const profileSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  kind: profileKindSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema.nullable().optional(),
  extendsProfileId: idSchema.nullable().optional(),
  values: stringRecordSchema,
  maskedKeys: z.array(nonEmptyStringSchema),
  isDefault: z.boolean(),
  enabledForModes: z.array(accessModeSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const runSpecSchema = z.object({
  rootTaskName: nonEmptyStringSchema,
  label: nonEmptyStringSchema.nullable().optional(),
  parameters: z.record(z.string(), jsonParameterValueSchema),
  configProfileId: idSchema.nullable().optional(),
  envProfileId: idSchema.nullable().optional(),
  rerunMode: rerunModeSchema,
  workerCount: z.number().int().positive().nullable().optional(),
  captureTaskInfoTree: z.boolean(),
  captureTaskInfoTable: z.boolean(),
  captureArtifactManifest: z.boolean(),
});

export const runSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  spec: runSpecSchema,
  accessMode: accessModeSchema,
  status: runStatusSchema,
  exitCode: z.number().int().nullable().optional(),
  stopMode: stopModeSchema.nullable().optional(),
  adapterPid: z.number().int().nullable().optional(),
  processGroupId: z.number().int().nullable().optional(),
  schedulerTaskId: nonEmptyStringSchema.nullable().optional(),
  startedAt: isoDateTimeSchema.nullable().optional(),
  finishedAt: isoDateTimeSchema.nullable().optional(),
  errorSummary: nonEmptyStringSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const schedulerSnapshotSchema = z.object({
  id: idSchema,
  runId: idSchema.nullable().optional(),
  projectId: idSchema,
  health: schedulerHealthSchema,
  activeTaskCount: z.number().int().nonnegative(),
  pendingTaskCount: z.number().int().nonnegative(),
  failedTaskCount: z.number().int().nonnegative(),
  workerCount: z.number().int().nonnegative(),
  raw: z.unknown(),
  capturedAt: isoDateTimeSchema,
});

export const taskLineageNodeSchema = z.object({
  id: idSchema,
  runId: idSchema,
  taskName: nonEmptyStringSchema,
  uniqueId: nonEmptyStringSchema,
  state: taskStateSchema,
  parameters: unknownRecordSchema,
  outputs: z.array(filePathSchema),
  processingTimeSec: z.number().nullable().optional(),
  taskLog: unknownRecordSchema.nullable().optional(),
  rerunReason: nonEmptyStringSchema.nullable().optional(),
  codeVersionHint: nonEmptyStringSchema.nullable().optional(),
  upstreamNodeIds: z.array(idSchema),
  downstreamNodeIds: z.array(idSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const taskGraphNodeSchema = z.object({
  id: idSchema,
  taskName: nonEmptyStringSchema,
  uniqueId: nonEmptyStringSchema,
  state: taskStateSchema,
  processingTimeSec: z.number().nullable().optional(),
  changedFromPreviousRun: z.boolean().optional(),
});

export const taskGraphEdgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
});

export const taskGraphSchema = z.object({
  runId: idSchema,
  nodes: z.array(taskGraphNodeSchema),
  edges: z.array(taskGraphEdgeSchema),
});

export const artifactManifestEntrySchema = z.object({
  id: idSchema,
  projectId: idSchema,
  runId: idSchema.nullable().optional(),
  taskNodeId: idSchema.nullable().optional(),
  kind: artifactKindSchema,
  absolutePath: filePathSchema,
  relativePath: filePathSchema,
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  mimeType: nonEmptyStringSchema.nullable().optional(),
  previewable: z.boolean(),
  modifiedAt: isoDateTimeSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
});

export const watchEventSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  runId: idSchema.nullable().optional(),
  kind: watchEventKindSchema,
  absolutePath: filePathSchema,
  relativePath: filePathSchema,
  inferredArtifactKind: artifactKindSchema.nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

export const logEventSchema = z.object({
  runId: idSchema,
  stream: logStreamSchema,
  line: z.string(),
  at: isoDateTimeSchema,
});

export const timelineEventSchema = z.object({
  id: idSchema,
  runId: idSchema,
  type: timelineEventTypeSchema,
  message: z.string(),
  at: isoDateTimeSchema,
  payload: z.unknown().optional(),
});

export const validationIssueSchema = z.object({
  code: nonEmptyStringSchema,
  message: z.string(),
  level: validationIssueLevelSchema,
  field: nonEmptyStringSchema.optional(),
});

export const projectValidationResultSchema = z.object({
  ok: z.boolean(),
  issues: z.array(validationIssueSchema),
  schedulerHealth: schedulerHealthSchema,
  resolvedCapabilities: capabilitySetSchema,
});
