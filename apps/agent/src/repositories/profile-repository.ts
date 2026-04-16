import type {
  AccessMode,
  CreateProfileRequest,
  Profile,
  ProfileKind,
  UpdateProfileRequest,
} from "@gokart-station/shared";
import type { PrismaClient } from "@prisma/client";

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

const mapProfile = (
  record: Awaited<ReturnType<PrismaClient["profile"]["findUniqueOrThrow"]>>,
): Profile => {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind as ProfileKind,
    name: record.name,
    description: record.description,
    extendsProfileId: record.extendsProfileId,
    values: parseJson<Record<string, string>>(record.valuesJson),
    maskedKeys: parseJson<string[]>(record.maskedKeysJson),
    isDefault: record.isDefault,
    enabledForModes: parseJson<AccessMode[]>(record.enabledForModesJson),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
};

export class ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProjectId(projectId: string, kind?: ProfileKind) {
    const records = await this.prisma.profile.findMany({
      where: kind ? { projectId, kind } : { projectId },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    });

    return records.map(mapProfile);
  }

  async getById(profileId: string) {
    const record = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });

    return record ? mapProfile(record) : null;
  }

  async create(projectId: string, input: CreateProfileRequest) {
    const record = await this.prisma.profile.create({
      data: {
        projectId,
        kind: input.kind,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.extendsProfileId !== undefined
          ? { extendsProfileId: input.extendsProfileId }
          : {}),
        valuesJson: JSON.stringify(input.values),
        maskedKeysJson: JSON.stringify(input.maskedKeys),
        isDefault: input.isDefault,
        enabledForModesJson: JSON.stringify(input.enabledForModes),
      },
    });

    return mapProfile(record);
  }

  async update(profileId: string, input: UpdateProfileRequest) {
    const existing = await this.getById(profileId);
    if (!existing) {
      return null;
    }

    const record = await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.extendsProfileId !== undefined
          ? { extendsProfileId: input.extendsProfileId }
          : {}),
        ...(input.values !== undefined ? { valuesJson: JSON.stringify(input.values) } : {}),
        ...(input.maskedKeys !== undefined
          ? { maskedKeysJson: JSON.stringify(input.maskedKeys) }
          : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.enabledForModes !== undefined
          ? { enabledForModesJson: JSON.stringify(input.enabledForModes) }
          : {}),
      },
    });

    return mapProfile(record);
  }

  async delete(profileId: string) {
    await this.prisma.profile.delete({
      where: { id: profileId },
    });
  }
}
