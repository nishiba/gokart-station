# AGENTS.md

## 1. Source of Truth

- このファイルを、このリポジトリの開発ルールの source of truth とする
- プロダクト設計の source of truth は `docs/*` とする
- 実装判断で迷ったら `README.md` より先に `AGENTS.md` と `docs/*` を優先する
- 完成条件の source of truth は `docs/10-acceptance-criteria.md` とする
- 画面仕様は `docs/02-screen-spec.md`
- 型定義は `docs/03-typescript-types.md`
- API 契約は `docs/04-api-contract.md`
- アーキテクチャは `docs/01-architecture.md`
- Python adapter の責務は `docs/06-python-adapter-and-runner.md`
- OSS 配布と AccessMode の前提は `docs/11-oss-distribution-and-connection-modes.md`

---

## 2. Product Identity

- プロダクト名は **gokart-station**
- gokart-station は **gokart / Luigi のローカル control plane** である
- 単なる CLI ラッパーや file browser ではない
- station は target gokart repo と **独立レポジトリ / 独立ディレクトリ** を前提とする
- 主要価値は次である
  - 実行制御
  - 観測性
  - task lineage
  - artifact manifest
  - config / env profile
  - rerun 理由の説明
  - workspace-only observer

---

## 3. Access Modes

### 3.1 正準語彙
- mode の正準語彙は `AccessMode` とする
- `AccessMode` の値は `observer | operator | managed` に固定する
- capability の正準語彙は `CapabilitySet` とする
- `CapabilitySet` は `AccessMode` と `ProjectConnection` の validate 結果から導出する
- workspace-only 接続は `observer` に固定する
- run control は `operator` 以上でのみ有効化する

### 3.2 observer
- workspace の read-only 観測のみ
- target repo 非依存で接続できる
- run / stop / rerun を禁止
- profile resolve を禁止
- profile 編集を禁止
- scheduler lifecycle 操作を禁止

### 3.3 operator
- observer に加えて
- target repo の project root / Python / entrypoint / config / env / workspace を解決した上で使う
- run / stop / rerun を許可
- profile resolve を許可
- profile 編集を許可
- scheduler lifecycle 操作を許可

### 3.4 managed
- operator の capability を含む
- Python adapter package 化や将来の sidecar / remote store 対応の余地を保つ

---

## 4. Architecture Rules

### 4.1 層構造

このリポジトリは以下の層で構成する。

- `apps/web`
  - React / TypeScript UI
- `apps/agent`
  - Node / TypeScript control plane
- `apps/py_adapter`
  - Python adapter
- `packages/shared`
  - shared domain types / schemas / DTO

### 4.2 責務分離

#### web の責務
- UI 表示
- query / mutation
- graph / lineage / logs のレンダリング
- command palette
- local UI state
- mode-aware disable / hide

#### agent の責務
- project / profile / run / mode の制御
- `luigid` start / stop / health
- Python adapter spawn / stop
- SSE 配信
- SQLite 永続化
- read model 構築
- capability enforcement

#### py_adapter の責務
- gokart / Luigi の意味論の正規化
- task info / lineage / artifact manifest 生成
- scheduler snapshot 取得
- JSONL event 出力

### 4.3 禁止事項

- web で Python 実行を直接行わない
- agent で gokart の意味論を正規表現中心に再構成しない
- tree-info のテキストを主要データモデルにしない
- watch event を run state の真実源にしない
- `--local-scheduler` を設計の中心に置かない
- target repo に station 固有の TS / UI コードを要求しない
- observer mode で制御系 API を有効化しない

---

## 5. State Source Priority

状態の真実源の優先順位は固定とする。

1. Luigi scheduler state
2. Python adapter が生成した structured metadata
3. gokart supplementary log files
4. artifact manifest
5. filesystem watch event

この順番を崩す変更は禁止する。

---

## 6. Domain Modeling Rules

first-class object は次である。

- `Project`
- `ProjectConnection`
- `CapabilitySet`
- `Profile`
- `RunSpec`
- `Run`
- `SchedulerSnapshot`
- `TaskLineageNode`
- `ArtifactManifestEntry`
- `TimelineEvent`
- `WatchEvent`

`TaskLineageNode` と `ArtifactManifestEntry` を補助型に落としてはならない。

---

## 7. UI Rules

