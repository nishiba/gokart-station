import { z } from "zod";
import { idSchema, stringRecordSchema } from "../schemas/common";
import { accessModeSchema, profileKindSchema, profileSchema } from "../schemas/domain";
import { deleteOkResponseSchema } from "./common";

export const profileListQuerySchema = z.object({
  kind: profileKindSchema.optional(),
});

export const listProfilesResponseSchema = z.array(profileSchema);
export const profileResponseSchema = profileSchema;

export const createProfileRequestSchema = z.object({
  kind: profileKindSchema,
  name: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  extendsProfileId: idSchema.nullable().optional(),
  values: stringRecordSchema,
  maskedKeys: z.array(z.string().min(1)),
  isDefault: z.boolean(),
  enabledForModes: z.array(accessModeSchema),
});

export const updateProfileRequestSchema = createProfileRequestSchema.partial();

export const resolveProfileResponseSchema = z.object({
  profileId: idSchema,
  values: stringRecordSchema,
  maskedKeys: z.array(z.string().min(1)),
});

export const deleteProfileResponseSchema = deleteOkResponseSchema;

export type ProfileListQuery = z.infer<typeof profileListQuerySchema>;
export type ListProfilesResponse = z.infer<typeof listProfilesResponseSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ResolveProfileResponse = z.infer<typeof resolveProfileResponseSchema>;
export type DeleteProfileResponse = z.infer<typeof deleteProfileResponseSchema>;
