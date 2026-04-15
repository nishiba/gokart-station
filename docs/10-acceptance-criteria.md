# 10. Acceptance Criteria

## 共通

- [ ] station repo と target repo が別ディレクトリでも登録できる
- [ ] docs/README.md が入口になっている
- [ ] docs/* が設計の真実源として整っている
- [ ] AGENTS.md が実装規約の真実源になっている

## Observer mode

- [ ] workspace-only の project を登録できる
- [ ] observer mode と capability が UI に明示される
- [ ] artifact manifest を閲覧できる
- [ ] task info raw / logs / support bundle を閲覧できる
- [ ] run 作成・stop・rerun が UI / API の両方で禁止される

## Operator mode

### Project / Profiles
- [ ] Project を登録できる
- [ ] Project を validate できる
- [ ] config profile を作成・更新・削除できる
- [ ] env profile を作成・更新・削除できる
- [ ] profile resolve を preview できる

### Scheduler
- [ ] localhost `luigid` の health を確認できる
- [ ] `luigid` を start / stop / restart できる
- [ ] scheduler 異常時に UI に warning が出る

### Run Control
- [ ] Run を作成できる
- [ ] Run を開始できる
- [ ] Run を graceful stop できる
- [ ] Run を force stop できる
- [ ] Run を rerun できる

### Observability
- [ ] run timeline が見える
- [ ] stdout / stderr が見える
- [ ] task graph が見える
- [ ] task lineage が見える
- [ ] previous-success compare が見える
- [ ] artifact manifest が見える
- [ ] raw payload を見られる

### File / Watch
- [ ] file tree を見られる
- [ ] text preview ができる
- [ ] watch event を見られる

### Safety
- [ ] rootDir 外 path を拒否できる
- [ ] workspace 外 path を拒否できる
- [ ] symlink 逸脱を拒否できる
- [ ] zombie process を残さない
- [ ] sensitive env key をマスクできる

## Managed mode の余地

- [ ] operator mode の条件を満たす
- [ ] Python adapter package 化の余地を壊していない
