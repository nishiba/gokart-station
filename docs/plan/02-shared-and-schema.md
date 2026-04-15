# 02. shared and schema

目的:
- docs/03-typescript-types.md を source of truth として shared types を実装する
- AccessMode, CapabilitySet, ProjectConnection, Run, Profile, TaskLineageNode, ArtifactManifestEntry などの型を作る
- zod schema と API DTO を揃える
- Prisma schema を write model / read model 分離で作る

必須要件:
- `packages/shared/src/domain/types.ts`
- `packages/shared/src/schemas/*`
- `packages/shared/src/api/*`
- `prisma/schema.prisma`
を実装する

注意:
- local control plane 前提
- `ProjectConnection` と `CapabilitySet` を first-class object にする
- `RunSpec` を first-class object にする
- `TaskLineageNode` を first-class object にする
- `tree-info` text は raw artifact として扱い、主要 read model の中心にしない

受け入れ条件:
- shared package の型 export が揃う
- Prisma migration が生成できる
- 型と schema の命名が docs と一致する
