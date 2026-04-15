# 01. Architecture

## 設計原則

最重要原則は次である。

> TS 側で gokart の意味論を再構成しない。  
> gokart / Luigi の意味論は Python 側で正規化し、TS 側は control plane と UX に徹する。

## 全体構成

```text
React UI (apps/web)
    |
    | HTTP + SSE
    v
Node Control Plane (apps/agent)
    |                         \
    | spawn / local RPC        \ HTTP polling / start/stop
    v                           v
Python Adapter              Luigi Central Scheduler (luigid, localhost)
    |
    | gokart APIs / task info / CLI / config/env resolution
    v
Target Gokart Project  <---->  Workspace Directory
```

## 独立レポジトリ前提の配置

```text
~/src/gokart-station/            # station 本体
~/src/my-gokart-pipeline/        # target pipeline repo
~/data/my-gokart-workspace/      # workspace_directory
```

station と target repo は **別ディレクトリ / 別レポジトリ** を前提にする。  
同一 repo へ押し込む設計にはしない。

## コンポーネント責務

### 1. React UI
責務:
- 状態表示
- 操作起点
- モードごとの権限制御表示
- graph / lineage / logs / artifacts の可視化

非責務:
- Python 実行
- path validation の最終判定
- gokart task info の正規化

### 2. Node Control Plane
責務:
- Project / Profile / ConnectionMode 管理
- `luigid` の start / stop / restart / health
- Python adapter 実行
- イベント集約
- read model 構築
- SQLite 永続化
- SSE 配信
- mode-aware capability enforcement

非責務:
- task graph の意味論構築
- tree-info 文字列の一次解析の中心

### 3. Python Adapter
責務:
- gokart / Luigi の意味論の正規化
- run spec を受けてタスク実行
- task info table / tree の生成
- task_log / task_params / processing_time / module_versions の inventory 化
- artifact manifest 生成
- lineage snapshot 生成
- stop 要求の bridge

非責務:
- UI レンダリング
- user session 管理
- station 固有の永続化

### 4. luigid
責務:
- scheduler state
- dedupe
- visualization-ready state
- task history

## 状態の真実源

優先順位を固定する。

1. Luigi scheduler state
2. Python adapter が生成した structured task metadata
3. gokart supplementary files
4. artifact inventory
5. filesystem watch event

watch event は補助情報に留める。

## モード別 capability

### Observer mode
- `canReadWorkspace = true`
- `canReadArtifacts = true`
- `canRun = false`
- `canStop = false`
- `canEditProfiles = false`
- `canManageScheduler = false`

### Operator mode
- Observer に加えて
- `canRun = true`
- `canStop = true`
- `canEditProfiles = true`
- `canManageScheduler = true`

### Managed mode
- Operator に加えて
- `canInstallAdapter = true`
- `canSupportRemoteStores = future`

## Read Model

Node Control Plane は write model と read model を分ける。

### Write Model
- Project
- ProjectConnection
- Profile
- RunSpec
- RunControlAction

### Read Model
- RunSnapshot
- TaskLineageNode
- ArtifactManifestEntry
- SchedulerSnapshot
- WatchEvent
- CapabilitySnapshot

## Run Lifecycle

1. UI が RunSpec を作成
2. Node が project / mode / profiles を解決
3. Node が capability を確認
4. Node が `luigid` を起動または健全性確認
5. Node が Python adapter を起動
6. Python adapter が gokart run を開始
7. Python adapter が task info / artifact / log をイベントとして送る
8. Node が DB と SSE に反映
9. UI がリアルタイム表示

Observer mode では 1〜7 を許可しない。

## Stop Lifecycle

停止は 3 段階とする。

1. **cooperative stop**
   - 将来の Luigi message 対応を見据えた論理停止
2. **process-group stop**
   - Python adapter とその子プロセス群を止める
3. **hard kill**
   - timeout 超過時に強制終了する

## 重要な判断

### local-scheduler を設計の中心にしない
`--local-scheduler` は開発用途では有用だが、station の control plane では `luigid` を中核に置く。

### tree-info text を一次データにしない
`tree-info` は raw artifact として保存するが、UI の主要 read model は Python adapter が作る JSON を使う。

### filesystem watcher を補助的位置に置く
watch event は便利だが、run state の真実源ではない。

### target repo を汚さない
station 専用の UI / TS コードを target repo へ置かない。  
必要な Python 側連携は package / sidecar / temp file で行う。

## 推奨技術構成

### apps/web
- Vite
- React
- TypeScript
- React Router
- TanStack Query
- Zustand
- Tailwind
- shadcn/ui
- React Flow
- xterm.js

### apps/agent
- Fastify
- TypeScript
- Prisma
- SQLite
- chokidar
- zod

### Python adapter
- Python 3.11+
- gokart
- luigi
- pydantic
- orjson

## 拡張余地

- S3 / GCS artifact inventory
- task history deep linking
- run diff / artifact diff
- batch rerun plan
- multi-project dashboard
- managed connector installer
