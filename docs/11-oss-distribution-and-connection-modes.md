# 11. OSS Distribution and Connection Modes

## 目的

`gokart-station` を OSS として配りやすくするための設計原則を定義する。

## 原則

### 1. station は独立レポジトリである
- target pipeline repo とは別に clone / install できる
- monorepo 前提にしない
- target repo に station 用 TS / UI コードを置かせない

### 2. 接続モードを明示する
- observer
- operator
- managed

mode が曖昧だと、workspace-only 接続なのに run を押せてしまうなどの事故が起きる。

### 3. workspace-only 接続の価値を認める
workspace しか見えない環境でも、artifact / logs / raw payload / support export の価値はある。  
これを正規の observer mode として扱う。

### 4. operator は明示的な権限拡張である
run / stop / rerun / profile 編集 / scheduler lifecycle は operator 以上に限定する。

### 5. adapter は sidecar / package である
target repo に station 固有コードを大量に入れる形にしない。

## モード別の要件

### Observer
必要:
- workspaceDirectory

任意:
- raw task-info path
- exported support bundle path

### Operator
必要:
- projectRootDir
- pythonExecutable
- entrypointPath
- workspaceDirectory
- schedulerBaseUrl

任意:
- luigiConfigPath
- envSourcePath

### Managed
Operator に加えて:
- package install や managed sidecar の実行余地

## OSS として避けるべきこと

- target repo のコードを書き換えないと station が動かない設計
- target repo と同一ディレクトリでないと動かない設計
- workspace-only でも run できるかのように見せる UI
- config/env を無制限に編集できる設計

## 推奨配布形態

- `gokart-station` npm / GitHub release
- Python adapter は将来的に別 package 化
- target project は profile 登録で接続
