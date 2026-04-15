# 01. bootstrap

目的:
- `gokart-station` の monorepo を初期構築する
- apps/web, apps/agent, apps/py_adapter, packages/shared を作る
- TypeScript strict, pnpm workspace, Tailwind, shadcn/ui, Prisma, SQLite を導入する

必須要件:
- repo 名は `gokart-station`
- package manager は pnpm
- web は Vite + React + TypeScript
- agent は Fastify + TypeScript
- py_adapter は Python package 形式の足場を持つ
- shared package を作る
- Prisma + SQLite を導入する
- lint / format / typecheck scripts を追加する
- README.md に station repo と target repo が独立である前提を書く

成果物:
- apps/web
- apps/agent
- apps/py_adapter
- packages/shared
- prisma/schema.prisma
- pnpm-workspace.yaml
- root package.json
- README.md

受け入れ条件:
- `pnpm install`
- `pnpm typecheck`
- `pnpm --filter web dev`
- `pnpm --filter agent dev`
が通る
