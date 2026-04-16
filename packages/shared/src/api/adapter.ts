import { z } from "zod";
import {
  filePathSchema,
  idSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  stringRecordSchema,
  unknownRecordSchema,
} from "../schemas/common";
import {
  accessModeSchema,
  artifactKindSchema,
  jsonParameterValueSchema,
  runSpecSchema,
  runStatusSchema,
  schedulerHealthSchema,
  taskStateSchema,
} from "../schemas/domain";

const adapterEventBaseSchema = z.object({
  runId: idSchema,
  at: isoDateTimeSchema,
});

const adapterTaskReferenceSchema = z.object({
  taskName: nonEmptyStringSchema,
  uniqueId: nonEmptyStringSchema,
});

const adapterTaskDiscoveredPayloadSchema = adapterTaskReferenceSchema.extend({
  state: taskStateSchema,
  parameters: unknownRecordSchema,
  outputs: z.array(filePathSchema),
  upstreamUniqueIds: z.array(nonEmptyStringSchema),
  downstreamUniqueIds: z.array(nonEmptyStringSchema),
  processingTimeSec: z.number().nullable().optional(),
});

const adapterArtifactPayloadSchema = z.object({
  kind: artifactKindSchema,
  absolutePath: filePathSchema,
  relativePath: filePathSchema,
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  mimeType: nonEmptyStringSchema.nullable().optional(),
  previewable: z.boolean(),
});

export const adapterRunRequestSchema = z.object({
  runId: idSchema,
  projectId: idSchema,
  projectName: nonEmptyStringSchema,
  accessMode: accessModeSchema,
  projectRootDir: filePathSchema.nullable().optional(),
  workspaceDirectory: filePathSchema,
  pythonExecutable: filePathSchema.nullable().optional(),
  entrypointPath: filePathSchema.nullable().optional(),
  luigiConfigPath: filePathSchema.nullable().optional(),
  envSourcePath: filePathSchema.nullable().optional(),
  schedulerBaseUrl: z.string().url().nullable().optional(),
  configValues: stringRecordSchema,
  envValues: stringRecordSchema,
  envMaskedKeys: z.array(nonEmptyStringSchema),
  spec: runSpecSchema.extend({
    parameters: z.record(z.string(), jsonParameterValueSchema),
  }),
});

export const runStartedAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("run.started"),
  projectId: idSchema,
  rootTaskName: nonEmptyStringSchema,
  workspaceDirectory: filePathSchema,
  projectRootDir: filePathSchema.nullable().optional(),
  schedulerBaseUrl: z.string().url().nullable().optional(),
});

export const runStatusChangedAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("run.status_changed"),
  status: runStatusSchema,
  reason: z.string().nullable().optional(),
});

export const schedulerSnapshotAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("scheduler.snapshot"),
  schedulerBaseUrl: z.string().url().nullable().optional(),
  health: schedulerHealthSchema,
  activeTaskCount: z.number().int().nonnegative(),
  pendingTaskCount: z.number().int().nonnegative(),
  failedTaskCount: z.number().int().nonnegative(),
  workerCount: z.number().int().nonnegative(),
  raw: z.unknown(),
});

export const taskDiscoveredAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("task.discovered"),
  ...adapterTaskDiscoveredPayloadSchema.shape,
});

export const taskStatusChangedAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("task.status_changed"),
  ...adapterTaskReferenceSchema.shape,
  state: taskStateSchema,
  message: z.string().nullable().optional(),
});

export const taskLogAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("task.log"),
  ...adapterTaskReferenceSchema.shape,
  stream: z.enum(["stdout", "stderr"]),
  line: z.string(),
});

export const artifactDiscoveredAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("artifact.discovered"),
  ...adapterArtifactPayloadSchema.shape,
  taskName: nonEmptyStringSchema.nullable().optional(),
  uniqueId: nonEmptyStringSchema.nullable().optional(),
});

export const rawTaskInfoTreeAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("raw.task_info_tree"),
  raw: z.unknown(),
});

export const rawTaskInfoTableAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("raw.task_info_table"),
  raw: z.unknown(),
});

export const adapterWarningEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("adapter.warning"),
  code: nonEmptyStringSchema,
  message: z.string(),
  detail: z.unknown().optional(),
});

export const adapterErrorEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("adapter.error"),
  code: nonEmptyStringSchema,
  message: z.string(),
  detail: z.unknown().optional(),
});

export const runFinishedAdapterEventSchema = adapterEventBaseSchema.extend({
  type: z.literal("run.finished"),
  status: z.enum(["success", "failed", "canceled"]),
  exitCode: z.number().int().nullable().optional(),
  errorSummary: z.string().nullable().optional(),
});

export const adapterEventSchema = z.discriminatedUnion("type", [
  runStartedAdapterEventSchema,
  runStatusChangedAdapterEventSchema,
  schedulerSnapshotAdapterEventSchema,
  taskDiscoveredAdapterEventSchema,
  taskStatusChangedAdapterEventSchema,
  taskLogAdapterEventSchema,
  artifactDiscoveredAdapterEventSchema,
  rawTaskInfoTreeAdapterEventSchema,
  rawTaskInfoTableAdapterEventSchema,
  adapterWarningEventSchema,
  adapterErrorEventSchema,
  runFinishedAdapterEventSchema,
]);

export const adapterEventsResponseSchema = z.array(adapterEventSchema);

export type AdapterEventsResponse = z.infer<typeof adapterEventsResponseSchema>;
