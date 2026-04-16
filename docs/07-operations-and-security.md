# 07. Operations and Security

## 運用原則

- local first
- fail transparent
- raw を残す
- path sandbox を守る
- 強制終了を最後の手段にする
- mode ごとに capability を厳密に分ける
- target repo を汚さない

## OSS 配布しやすさの原則

- station は単独レポジトリとして配布できるようにする
- target pipeline repo に TS / UI コードを置かせない
- Python adapter は sidecar / package として扱う
- target repo への変更が必要な場合でも最小にする
- observer mode を用意し、workspace しか見えない環境でも read-only 価値を出す

## Path Sandbox

Node / Python adapter ともに、project root と workspace の sandbox を守る。

許可対象:
- workspaceDirectory 配下
- operator / managed では projectRootDir 配下
- 明示登録された luigi config path
- 明示登録された env source path

拒否対象:
- `..` を用いた逸脱
- symlink 経由の root 外参照
- 任意 shell 展開
- observer mode での projectRootDir 前提操作

symlink 方針:
- `projectRootDir` は symlink 禁止
- `workspaceDirectory` は `allowWorkspaceDirectorySymlink = true` の明示時だけ許可し、default は禁止
- `luigiConfigPath` / `envSourcePath` は symlink 禁止
- watcher / file tree / support bundle は上記 policy を満たした sandbox scope だけを対象にする

## Process 安全性

- process group 単位で管理する
- run 終了後に registry cleanup
- zombie process を残さない
- stop escalation timeout を設定する
- scheduler start/stop も PID 管理する
- scheduler runtime は station repo 配下の pidfile / logdir で管理する
- scheduler lifecycle は localhost port のみを対象にする

## ログ取り扱い

- stdout / stderr は行単位保存
- env profile の masked key はログに出さない
- config / env profile の masked key は adapter が stdout / stderr / raw task info を保存前に再マスクする
- raw stderr を保持する
- 巨大ログは `limit` / `offset` ベースでページングする
- support bundle は masked 済み payload を収集し、bundle 生成時に secret の平文を新たに書き出さない

## Config / Env 編集

- operator / managed のみ許可する
- 保存前 parse validation を実施する
- env の sensitive key は mask する
- config profile は `section.option` key を runtime 時に temporary Luigi config へ materialize する
- profile resolve 結果を preview する
- observer mode では read-only とする

## 監視

watch event は補助である。  
run state は scheduler / adapter event を優先する。

- watcher は sandbox 内の scope のみを対象にする
- native filesystem event を優先し、snapshot scan は fallback に限定する
- fallback snapshot scan は長めの interval と backoff を持たせる
- symlink は follow しない
- project 削除 / app close 時に watcher cleanup を行う

## 障害時の見方

優先的に見るべき順序:
1. scheduler health
2. run timeline
3. stderr
4. task lineage
5. artifact manifest
6. watch events
7. raw payloads

## support export

最低限 export できるもの:
- project connection metadata
- run metadata json
- logs txt
- scheduler health json
- scheduler snapshot json
- task info raw
- artifact manifest json
- validation result
- mode / capability snapshot

含めないもの:
- env / config profile の生値
- env source file / config source file の中身

MVP では station runtime 配下に support bundle directory を作り、その中の `bundle.json` を返してよい。  
archive packaging は後段で追加してよいが、bundle 内容の欠落は不可とする。

## mode 別の運用制約

### Observer
- run / stop / rerun 禁止
- profile 編集禁止
- scheduler lifecycle 操作禁止
- workspace 読み取り中心

### Operator
- full local operation
- target repo / config / env へのアクセスを前提にする

### Managed
- operator を含む
- package install / sidecar 実行などの将来拡張を許容する

## 将来の拡張前提

- localhost 前提を壊さない
- multi-project を許容する
- remote artifact store は adapter 側拡張で吸収する
