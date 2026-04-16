# 05. Data Model and State

## 方針

write model と read model を分離する。  
さらに **`AccessMode` と `CapabilitySet`** を明示的にモデル化する。

## Write Model

### Project
station が target pipeline と接続する単位。  
connection 情報を持つ。

### Profile
config / env の再利用可能な設定束。  
observer では参照不可または read-only とする。

### RunSpec
一回の実行の宣言。  
operator / managed のみ作成可能。

### RunControlAction
stop / rerun / scheduler start などの操作履歴。

## Read Model

### CapabilitySnapshot
project connection の `accessMode` と validate 結果から導出した実効 capability。

### RunSnapshot
ある run の現在状態。

### SchedulerSnapshot
scheduler 観測結果。

### TaskLineageNode
task の構造化メタデータ。

### ArtifactManifestEntry
artifact と producing task の対応。

### TimelineEvent
run の経時イベント。

### WatchEvent
filesystem 変化の補助イベント。

## 推奨 DB テーブル

- projects
- profiles
- runs
- run_control_actions
- capability_snapshots
- scheduler_snapshots
- task_lineage_nodes
- task_graph_edges
- artifacts
- timeline_events
- log_events
- watch_events

## 状態遷移

### Run
- draft
- queued
- starting
- running
- stopping
- success
- failed
- canceled

### 遷移ルール

#### draft -> queued
UI から Run 作成

#### queued -> starting
Node が adapter を spawn

#### starting -> running
adapter が scheduler と接続し execution 開始

#### running -> success
正常終了

#### running -> failed
非 0 exit または adapter 失敗

#### running -> stopping
stop 要求受付

#### stopping -> canceled
停止完了

#### stopping -> failed
停止中に異常終了

## AccessMode と CapabilitySet の関係

### Observer
- read models のみ生成
- run 作成なし
- scheduler lifecycle 操作なし
- profile 編集なし

### Operator
- observer の read models に加え
- run / stop / rerun
- profile 編集
- scheduler lifecycle 操作

### Managed
- operator を含み
- 将来の package install / remote store 対応用の余地を持つ

## Rerun Reason モデル

`TaskLineageNode.rerunReason` は少なくとも次を許容する。

- `same_spec_manual`
- `force_rerun_flag`
- `parameter_change`
- `profile_change`
- `code_change_expected`
- `upstream_changed`
- `unknown`

## Raw 保存ポリシー

次は raw artifact として保存する。

- task-info tree raw
- task-info table raw
- adapter events raw
- scheduler payload raw
- stderr raw

raw は主要 read model ではないが、障害調査のために保持する。
