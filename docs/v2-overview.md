# note-fan-board（v2）仕様・運用まとめ

## 概要

noteクリエイター向けの「スキしてくれた人」を可視化するダッシュボード。
v1（note-stats-tracker）は自分専用だったが、v2は他のクリエイターにも提供できる公開版。

- **名前**: 「観測は続く。」
- **サブタイトル**: 「昨日、あなたに会いに来た人。」
- **URL**: https://hasyamo.github.io/note-fan-board/
- **リポジトリ**: https://github.com/hasyamo/note-fan-board （パブリック）
- **技術構成**: Vanilla JS + CSS（フレームワークなし）、PWA対応
- **ホスティング**: GitHub Pages

---

## タブ構成（3タブ）

| タブ | 目的 |
|------|------|
| **Today** | 今日のスキ状況。誰がスキしてくれたか、フォロワー推移 |
| **Fans** | スキしてくれた人を新規/復帰/常連/たまにに分類 |
| **Ranking** | スキランキング。タイミング係数で重み付け |

---

## 使用API（すべて認証不要）

| API | 用途 |
|-----|------|
| `/api/v2/creators/{urlname}` | フォロワー数取得 |
| `/api/v2/creators/{urlname}/contents` | 記事一覧取得（公開日時、スキ数、コメント数） |
| `/api/v3/notes/{key}/likes?page={n}&per=50` | スキした人の一覧取得 |
| CF proxy `?id={urlname}` | プロフィール画像URL取得（CORS回避） |

Cookie認証が必要なAPI（stats API、my_likes）は一切使っていない。

---

## CF proxy（Cloudflare Workers）

- **URL**: `https://falling-mouse-736b.hasyamo.workers.dev/`
- **ソース**: `ohenji-note/docs/worker-extension.js`（統合版）
- **用途**: ブラウザからnote APIを叩く際のCORS回避
- **ルート**:
  - `?id={urlname}` → `/api/v2/creators/{urlname}` を中継（プロフィール情報）
  - `?path={path}` → 許可リスト内のnote APIを中継
- **無料枠で運用**

---

## データ収集（GitHub Actions）

### スケジュール
- 毎日 2:00 JST（17:00 UTC）に自動実行
- 手動実行（workflow_dispatch）も可能

### 収集スクリプト: `scripts/collect.py`
1. `creators.csv` から対象クリエイター一覧を読み込み
2. 各クリエイターについて:
   - フォロワー数を取得 → `data/{urlname}/followers.csv` に追記
   - 記事一覧を取得 → `data/{urlname}/articles.csv` に上書き
   - スキ一覧を取得 → `data/{urlname}/likes.csv` に差分追記
3. コミット＆プッシュ

### 並列処理
- `MAX_THREADS = 3` でクリエイターをラウンドロビン分配
- 4人以上の場合にスレッド並列実行（I/O待ちの間に他クリエイターを処理）
- 3人以下は直列実行

### 初回取得
- likes.csvが存在しない場合、全記事のスキを全件取得（baseline mode）
- 記事数が多いクリエイターは初回のみ時間がかかる（例: 597記事 → 約15分）
- 2回目以降はスキ数が増えた記事のみ差分取得

### ページネーション
- likes APIは `page/per` パラメータを使用
- `start/size` パラメータは2ページ目以降で重複データを返すバグがあるため不使用

---

## クリエイター管理

### creators.csv
```
urlname
hasyamo
crisp_chimp0823
relax_r
maynoha
nenkoro_life
```

- 行頭 `#` でコメントアウト（一時無効化）
- 収集スクリプト、フロントエンドの両方で `#` 行を無視

### ユーザー認証（フロントエンド）
- 優先順位: URLクエリ(`?user=`) → URLパス(`/note-fan-board/{urlname}/`) → localStorage → モーダル入力
- `creators.csv` に登録されていないIDはエラー（ホワイトリスト方式）
- localStorageに保存して次回以降は自動ログイン
- PWAインストール時の`start_url`にユーザーIDを埋め込み

---

## ユーザー分類

| 分類 | 条件 |
|------|------|
| 新規 | 今週が初めてスキしてくれた週 |
| 常連 | 直近4週のうち3週以上スキしてくれている |
| 復帰 | 過去にスキしたことがあるが、直近4週は一度もなかった |
| たまに | 過去にスキしたことがあり、直近4週のうち1〜2週だけ |

---

## スキランキング

### タイミング係数
記事の公開からスキまでの経過時間で重み付け:

| 経過時間 | 倍率 |
|----------|------|
| 1時間以内 | 3倍 |
| 1〜6時間 | 2倍 |
| 6〜24時間 | 1.5倍 |
| 24時間以降 | 1倍 |

- スコアは×2して整数表示
- 同ポイントは同順位（タイブレーカーなし）
- 5:00 JST を日の境界（深夜スキは前日扱い）

### 期間切り替え
今週 / 先週 / 今月 / 先月

### キャラクター
- 陽（朝の報告）、凛華（関係維持 / 辛口）、るな（感謝 / 盛り上げ）の3キャラがナビ
- キャラ画像はv1のGitHub Pagesから参照

---

## データ構造

```
data/
  creators.csv          # 対象クリエイター一覧
  {urlname}/
    articles.csv         # 記事一覧（日次上書き）
    articles_prev.csv    # 前回の記事データ（差分検知用）
    likes.csv            # スキ一覧（差分追記）
    followers.csv        # フォロワー数（日次追記）
```

---

## v1との違い

| | v1（note-stats-tracker） | v2（note-fan-board） |
|---|---|---|
| 対象 | 自分専用 | 複数クリエイター |
| 認証 | Cookie必要（stats API使用） | 認証不要 |
| PV | 取得可能 | 取得不可 |
| η（スキ率） | 計算可能 | 計算不可（PVがないため） |
| 自分のスキ活動 | my_likes.csvで追跡 | なし（将来はlocalStorageで自己申告） |
| タブ数 | 5（Daily/Activity/Weekly/Deep Dive/Ranking） | 3（Today/Fans/Ranking） |
| データ蓄積 | GitHub Actions 4回/日 | GitHub Actions 1回/日 |
| キャラ | 7人 | 3人 |

---

## 運用方針

- **招待制**: 自分が認めたクリエイターのみcreators.csvに追加
- **将来案**: 毎週のスキランキング1位を招待（年間ユニーク20〜30人想定）
- **GitHub Actions**: パブリックリポジトリのため無制限。ただし実行時間は人数に比例
- **スレッド並列**: 3スレッドで収集。4人で約17分の実績
