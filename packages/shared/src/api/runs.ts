import { z } from "zod";
import { idSchema, nonEmptyStringSchema } from "../schemas/common";
import {
  artifactManifestEntrySchema,
  compareResolutionMetadataSchema,
  jsonParameterValueSchema,
  logEventSchema,
  rerunModeSchema,
  runSchema,
  runSpecSchema,
  schedulerSnapshotSchema,
  stopModeSchema,
  taskGraphSchema,
  taskLineageNodeSchema,
  timelineEventSchema,
} from "../schemas/domain";
import { artifactContentResponseSchema, rawPayloadResponseSchema } from "./common";

export const listRunsResponseSchema = z.array(runSchema);
export const createRunRequestSchema = runSpecSchema;
export const runResponseSchema = runSchema;

export const stopRunRequestSchema = z.object({
  mode: stopModeSchema.optional(),
});

export const rerunRunRequestSchema = z.object({
  rerunMode: rerunModeSchema.optional(),
  label: nonEmptyStringSchema.nullable().optional(),
  parameters: z.record(z.string(), jsonParameterValueSchema).optional(),
  configProfileId: idSchema.nullable().optional(),
  envProfileId: idSchema.nullable().optional(),
  workerCount: z.number().int().positive().nullable().optional(),
});

export const timelineResponseSchema = z.array(timelineEventSchema);
export const logsResponseSchema = z.array(logEventSchema);
export const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5_000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export const schedulerSnapshotsResponseSchema = z.array(schedulerSnapshotSchema);
export const schedulerLatestResponseSchema = schedulerSnapshotSchema.nullable();
export const runStreamEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("run"),
    data: runSchema,
  }),
  z.object({
    event: z.literal("log"),
    data: logEventSchema,
  }),
  z.object({
    event: z.literal("timeline"),
    data: timelineEventSchema,
  }),
  z.object({
    event: z.literal("scheduler"),
    data: schedulerSnapshotSchema,
  }),
]);
export const graphResponseSchema = taskGraphSchema;
export const lineageResponseSchema = z.array(taskLineageNodeSchema);
export const lineageNodeResponseSchema = taskLineageNodeSchema;
export const artifactsResponseSchema = z.array(artifactManifestEntrySchema);

export const lineageComparePreviousSuccessResponseSchema = z.object({
  current: taskLineageNodeSchema,
  previous: taskLineageNodeSchema.nullable(),
  diff: z.object({
    parameterDiff: z.record(
      z.string(),
      z.object({
        current: z.unknown().optional(),
        previous: z.unknown().optional(),
      }),
    ),
    stateChanged: z.boolean(),
    processingTimeDiffSec: z.number().nullable(),
    outputPathDiff: z.object({
      added: z.array(z.string().min(1)),
      removed: z.array(z.string().min(1)),
    }),
    compareResolution: compareResolutionMetadataSchema,
  }),
});

export const rawTaskInfoTreeResponseSchema = rawPayloadResponseSchema;
export const rawTaskInfoTableResponseSchema = rawPayloadResponseSchema;
export const rawSchedulerResponseSchema = rawPayloadResponseSchema;
export const rawAdapterEventsResponseSchema = rawPayloadResponseSchema;
export const artifactContentByIdResponseSchema = artifactContentResponseSchema;

export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type StopRunRequest = z.infer<typeof stopRunRequestSchema>;
export type RerunRunRequest = z.infer<typeof rerunRunRequestSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
export type LogsResponse = z.infer<typeof logsResponseSchema>;
export type LogsQuery = z.infer<typeof logsQuerySchema>;
export type SchedulerSnapshotsResponse = z.infer<typeof schedulerSnapshotsResponseSchema>;
export type SchedulerLatestResponse = z.infer<typeof schedulerLatestResponseSchema>;
export type RunStreamEvent = z.infer<typeof runStreamEventSchema>;
export type GraphResponse = z.infer<typeof graphResponseSchema>;
export type LineageResponse = z.infer<typeof lineageResponseSchema>;
export type LineageNodeResponse = z.infer<typeof lineageNodeResponseSchema>;
export type LineageComparePreviousSuccessResponse = z.infer<
  typeof lineageComparePreviousSuccessResponseSchema
>;
export type ArtifactsResponse = z.infer<typeof artifactsResponseSchema>;
export type RawTaskInfoTreeResponse = z.infer<typeof rawTaskInfoTreeResponseSchema>;
export type RawTaskInfoTableResponse = z.infer<typeof rawTaskInfoTableResponseSchema>;
export type RawSchedulerResponse = z.infer<typeof rawSchedulerResponseSchema>;
export type RawAdapterEventsResponse = z.infer<typeof rawAdapterEventsResponseSchema>;
export type ArtifactContentByIdResponse = z.infer<typeof artifactContentByIdResponseSchema>;