- Home は control surface とする
- Run Detail では次のタブを基本とする
  - Timeline
  - Graph
  - Lineage
  - Logs
  - Artifacts
  - Raw
- Graph と Lineage は分ける
- Raw は必要だが主役にしない
- 危険操作には確認 UI を付ける
- graceful stop と force stop を分ける
- rerun は理由付きで見せる
- observer mode では制御 UI を disable または非表示にする
- access mode と capability を常時見える位置に出す

---

## 8. API Rules

- base path は `/api`
- response は JSON
- リアルタイム更新は SSE
- request / response schema は zod で定義する
- DTO は `packages/shared` に置く
- API 追加時は `docs/04-api-contract.md` を先に更新する
- mode / capability に反する操作は 403 を返す

---

## 9. Data / Persistence Rules

- SQLite + Prisma を使う
- write model と read model を分ける
- raw payload を保持する
- partial failure を許容する
- 主要 raw 保存対象:
  - tree-info raw
  - adapter events
  - scheduler payload
  - stderr
- support bundle は runtime 配下に生成し、mode / capability / validation snapshot を必ず含める

---

## 10. Security Rules

- path sandbox を守る
- operator / managed では rootDir / workspace 外アクセスを拒否する
- observer では workspace 外アクセスを拒否する
- symlink 逸脱を拒否する
- env secret をログ出力しない
- process group 単位で cleanup する
- zombie process を残さない
- watch service は sandbox scope 外を監視しない

---

## 11. Coding Rules

### 共通
- TypeScript は `strict: true`
- 型安全を崩す `any` は原則禁止
- zod schema を先に作る
- 命名は docs の用語に合わせる
- 1 PR 1 論点を守る

### web
- React Router
- TanStack Query
- Zustand は UI ローカル状態に限定
- presentational / container を意識する
- 画面ロジックを肥大化させない

### agent
- service / repository / route を分離
- spawn / stop / cleanup を service に閉じる
- SSE イベントの型を shared に合わせる
- mode 判定と capability 判定を service 層で統一する
- file tree / watch / support bundle も service 層で sandbox 判定を通す

### py_adapter
- event は JSONL
- stdout を protocol、stderr を debug として扱う
- 例外時も可能な限り structured error event を返す
- target repo に station 固有 import を要求しない

---

## 12. File Layout Rules

- `docs/*` は人間向け設計資料
- `docs/plan/*` は Codex 実行計画
- `packages/shared/*` は機械可読の契約
- `apps/web/src/features/*` に機能単位で UI を分ける
- `apps/agent/src/services/*` にビジネスロジックを置く
- `apps/py_adapter/gokart_station_adapter/*` に Python adapter の中核を置く

---

## 13. Delivery Workflow

実装順序は原則として以下に従う。

1. docs 更新
2. shared types / schema 更新
3. backend / adapter 更新
4. web 更新
5. tests 更新

機能追加時は docs と実装を同時に更新する。  
docs 未更新の実装追加は禁止する。

---

## 14. Release Readiness Rules

- release 前の user-facing source of truth は `README.md`, `docs/README.md`, `docs/10-acceptance-criteria.md`, `AGENTS.md` の 4 点を同期する
- sample project を使った observer / operator の再現手順を `README.md` に残す
- release 前チェックは root `package.json` の `release:check` script を基準にする
- automated verification には success / failed / partial failure, observer / operator 差分, scheduler lifecycle, support bundle content, web smoke E2E を含める
- known limitations は実装と矛盾しない形で文書化する
- file tree は metadata-only browsing のまま release してよく、未実装の text preview を完成済みとして扱ってはならない
- support bundle export が runtime directory + manifest であることを隠さない
- localhost port bind を禁止する sandbox では E2E / integration が偽陰性になりうることを明記する
- release candidate では real `luigid` を使った operator smoke を 1 回行う

---

## 15. PR Rules

### PR の粒度
- PR は小さく保つ
- mode 境界をまたぐ大規模 PR を避ける
- observer と operator の差分が出る場合はテストを必須にする

### 必須確認
- docs 更新
- typecheck
- test
- mode / capability の破壊がないこと

### Definition of Done
- MVP 完了条件は `docs/10-acceptance-criteria.md` の Common / Observer / Operator を満たすこと
- `managed` は拡張余地の確認対象であり、MVP 完了条件は operator の受け入れを満たした上で managed への余地を壊していないこととする
