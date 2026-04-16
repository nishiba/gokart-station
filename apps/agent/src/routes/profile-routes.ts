import {
  createProfileRequestSchema,
  deleteProfileResponseSchema,
  idSchema,
  listProfilesResponseSchema,
  profileListQuerySchema,
  profileResponseSchema,
  resolveProfileResponseSchema,
  updateProfileRequestSchema,
} from "@gokart-station/shared";
import type { FastifyInstance } from "fastify";
import { parseWithSchema } from "../lib/zod";
import type { ProfileService } from "../services/profile-service";

type ProfileRoutesDependencies = {
  profileService: ProfileService;
};

export const registerProfileRoutes = (
  app: FastifyInstance,
  { profileService }: ProfileRoutesDependencies,
) => {
  app.get("/api/projects/:projectId/profiles", async (request) => {
    const params = request.params as { projectId: string };
    const query = parseWithSchema(profileListQuerySchema, request.query);
    const projectId = parseWithSchema(idSchema, params.projectId);
    const profiles = await profileService.listProfiles(projectId, query.kind);
    return listProfilesResponseSchema.parse(profiles);
  });

  app.post("/api/projects/:projectId/profiles", async (request, reply) => {
    const params = request.params as { projectId: string };
    const projectId = parseWithSchema(idSchema, params.projectId);
    const body = parseWithSchema(createProfileRequestSchema, request.body);
    const profile = await profileService.createProfile(projectId, body);
    reply.code(201);
    return profileResponseSchema.parse(profile);
  });

  app.get("/api/profiles/:profileId", async (request) => {
    const params = request.params as { profileId: string };
    const profileId = parseWithSchema(idSchema, params.profileId);
    const profile = await profileService.getProfile(profileId);
    return profileResponseSchema.parse(profile);
  });

  app.patch("/api/profiles/:profileId", async (request) => {
    const params = request.params as { profileId: string };
    const profileId = parseWithSchema(idSchema, params.profileId);
    const body = parseWithSchema(updateProfileRequestSchema, request.body);
    const profile = await profileService.updateProfile(profileId, body);
    return profileResponseSchema.parse(profile);
  });

  app.delete("/api/profiles/:profileId", async (request) => {
    const params = request.params as { profileId: string };
    const profileId = parseWithSchema(idSchema, params.profileId);
    const response = await profileService.deleteProfile(profileId);
    return deleteProfileResponseSchema.parse(response);
  });

  app.post("/api/profiles/:profileId/resolve", async (request) => {
    const params = request.params as { profileId: string };
    const profileId = parseWithSchema(idSchema, params.profileId);
    const response = await profileService.resolveProfile(profileId);
    return resolveProfileResponseSchema.parse(response);
  });
};
