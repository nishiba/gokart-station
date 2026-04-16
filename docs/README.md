# gokart-station docs

このディレクトリは `gokart-station` の設計・実装・運用の真実源である。  
`gokart-station` は **gokart / Luigi パイプラインのためのローカル control plane** であり、OSS として独立配布しやすい形を前提に設計する。

## この版での重要な方針

- `gokart-station` と対象 gokart プロジェクトは **独立ディレクトリ / 独立レポジトリ** を前提とする
- mode の正準語彙は `AccessMode`、capability の正準語彙は `CapabilitySet` とする
- `AccessMode` は **observer / operator / managed** に固定する
- `workspace_directory` のみ見える場合は `accessMode = observer` とし、実行制御は行わない
- run / stop / rerun / profile resolve / profile edit / scheduler lifecycle は `operator` 以上でのみ有効化する
- `CapabilitySet` は `AccessMode` と接続 validate 結果から導出する
- Python adapter は target repo へ恒久的に埋め込まず、**別 package / 別実行体** として扱う
- `--local-scheduler` は開発時の補助手段であり、制御面の中心は **localhost の `luigid`** とする
- run state の真実源は filesystem watch event ではなく、**scheduler state → adapter metadata → supplementary files → artifact inventory → watch event** の順とする

## 完成条件

- MVP の Definition of Done は `docs/10-acceptance-criteria.md` とする
- `Common` `Observer mode` `Operator mode` の全受け入れ条件を満たした時点を完成とする
- `Managed mode` は完成条件そのものではなく、将来の adapter package / sidecar / remote store 対応の余地を壊していないことを確認対象とする

## Release Readiness

- 第三者向けの入口は repo root の `README.md` と `examples/sample_gokart_project/README.md` とする
- release 前チェックの source of truth は `docs/10-acceptance-criteria.md` と root `package.json` の `release:check` script とする
- sample gokart project を使った automated verification は次を含む
  - Python adapter integration
  - success / failed / partial failure
  - observer / operator の mode 差分
  - scheduler lifecycle
  - support bundle content
  - web smoke E2E

## Known Limitations

- file tree は metadata-only browsing を MVP とし、直接 text preview / edit は含めない
- support bundle export は runtime directory + `bundle.json` manifest を返す MVP とする
- automated E2E / integration は localhost port bind が可能な環境を前提とする
- scheduler lifecycle の automated check は localhost fixture process で行い、release candidate では real `luigid` での最終 smoke を推奨する

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
2. OSS distribution and access modes
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
