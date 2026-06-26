# ジュリの仕様メモ — 読者関係グラフ

## 基本スコア

```
relation_score = like_count + comment_count * 5
monthly_score  = monthly_likes + monthly_comments * 5
```

コメント1件 = スキ5件相当。同列にするな。

---

## 読者タイプ（utype）

| type      | 条件                                    | 表示           |
| --------- | ------------------------------------- | ------------ |
| core      | relation_score >= 10                  | 濃く・大きめ       |
| commenter | comment_count >= 1                    | コメント系として強調   |
| regular   | 直近4週で3週以上スキ                           | 安定反応         |
| newcomer  | 初反応から1ヶ月以内                            | 新規           |
| dormant   | total_score >= 10 かつ直近月反応なし           | 薄く           |
| one_shot  | total_score < 3                       | 非表示          |

※ 優先順位: core > commenter > regular > newcomer > dormant > active

---

## 表示閾値

```
default:       relation_score >= 5
core:          relation_score >= 10
peripheral:    3 <= relation_score < 5
one_shot:      relation_score < 3  → 非表示
```

月フィルター時：
```
monthly_score >= 3
or monthly_comments >= 1
or (relation_score >= 10 and monthly_likes >= 1)
```

オプション「一度でも反応した人も表示」：
```
monthly_likes >= 1 or monthly_comments >= 1
```

---

## 3D空間マッピング

| 表現       | 指標                         |
| -------- | -------------------------- |
| 中心       | はしゃも                       |
| 距離       | relation_score が高いほど中心に近い   |
| 高さ       | 初反応からの経過月数（古参ほど高い）         |
| ノードサイズ   | 1 + log(comment_count + 1) |
| ノード透明度   | 直近30日反応あり=1.0、なし=0.35      |
| ノードアイコン  | プロフィール画像                   |

---

## レイヤー設計

| レイヤー       | 条件                    | デフォルト |
| ---------- | --------------------- | ----- |
| Core       | score >= 10           | ON    |
| Commenter  | comment_count >= 1    | ON    |
| Regular    | 定期読者                  | ON    |
| Newcomer   | 初反応1ヶ月以内              | ON    |
| Peripheral | 3 <= score < 5        | OFF   |
| Dormant    | 古参・休眠                 | OFF   |

---

## 将来のモード拡張（MVPはモード1のみ）

- モード1：関係の濃さ（現在実装）
- モード2：今月の熱量（monthly_score基準）
- モード3：常連発見（継続月数基準）
