import { z } from "zod";
import { isoDateTimeSchema, nonEmptyStringSchema } from "../schemas/common";

export const healthResponseSchema = z.object({
  service: nonEmptyStringSchema,
  status: z.literal("ok"),
  at: isoDateTimeSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
