# 00. Product Overview

## プロダクト名

**gokart-station**

## 一言で何か

gokart / Luigi ベースの pipeline を、対象プロジェクトを汚さずにローカルで観測・操作するための  
**実行制御・観測・lineage 可視化ツール** である。

## 解決したい課題

gokart は再現性、依存管理、出力管理に優れる一方、日常運用では次がつらい。

- どの task が今どこで詰まっているかを UI で掴みにくい
- 実行・停止・rerun の操作が CLI と設定ファイルに分散しやすい
- task_log / task_params / processing_time / output の横断閲覧が弱い
- 「なぜ rerun されたか」「なぜ output が変わったか」を説明しにくい
- workspace だけ見える read-only 運用と、実行制御を含む運用を区別しにくい
- station を OSS として配りたいときに、対象 repo へ改修を強要すると使われにくい

## 基本方針

本プロダクトは **対象 gokart repo の内側に埋め込むツールではない**。  
**独立配布される local control plane** として設計する。

### 独立の意味
- 別レポジトリで配布できる
- 別ディレクトリで動く
- target repo に恒久的な UI コードを置かない
- 必要なら Python adapter を package として利用する

## 接続モード

### 1. Observer mode
必要アクセス:
- `workspace_directory` のみ

できること:
- artifact 閲覧
- task_log / processing_time / module_versions の閲覧
- raw task-info / support bundle の閲覧
- 過去 run の read-only 可視化

できないこと:
- run 作成
- stop / rerun
- config / env 編集
- scheduler lifecycle 管理

### 2. Operator mode
必要アクセス:
- project root
- Python executable
- entrypoint path
- config / env source
- `workspace_directory`

できること:
- run 作成
- graceful stop / force stop
- rerun
- profile resolve
- config / env 編集
- scheduler lifecycle 管理
- lineage / artifacts / logs の一貫可視化

### 3. Managed mode
Operator mode に加えて:
- Python adapter package を target 環境へ導入できる
- 将来、複数 workspace / remote artifact store へ拡張しやすい

## 非目標

- Luigi / gokart の置き換え
- workflow authoring IDE
- 分散実行基盤の内製
- team auth / RBAC
- cron / scheduler の置き換え
- notebook IDE
- target repo に station 専用コードを大量に埋め込むこと

## ユーザー価値

### 1. 実行制御の一元化
- Run を作る
- Run を止める
- Run を rerun する
- config / env profile を切り替える

### 2. 観測性の改善
- scheduler state
- task graph
- task lineage
- stdout / stderr / task_log
- artifact manifest
- workspace watch overlay

### 3. 再現性の説明
- どの parameter で動いたか
- どの unique id だったか
- なぜ rerun されたか
- どの output がどの task から出たか

## MVP で絶対に必要なもの

### Observer MVP
- workspace 接続
- artifact browser
- task info / raw payload 表示
- support export

### Operator MVP
- Project 登録
- scheduler 起動・停止・health 確認
- Run 作成
- Run 停止
- Run 詳細
- task graph
- task lineage
- artifact manifest
- config / env profile
- raw debug view

## 成功指標

- station repo と target repo が別でも登録・接続できる
- observer mode では read-only 制約が UI / API で一貫する
- operator mode では CLI を使わず UI から run を作成できる
- 実行中 run の状態が 2 秒以内の遅延で UI に反映される
- 失敗 task のログ / task_log / parameters / outputs が 1 画面で確認できる
- rerun の種類を UI 上で区別して再実行できる
