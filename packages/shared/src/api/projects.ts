import { z } from "zod";
import { idSchema, nonEmptyStringSchema } from "../schemas/common";
import {
  projectConnectionSchema,
  projectSchema,
  projectValidationResultSchema,
} from "../schemas/domain";
import { deleteOkResponseSchema } from "./common";

export const listProjectsResponseSchema = z.array(projectSchema);
export const projectResponseSchema = projectSchema;
const projectConnectionUpdateSchema = projectConnectionSchema
  .omit({
    allowWorkspaceDirectorySymlink: true,
  })
  .partial()
  .extend({
    allowWorkspaceDirectorySymlink: z.boolean().optional(),
  });

export const createProjectRequestSchema = z.object({
  name: nonEmptyStringSchema,
  connection: projectConnectionSchema,
  defaultConfigProfileId: idSchema.nullable().optional(),
  defaultEnvProfileId: idSchema.nullable().optional(),
});

export const updateProjectRequestSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  connection: projectConnectionUpdateSchema.optional(),
  defaultConfigProfileId: idSchema.nullable().optional(),
  defaultEnvProfileId: idSchema.nullable().optional(),
});

export const validateProjectResponseSchema = projectValidationResultSchema;
export const deleteProjectResponseSchema = deleteOkResponseSchema;

export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ValidateProjectResponse = z.infer<typeof validateProjectResponseSchema>;
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>;
