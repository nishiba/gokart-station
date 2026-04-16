import type {
  CreateProfileRequest,
  Profile,
  ResolveProfileResponse,
  UpdateProfileRequest,
} from "@gokart-station/shared";
import { HttpError } from "../lib/http-errors";
import type { ProfileRepository } from "../repositories/profile-repository";
import type { ProjectRepository } from "../repositories/project-repository";
import type { ProjectService } from "./project-service";

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly projectService: ProjectService,
  ) {}

  async listProfiles(projectId: string, kind?: Profile["kind"]) {
    await this.projectService.requireProject(projectId);
    return this.profileRepository.listByProjectId(projectId, kind);
  }

  async getProfile(profileId: string) {
    const profile = await this.profileRepository.getById(profileId);
    if (!profile) {
      throw new HttpError(404, "Profile not found.");
    }
    return profile;
  }

  async createProfile(projectId: string, input: CreateProfileRequest) {
    const project = await this.projectRepository.getConnectionById(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    this.projectService.ensureProfileMutationAllowed(project.connection);
    await this.ensureExtendsProfileIsValid(projectId, input.extendsProfileId);

    return this.profileRepository.create(projectId, input);
  }

  async updateProfile(profileId: string, input: UpdateProfileRequest) {
    const existing = await this.getProfile(profileId);
    const project = await this.projectRepository.getConnectionById(existing.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    this.projectService.ensureProfileMutationAllowed(project.connection);
    await this.ensureExtendsProfileIsValid(existing.projectId, input.extendsProfileId, profileId);

    const updated = await this.profileRepository.update(profileId, input);
    if (!updated) {
      throw new HttpError(404, "Profile not found.");
    }

    return updated;
  }

  async deleteProfile(profileId: string) {
    const existing = await this.getProfile(profileId);
    const project = await this.projectRepository.getConnectionById(existing.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    this.projectService.ensureProfileMutationAllowed(project.connection);
    await this.profileRepository.delete(profileId);

    return { ok: true } as const;
  }

  async resolveProfile(profileId: string): Promise<ResolveProfileResponse> {
    const profile = await this.getProfile(profileId);
    const project = await this.projectRepository.getConnectionById(profile.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    this.projectService.ensureProfileMutationAllowed(project.connection);

    const visitedProfileIds = new Set<string>();
    const resolvedProfiles = await this.collectProfileChain(profileId, visitedProfileIds);

    const values = Object.assign({}, ...resolvedProfiles.map((entry) => entry.values));
    const maskedKeys = Array.from(
      new Set(resolvedProfiles.flatMap((entry) => entry.maskedKeys)),
    ).sort((left, right) => left.localeCompare(right));

    return {
      profileId,
      values,
      maskedKeys,
    };
  }

  private async collectProfileChain(
    profileId: string,
    visitedProfileIds: Set<string>,
  ): Promise<Profile[]> {
    if (visitedProfileIds.has(profileId)) {
      throw new HttpError(400, "Profile inheritance cycle detected.");
    }

    visitedProfileIds.add(profileId);
    const profile = await this.getProfile(profileId);

    if (!profile.extendsProfileId) {
      return [profile];
    }

    const parentChain = await this.collectProfileChain(profile.extendsProfileId, visitedProfileIds);
    return [...parentChain, profile];
  }

  private async ensureExtendsProfileIsValid(
    projectId: string,
    extendsProfileId?: string | null,
    currentProfileId?: string,
  ) {
    if (extendsProfileId === undefined) {
      return;
    }

    if (extendsProfileId === currentProfileId) {
      throw new HttpError(400, "A profile cannot extend itself.");
    }

    if (extendsProfileId === null) {
      return;
    }

    const parentProfile = await this.profileRepository.getById(extendsProfileId);
    if (!parentProfile) {
      throw new HttpError(400, "extendsProfileId must reference an existing profile.");
    }

    if (parentProfile.projectId !== projectId) {
      throw new HttpError(400, "extendsProfileId must belong to the same project.");
    }
  }
}
