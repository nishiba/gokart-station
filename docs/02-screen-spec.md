# 02. Screen Specification

## 画面一覧

1. `/projects`
2. `/projects/:projectId`
3. `/projects/:projectId/runs/new`
4. `/projects/:projectId/runs/:runId`
5. `/projects/:projectId/profiles`
6. `/projects/:projectId/connection`
7. Global command palette

---

## 1. Projects 一覧

### 目的
登録済み gokart project を一覧で管理する。

### 主情報
- project name
- access mode
- capability badges
- root directory または observer note
- workspace directory
- entrypoint
- last run status
- running run count
- scheduler health

### 主操作
- Project 作成
- Project 編集
- Validate
- Open detail
- Quick run（observer では disabled）

### UX 要件
- mode を最上段に明示する
- `luigid` 未起動時は operator / managed だけ warning banner を出す
- observer mode では「read-only」バッジを常時出す
- Validate 結果は inline と modal の両方で確認できる

---

## 2. Project Detail

タブ構成とする。

### Tab A: Overview
表示:
- project summary
- access mode / capability snapshot
- scheduler health
- active runs
- recent failures
- profile summary
- workspace summary

操作:
- New run（observer では disabled）
- Open profiles
- Open connection
- Open settings
- Validate project

### Tab B: Runs
表示:
- run table
- status / task / profile / startedAt / duration / exitCode
- filters

操作:
- open run
- rerun
- stop
- clone run spec

observer では read-only list のみ表示する。

### Tab C: Profiles
表示:
- config profiles
- env profiles
- active defaults
- read-only reason

observer では編集 UI を出さない。

### Tab D: Files
表示:
- tree browser
- preview pane
- scope selector

scope:
- workspace
- outputs
- logs
- task-info
- config
- env

observer では workspace と raw export 中心とする。

### Tab E: Watch
表示:
- watch event table
- path
- kind
- source
- occurredAt
- related run

### Tab F: Connection
表示:
- access mode
- resolved paths
- python executable
- entrypoint
- workspace
- config/env source
- scheduler endpoint
- validation issues
- capability matrix

---

## 3. New Run

### 目的
run spec を作成して実行する。

observer mode ではこの画面へ入れない。  
operator / managed のみ許可する。

### セクション

#### A. Root Task
- root task name
- description
- recent tasks

#### B. Parameters
- key-value editor
- type selector
  - string
  - number
  - boolean
  - json
- import from previous run

#### C. Profiles
- config profile
- env profile
- default / custom override
- dry-run resolve preview

#### D. Execution
- scheduler mode
  - central scheduler only
- worker count
- rerun mode
  - none
  - force_rerun_flag
  - parameter_change
  - profile_change
  - code_change_expected
- adapter options

#### E. Output Metadata
- capture task info tree
- capture task info table
- capture artifact manifest
- enable watch overlay

### 主操作
- Run now
- Save draft
- Save as template

### バリデーション
- root task 必須
- invalid parameter key を拒否
- conflicting profile warning
- unknown env variable reference warning
- capability 不足時は submit 禁止

---

## 4. Run Detail

### ヘッダー
- run status
- root task
- run label
- access mode
- profile summary
- startedAt / finishedAt / duration
- adapter status
- scheduler task count

### 主操作
- stop
- rerun same spec
- rerun with override
- duplicate as draft
- export metadata

observer では stop / rerun を非表示にする。

### Tab A: Timeline
表示:
- run lifecycle events
- task state transitions
- stop / rerun markers
- errors

### Tab B: Graph
表示:
- DAG
- node state
- selected path highlight
- only failed path toggle
- only changed lineage toggle

### Tab C: Lineage
表示:
- selected task lineage card
- unique id
- parameter diff vs previous successful run
- upstream / downstream links
- outputs
- rerun reason
- processing time
- task log summary

### Tab D: Logs
表示:
- stdout
- stderr
- system events
- search
- pause auto-scroll
- download

### Tab E: Artifacts
表示:
- artifact manifest table
- path
- type
- size
- producing task
- preview available flag

### Tab F: Raw
表示:
- raw tree-info
- task info table JSON
- adapter payloads
- scheduler snapshot JSON

---

## 5. Profiles

### Config Profile 一覧
- name
- source file(s)
- overrides count
- updatedAt
- default flag

### Env Profile 一覧
- name
- masked keys count
- updatedAt
- default flag

### Profile Editor
- name
- description
- inheritance
- key-value overrides
- diff preview
- dry-run validation result

### Raw Editor
- config raw text
- env raw text
- parse errors

observer mode では一覧のみ、編集不可とする。

---

## 6. Connection

### 目的
station と target project の接続状態と権限を明示する。

### 表示
- access mode
- target project root
- workspace directory
- python executable
- entrypoint path
- resolved config files
- resolved env sources
- scheduler URL
- validation warnings / errors
- capability matrix

### 主操作
- mode change
- revalidate
- test scheduler
- test workspace access
- test python spawn
