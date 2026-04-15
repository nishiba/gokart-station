# gokart-station docs

このディレクトリは `gokart-station` の設計・実装・運用の真実源である。  
`gokart-station` は **gokart / Luigi パイプラインのためのローカル control plane** であり、OSS として独立配布しやすい形を前提に設計する。

## この版での重要な方針

- `gokart-station` と対象 gokart プロジェクトは **独立ディレクトリ / 独立レポジトリ** を前提とする
- 接続モードを **observer / operator / managed** に分ける
- `workspace_directory` のみ見える場合は **observer mode** とし、実行制御は行わない
- 実行・停止・profile 解決まで行う場合は **operator mode** とし、project root / entrypoint / Python / config / env / workspace へアクセスする
- Python adapter は target repo へ恒久的に埋め込まず、**別 package / 別実行体** として扱う
- `--local-scheduler` は開発時の補助手段であり、制御面の中心は **localhost の `luigid`** とする
- run state の真実源は filesystem watch event ではなく、**scheduler state → adapter metadata → supplementary files → artifact inventory → watch event** の順とする

## 文書一覧

- [00-product-overview.md](./00-product-overview.md)
- [01-architecture.md](./01-architecture.md)
- [02-screen-spec.md](./02-screen-spec.md)
- [03-typescript-types.md](./03-typescript-types.md)
- [04-api-contract.md](./04-api-contract.md)
- [05-data-model-and-state.md](./05-data-model-and-state.md)
- [06-python-adapter-and-runner.md](./06-python-adapter-and-runner.md)
- [07-operations-and-security.md](./07-operations-and-security.md)
- [08-implementation-plan.md](./08-implementation-plan.md)
- [09-codex-prompts.md](./09-codex-prompts.md)
- [10-acceptance-criteria.md](./10-acceptance-criteria.md)
- [11-oss-distribution-and-connection-modes.md](./11-oss-distribution-and-connection-modes.md)
- [12-deployment-topologies.md](./12-deployment-topologies.md)

## docs/plan の役割

`docs/plan/*` は、Codex に順番に投入して実装を完成まで持っていくための実行計画である。  
`docs/*` が設計の真実源、`docs/plan/*` が実装手順の真実源である。

## 読む順番

1. Product overview
2. OSS distribution and connection modes
3. Architecture
4. Screen spec
5. Types / API
6. Adapter / Runner
7. Operations / Security
8. Implementation plan
9. Codex prompts
10. Acceptance criteria

## 参照した前提

この設計は、gokart が `workspace_directory` を config / environment variable で設定できること、`task-info` / `make_task_info_as_table()` / `dump_task_info_tree()` などの task information API を持つこと、Luigi の central scheduler が可視化と重複実行防止を担うことを前提にしている。
