# 08. Implementation Plan

## 実装方針

MVP でも control plane の骨格を最初から入れる。  
後から `luigid` や adapter を付け足す設計にはしない。

さらに、最初から **observer / operator / managed** の mode 境界を入れる。  
workspace-only 接続と実行制御接続を曖昧にしてはならない。

## フェーズ分割

### Phase 0: Definition of Done / Repo Rules
- docs 整備
- AGENTS 整備
- mode / capability 定義
- OSS 配布方針の固定

### Phase 1: Foundation
- monorepo
- shared types
- SQLite / Prisma
- web shell
- agent shell
- basic project CRUD

### Phase 2: Connection Modes + Scheduler
- observer / operator / managed の導入
- project validate
- local `luigid` start / stop / health
- profile CRUD
- profile resolve preview

### Phase 3: Python Adapter
- adapter scaffold
- run spec input
- structured event output
- basic gokart run

### Phase 4: Run Control
- run create
- run stop
- timeline
- log stream
- run list

### Phase 5: Graph + Lineage + Artifacts
- lineage generation
- graph API
- artifact manifest
- preview
- previous-success compare

### Phase 6: Files + Watch + Raw Debug
- file tree
- watch event
- raw payload views
- export support bundle

### Phase 7: Stabilization
- sample gokart project
- E2E
- partial failure tests
- docs refresh
- release checklist

## PR 分割

### PR-00
repo rules + definition of done

### PR-01
repo bootstrap

### PR-02
shared domain types + zod + Prisma schema

### PR-03
project / profile / mode API

### PR-04
scheduler lifecycle + validation

### PR-05
python adapter scaffold + event contract

### PR-06
sample gokart project + fixtures

### PR-07
run create + stop + logs SSE

### PR-08
timeline + run detail UI

### PR-09
lineage + graph + compare

### PR-10
artifact manifest + preview

### PR-11
files + watch + support export + hardening

### PR-12
stabilization + E2E + release docs

## 完成定義

- station repo と target repo が別でも接続できる
- observer mode で read-only 可視化が成立する
- operator mode で UI から run を作成できる
- `luigid` 接続を UI から起動・停止・確認できる
- run を止められる
- task graph が表示される
- task lineage が表示される
- artifact manifest が表示される
- config / env profile を編集できる
- docs と AGENTS が source of truth として整っている
