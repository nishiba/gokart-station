import { z } from "zod";
import {
  filePathSchema,
  idSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
} from "../schemas/common";
import { schedulerHealthSchema } from "../schemas/domain";

export const schedulerHealthQuerySchema = z.object({
  projectId: idSchema.optional(),
});

export const schedulerLifecycleRequestSchema = z.object({
  projectId: idSchema,
});

export const schedulerLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const schedulerLogLineSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  line: z.string(),
});

export const schedulerHealthResponseSchema = z.object({
  health: schedulerHealthSchema,
  checkedAt: isoDateTimeSchema,
  schedulerBaseUrl: nonEmptyStringSchema,
  host: nonEmptyStringSchema,
  port: z.number().int().min(1).max(65535),
  isLocalhost: z.boolean(),
  isManagedByStation: z.boolean(),
  isProcessAlive: z.boolean(),
  portConflict: z.boolean(),
  pid: z.number().int().positive().nullable().optional(),
  startedAt: isoDateTimeSchema.nullable().optional(),
  pidFilePath: filePathSchema,
  logDirectory: filePathSchema,
  stdoutLogPath: filePathSchema,
  stderrLogPath: filePathSchema,
  message: z.string().nullable().optional(),
});

export const schedulerLogsResponseSchema = z.object({
  stdoutLogPath: filePathSchema,
  stderrLogPath: filePathSchema,
  lines: z.array(schedulerLogLineSchema),
});

export type SchedulerHealthQuery = z.infer<typeof schedulerHealthQuerySchema>;
export type SchedulerLifecycleRequest = z.infer<typeof schedulerLifecycleRequestSchema>;
export type SchedulerLogsQuery = z.infer<typeof schedulerLogsQuerySchema>;
export type SchedulerLogLine = z.infer<typeof schedulerLogLineSchema>;
export type SchedulerHealthResponse = z.infer<typeof schedulerHealthResponseSchema>;
export type SchedulerLogsResponse = z.infer<typeof schedulerLogsResponseSchema>;
