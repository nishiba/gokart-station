import { z } from "zod";
import { idSchema, nonEmptyStringSchema } from "../schemas/common";
import { artifactManifestEntrySchema } from "../schemas/domain";

export const deleteOkResponseSchema = z.object({
  ok: z.literal(true),
});

export const capabilityErrorResponseSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  requiredCapability: nonEmptyStringSchema.optional(),
});

export const rawPayloadResponseSchema = z.object({
  raw: z.unknown(),
});

export const artifactContentResponseSchema = z.discriminatedUnion("contentType", [
  z.object({
    artifactId: idSchema,
    mimeType: nonEmptyStringSchema.nullable().optional(),
    contentType: z.literal("text"),
    text: z.string(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  }),
  z.object({
    artifactId: idSchema,
    mimeType: nonEmptyStringSchema.nullable().optional(),
    contentType: z.literal("binary"),
    base64: z.string(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  }),
]);

export const supportBundleResponseSchema = artifactManifestEntrySchema;

export type DeleteOkResponse = z.infer<typeof deleteOkResponseSchema>;
export type CapabilityErrorResponse = z.infer<typeof capabilityErrorResponseSchema>;
export type RawPayloadResponse = z.infer<typeof rawPayloadResponseSchema>;
export type ArtifactContentResponse = z.infer<typeof artifactContentResponseSchema>;
export type SupportBundleResponse = z.infer<typeof supportBundleResponseSchema>;
