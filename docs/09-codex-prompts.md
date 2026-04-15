# 09. Codex Prompts

Codex へ投入する改訂版 12 本の prompt は `docs/plan/*` を正とする。

## 実行順

1. [00-repo-rules-and-definition-of-done.md](./plan/00-repo-rules-and-definition-of-done.md)
2. [01-bootstrap.md](./plan/01-bootstrap.md)
3. [02-shared-and-schema.md](./plan/02-shared-and-schema.md)
4. [03-project-profile-api.md](./plan/03-project-profile-api.md)
5. [04-scheduler-lifecycle.md](./plan/04-scheduler-lifecycle.md)
6. [05-python-adapter-event-contract.md](./plan/05-python-adapter-event-contract.md)
7. [06-sample-gokart-project-and-fixtures.md](./plan/06-sample-gokart-project-and-fixtures.md)
8. [07-run-control-and-sse.md](./plan/07-run-control-and-sse.md)
9. [08-gokart-lineage-and-artifacts.md](./plan/08-gokart-lineage-and-artifacts.md)
10. [09-web-core-ui.md](./plan/09-web-core-ui.md)
11. [10-files-watch-hardening.md](./plan/10-files-watch-hardening.md)
12. [11-stabilization-e2e-and-release.md](./plan/11-stabilization-e2e-and-release.md)

## この版での注意

- observer / operator / managed の mode 境界を崩さない
- station と target repo は独立ディレクトリを前提にする
- workspace-only 接続では run 制御を実装しない
- Python adapter は target repo に恒久埋め込みしない
- `luigid` lifecycle は health だけでなく start / stop / restart まで含める
