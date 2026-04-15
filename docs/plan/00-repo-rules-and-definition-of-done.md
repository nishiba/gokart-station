# 00. repo rules and definition of done

目的:
- `gokart-station` を完成まで持っていくための repo ルールと完成条件を固定する
- observer / operator / managed の mode 境界を最初に固定する
- station repo と target gokart repo が独立である前提を明示する

必須要件:
- station は target repo と別レポジトリ / 別ディレクトリ前提
- mode は `observer | operator | managed`
- workspace-only 接続は observer とする
- observer では run / stop / rerun / profile edit / scheduler lifecycle を禁止する
- operator 以上でのみ run control を有効化する
- docs/README.md, docs/01-architecture.md, docs/10-acceptance-criteria.md, AGENTS.md を整合させる
- Definition of Done に observer / operator 両方の受け入れ条件を入れる

成果物:
- AGENTS.md 更新
- docs/README.md 更新
- docs/10-acceptance-criteria.md 更新
- mode / capability の語彙統一

受け入れ条件:
- 以後の prompt が mode 境界を前提に実装できる
- 完成条件が observer / operator で分かれている
