# 06. sample gokart project and fixtures

目的:
- examples 配下に検証用の最小 gokart project を追加する
- success / failure / rerun / task_log / parameter をテストできる fixture を用意する
- station repo と target repo が独立で動くことを確認する

必須要件:
- `examples/sample_gokart_project` を作る
- `main.py` を用意する
- 2〜3 task の依存関係を持たせる
- success task を用意する
- failed task を用意する
- task_log を出す task を用意する
- parameter 付き task を用意する
- rerun を試せる task を用意する
- workspace を repo 外ディレクトリへ向けられるようにする
- README を書く

受け入れ条件:
- sample project を observer / operator の両モードで使ったときの期待挙動が分かる
- sample project を使って adapter integration test が書ける
