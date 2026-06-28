# .mio/

このディレクトリは、澪（ミオ）運用の **交換箱** です。
詳細スペック：`hasyamo-vault/40_reviews/mio_handoff_spec_v2.md`

## このプロジェクトの位置づけ

- プロジェクト名：**note-fan-board**（「観測は続く。」フロント）
- 役割：はしゃもの note 観測フロント（PWA）。AI分析パック等を提供。
- 澪運用：**Phase 1**（出口ログだけ）。対象は `ohakano-quest` と `note-fan-board` の2件。

## Phase 1 のルール

このプロジェクトの Claude Code（**実装Bot**）は、**作業終了時に `result.md` を 1 枚書く**。

- テンプレ：`hasyamo-vault/90_templates/mio_result_template.md`
- 作業中の質問はチャット上で扱う（`questions.md` は Phase 1 では作らない）
- 作業開始時の指示書（`handoff.md`）も Phase 1 では作らない
- `tmp/` は作らない

## ファイル

| ファイル | Git | 用途 |
|---|---|---|
| `README.md`（このファイル） | 管理する | 運用説明 |
| `result.md` | 管理しない | 作業終了時の結果ログ |

`.gitignore` に以下を追加済：

```gitignore
# Mio working handoff files
.mio/result.md
```

## 回収フロー

1. 作業終了時、実装Bot が `result.md` を書く（status: open）
2. はしゃもが hasyamo-vault 側の澪に「result 回収して」と渡す
3. 澪が `result.md` を読んで `20_daily` に要約する
4. 澪が `result.md` を空にする（または `status: collected` に変える）

回収済みの内容は `.mio` ではなく `20_daily` を正とする。
`.mio` は作業中の交換箱で、長期保管場所ではない。

## やってはいけないこと

- 澪・ジュリの口調を真似ない（実装Bot は澪でも ジュリでもない）
- `result.md` を貯めない（1 件書いたら回収してもらう）
- 機密情報（API キー、`.env` 中身、個人情報）を `result.md` に書かない
