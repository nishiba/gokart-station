import { z } from "zod";
import type { ArtifactKind } from "../domain/types";
import { filePathSchema, idSchema, nonEmptyStringSchema } from "../schemas/common";
import { artifactKindSchema, watchEventSchema } from "../schemas/domain";
import { supportBundleResponseSchema } from "./common";

export interface FileTreeNodeDto {
  name: string;
  absolutePath: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes?: number | null | undefined;
  inferredArtifactKind?: ArtifactKind | null | undefined;
  children?: FileTreeNodeDto[] | undefined;
}

export const fileTreeNodeSchema: z.ZodType<FileTreeNodeDto> = z.lazy(() =>
  z.object({
    name: nonEmptyStringSchema,
    absolutePath: filePathSchema,
    relativePath: filePathSchema,
    isDirectory: z.boolean(),
    sizeBytes: z.number().int().nonnegative().nullable().optional(),
    inferredArtifactKind: artifactKindSchema.nullable().optional(),
    children: z.array(fileTreeNodeSchema).optional(),
  }),
);

export const fileTreeResponseSchema = z.array(fileTreeNodeSchema);
export const watchEventsResponseSchema = z.array(watchEventSchema);
export const watchEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1_000).optional(),
});
export const supportBundleRequestSchema = z.object({
  projectId: idSchema.optional(),
});
export const supportBundleResponseArtifactSchema = supportBundleResponseSchema;

export type FileTreeNode = z.infer<typeof fileTreeNodeSchema>;
export type FileTreeResponse = z.infer<typeof fileTreeResponseSchema>;
export type WatchEventsResponse = z.infer<typeof watchEventsResponseSchema>;
export type WatchEventsQuery = z.infer<typeof watchEventsQuerySchema>;
export type SupportBundleRequest = z.infer<typeof supportBundleRequestSchema>;
export type SupportBundleResponseArtifact = z.infer<typeof supportBundleResponseArtifactSchema>;
