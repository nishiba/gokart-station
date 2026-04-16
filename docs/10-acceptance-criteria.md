# 10. Acceptance Criteria

## Definition of Done

- [ ] MVP 完了条件が `Common` `Observer mode` `Operator mode` の全項目達成であると固定されている
- [ ] `managed` は MVP の別モードではなく、operator を満たした上で将来拡張の余地を壊していないことを確認対象とする

## 共通

- [ ] station repo と target repo が別レポジトリ / 別ディレクトリでも登録できる
- [ ] repo root `README.md` と `examples/sample_gokart_project/README.md` を読めば、第三者が sample project で observer / operator の両導線を再現できる
- [ ] `examples/sample_gokart_project/README.md` に maintainer ローカル絶対パスが残っていない
- [ ] `AccessMode` の語彙が `observer | operator | managed` で統一されている
- [ ] `CapabilitySet` が mode と接続 validate 結果から導出される前提で docs が整合している
- [ ] workspace-only 接続は `accessMode = observer` として扱われる
- [ ] run control は `operator` 以上でのみ有効化される
- [ ] docs/README.md が入口になっている
- [ ] docs/* が設計の真実源として整っている
- [ ] AGENTS.md が実装規約の真実源になっている
- [ ] release preflight と known limitations が `README.md` / `docs/README.md` / `docs/10-acceptance-criteria.md` / `AGENTS.md` で矛盾なく説明される

## Observer mode

- [ ] workspace-only の project を `accessMode = observer` で登録できる
- [ ] observer project は `projectRootDir` / `pythonExecutable` / `entrypointPath` なしで validate できる
- [ ] observer mode と `CapabilitySet` が UI に明示される
- [ ] artifact manifest を閲覧できる
- [ ] task info raw / logs / support bundle を閲覧できる
- [ ] 既存 run / lineage / raw payload を read-only で閲覧できる
- [ ] run 作成・stop・rerun が UI で無効または非表示になり、API では 403 を返す
- [ ] profile 作成・更新・削除・resolve preview が UI / API の両方で禁止される
- [ ] scheduler start / stop / restart が UI / API の両方で禁止される
- [ ] sample project を observer project として登録し、files / watch / support bundle / run history の read-only 導線を web smoke E2E で確認できる

## Operator mode

### Project / Profiles
- [ ] Project を `accessMode = operator` で登録できる
- [ ] Project を validate できる
- [ ] `projectRootDir` / `pythonExecutable` / `entrypointPath` / `workspaceDirectory` / `schedulerBaseUrl` を validate できる
- [ ] operator mode と `CapabilitySet` が UI に明示される
- [ ] config profile を作成・更新・削除できる
- [ ] env profile を作成・更新・削除できる
- [ ] profile resolve を preview できる

### Scheduler
- [ ] localhost `luigid` の health を確認できる
- [ ] `luigid` を start / stop / restart できる
- [ ] scheduler 異常時に UI に warning が出る
- [ ] scheduler lifecycle の web smoke E2E が通る

### Run Control
- [ ] Run を作成できる
- [ ] Run を開始できる
- [ ] Run を graceful stop できる
- [ ] Run を force stop できる
- [ ] Run を rerun できる
- [ ] sample project に対する success / failed / partial failure の integration test が通る

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
- [ ] file tree は metadata-only browsing として見られ、直接 text preview が未対応であることが UI / docs に明示される
- [ ] watch event を見られる
- [ ] support bundle を export できる
- [ ] support bundle に mode / capability / validation snapshot が入る
- [ ] support bundle content を automated test で確認できる
- [ ] support bundle に masked secret value の平文が残らない
- [ ] 巨大ログをページング取得できる

### Safety
- [ ] rootDir 外 path を拒否できる
- [ ] workspace 外 path を拒否できる
- [ ] symlink 逸脱を拒否できる
- [ ] zombie process を残さない
- [ ] sensitive env key をマスクできる
- [ ] 強制終了後に run process cleanup が完了する

## Managed mode の余地

- [ ] operator mode の条件を満たす
- [ ] Python adapter package 化や将来の sidecar / remote store 対応の余地を壊していない

## Release Preflight

- [ ] `pnpm install`
- [ ] sample project 用 Python environment 準備手順が `README.md` と `examples/sample_gokart_project/README.md` にある
- [ ] `pnpm release:check`
- [ ] sample project を separate repo / separate workspace 前提で observer / operator の両方で手動確認できる
- [ ] release candidate では real `luigid` を使った operator smoke を 1 回通す

## Known Limitations

- [ ] file tree は metadata-only であり、直接 text preview / edit は含まない
- [ ] support bundle export は single archive ではなく runtime directory + `bundle.json` manifest を返す
- [ ] support bundle は metadata と masked 済み payload を返し、profile source file の中身は含めない
- [ ] automated integration / E2E は localhost port bind が可能な環境を前提とする
