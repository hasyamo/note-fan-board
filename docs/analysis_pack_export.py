#!/usr/bin/env python3
"""
AI分析パック（note分析データ出力）MVP — ロジック正本（JS移植の参照）

note の公開データ（PVなし）から、AIに貼るための分析Markdownを生成。実装(observ＝note-fan-board)は
このロジックを正本としてJS移植し、出力の主要数値が一致することを検算する。

出力（MVP・人が見る見出しは平易・記事番号に依存しない汎用）：
  ① 記事マスター（補正スキ率/24h初速/新規・常連/深さ。タイトルはフル＋公開日で区別）
  ② いつ出会った読者が今も来てくれているか（初反応月→直近30日再反応＝定着）
  ③ 直近30日では反応がない過去常連
  + 分析プロンプト同梱

母数補正＝スキ÷公開当時フォロワー数（followers.csv履歴）。履歴外はN/A。
※ 月次デルタ・自動答え合わせは将来拡張（MVPに入れない）。

使い方：
  python3 analysis_pack_export.py <urlname> [--month 2026-06]
"""
import csv, sys, os, json, statistics, datetime as DT, time, urllib.request, urllib.error
from collections import defaultdict


def fetch_paid_map(note_keys):
    """直近30日の対象記事だけ price を取得（直列・0.6s sleep）。
    成功＝int(price)、失敗＝None（出力側で '?' マーカーに落とす）。"""
    result = {}
    for k in note_keys:
        price = None
        try:
            req = urllib.request.Request(
                f"https://note.com/api/v3/notes/{k}",
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode("utf-8"))
                p = data.get("data", {}).get("price")
                if isinstance(p, (int, float)):
                    price = int(p)
        except Exception as e:
            sys.stderr.write(f"[aiPack] price fetch failed: {k} ({e})\n")
        result[k] = price
        time.sleep(0.6)
    return result

def ti(x):
    try: return int(x)
    except: return 0
def d10(s): return s[:10]
def parse(dt):
    try: return DT.datetime.fromisoformat(dt.replace('Z','+00:00'))
    except: return None

def main():
    urlname = sys.argv[1] if len(sys.argv) > 1 else "hasyamo"
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", urlname)  # docs の親（リポルート）の data/

    arts = {r['key']: r for r in csv.DictReader(open(f"{base}/articles.csv", encoding='utf-8'))}
    likes = list(csv.DictReader(open(f"{base}/likes.csv", encoding='utf-8')))
    followers = sorted((r['date'], ti(r['follower_count']))
                       for r in csv.DictReader(open(f"{base}/followers.csv", encoding='utf-8')))
    magp = f"{base}/magazine_events.csv"
    mag = list(csv.DictReader(open(magp, encoding='utf-8'))) if os.path.exists(magp) else []

    # 対象月（指定 or 最新データのある前月）
    data_latest = max(d10(l['liked_at']) for l in likes)
    if "--month" in sys.argv:
        month = sys.argv[sys.argv.index("--month")+1]
    else:
        # データ最新日の「その月」を対象にする
        month = data_latest[:7]
    y, m = map(int, month.split("-"))
    prev_month = f"{y-1}-12" if m == 1 else f"{y}-{m-1:02d}"

    def fol_at(date):
        v = None
        for dt, fc in followers:
            if dt <= date: v = fc
            else: break
        return v

    first_seen, last_seen, name_of, cnt = {}, {}, {}, defaultdict(int)
    for l in sorted(likes, key=lambda x: x['liked_at']):
        u = l['like_user_id']
        if not u: continue
        first_seen.setdefault(u, d10(l['liked_at']))
        last_seen[u] = d10(l['liked_at']); name_of[u] = l['like_username']; cnt[u] += 1

    likes_by_art = defaultdict(list)
    for l in likes: likes_by_art[l['note_key']].append(l)
    mag_by_art = defaultdict(int)
    for mm in mag: mag_by_art[mm['note_key']] += 1

    def month_rows(mo):
        rows = []
        for k, a in arts.items():
            if d10(a['published_at'])[:7] != mo: continue
            pub = a['published_at']; lk, cm = ti(a['like_count']), ti(a['comment_count'])
            fol = fol_at(d10(pub)); p = parse(pub); v24 = 0
            if p:
                for l in likes_by_art[k]:
                    lt = parse(l['liked_at'])
                    if lt and 0 <= (lt-p).total_seconds() <= 86400: v24 += 1
            shinki = sum(1 for l in likes_by_art[k] if first_seen.get(l['like_user_id']) == d10(l['liked_at']))
            depth = lk + cm*5 + mag_by_art.get(k,0)*10
            eta = (lk/fol*100) if fol else None
            rows.append(dict(title=a['title'], pubd=d10(pub), lk=lk, cm=cm,  # フルタイトル（切らない・記事番号に依存しない＝汎用）
                             mag=mag_by_art.get(k,0), fol=fol, eta=eta, v24=v24,
                             shinki=shinki, joren=len(likes_by_art[k])-shinki, depth=depth))
        return sorted(rows, key=lambda x: x['pubd'])

    cur = month_rows(month); prv = month_rows(prev_month)
    # 課金記事マーカー：①の表に出す記事だけ price 取得（cur の key 一覧）
    cur_keys = [k for k, a in arts.items() if d10(a['published_at'])[:7] == month]
    paid_map = fetch_paid_map(cur_keys)
    # cur の各行に key を紐付け（title と pubd で対応）
    title_pub_to_key = {(a['title'], d10(a['published_at'])): k for k, a in arts.items()}
    # 🆕判定の基準：data_latest の 23:59:59 JST と published_at の差が72h未満
    data_latest_dt = DT.datetime.fromisoformat(data_latest + 'T23:59:59+09:00')
    FRESH = DT.timedelta(hours=72)
    for r in cur:
        k = title_pub_to_key.get((r['title'], r['pubd']))
        r['_key'] = k
        p = paid_map.get(k) if k else None
        paid_mark = '?' if p is None else ('💎' if p > 0 else '')
        pub = parse(arts[k]['published_at']) if k else None
        is_fresh = pub is not None and (data_latest_dt - pub) < FRESH
        fresh_mark = '🆕' if is_fresh else ''
        combined = f"{paid_mark}{fresh_mark}"
        r['_marker'] = f"{combined} " if combined else ''
    cutd = (DT.date.fromisoformat(data_latest)-DT.timedelta(days=30)).isoformat()  # 直近30日の境界（①②③共通）
    def med(rows, key):
        vals = [r[key] for r in rows if r[key] is not None]
        return statistics.median(vals) if vals else None

    o = print
    o(f"# 📊 note分析パック（{urlname}）｜{month}・貼るだけAI分析用")
    o(f"対象月：{month}（{len(cur)}本）／前月：{prev_month}（{len(prv)}本）／全{len(arts)}本")
    o("\n> このMarkdownは、ChatGPTやClaudeなどのAIに貼ってnote運営を振り返るための分析パックです。")
    o("> このMarkdown自体をそのまま公開する前提ではなく、AIによる振り返り・分析・下書き作成のための一次情報です。")
    o("> 個人別の反応履歴を含む場合があります。AIの出力をnote記事などに転用する場合は、個人名や個別履歴が本文に出ないよう必ず編集してください。")
    o("> 補正スキ率＝スキ÷公開当時フォロワー数。母数の違いによる見え方のズレを抑えるための参考指標です。履歴外はN/A。")
    o("> 深さ＝スキ・コメント・マガジンなどから算出した、反応の濃さを見る独自指標です。\n")

    # ① 記事マスター（フルタイトル＋公開日で区別＝記事番号に依存しない汎用）
    o(f"## ① 記事マスター（{month}）")
    o("| 記事 | 公開 | スキ | コメ | マガ | 当時フォロ | 補正スキ率 | 24h初速 | 新規/常連 | 深さ |")
    o("|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(cur, key=lambda x:x['pubd'], reverse=True):
        eta = f"{r['eta']:.1f}%" if r['eta'] is not None else "N/A"
        o(f"| {r.get('_marker','')}{r['title']} | {r['pubd']} | {r['lk']} | {r['cm']} | {r['mag']} | {r['fol'] or 'N/A'} | {eta} | {r['v24']} | {r['shinki']}/{r['joren']} | {r['depth']} |")
    if cur:
        o("\n> 💎＝課金記事（有料／メンシプ限定）。コメント可能な読者が購入者・会員に限定されるため、無料記事と直接比較せず傾向で読んでください。 ／ 🆕＝公開後72時間未満。数字が育ち切っていない＝伸び続ける可能性があり、固まった数字として扱わないでください。 ／ ?＝判定取得に失敗。")

    # ② いつ出会った読者が、今も来てくれているか（定着）
    recent_actors = {l['like_user_id'] for l in likes if d10(l['liked_at']) >= cutd}
    cohort = defaultdict(lambda: [0,0])
    for u, fm in first_seen.items():
        mm0 = fm[:7]; cohort[mm0][0] += 1
        if u in recent_actors: cohort[mm0][1] += 1
    this_month = data_latest[:7]
    o(f"\n## ② いつ出会った読者が、今も来てくれているか（初反応した月 → 直近30日の再反応＝定着）")
    o(f"> ※{this_month} は直近30日内の初反応者を含むため定着率が高く出ます（参考値）。過去月との単純比較ではなく「今月出会った読者層」として扱ってください。")
    o("| 初反応した月 | 人数 | 直近30日の再反応 | 定着率 |\n|---|---|---|---|")
    for mm0 in sorted(cohort):
        n, ret = cohort[mm0]
        o(f"| {mm0} | {n} | {ret} | {ret/n*100:.0f}% |")

    # ③ 直近30日では反応がない過去常連
    #   閾値は規模依存を避け緩めに（小規模クリエイターでも該当が出るよう通算2回以上）。上位15件。
    churn = sorted([(name_of[u],cnt[u],last_seen[u]) for u in cnt if cnt[u]>=2 and last_seen[u]<cutd], key=lambda x:-x[1])
    o(f"\n## ③ 直近30日では反応がない過去常連（通算2回以上スキ・直近30日無反応）")
    o("> この表は本文にそのまま出すためのものではありません。分析では「過去によく反応してくれていた読者層」「最近反応が途切れている層」として、集計・傾向で扱ってください（個人名・回数・日付は本文に出さない）。")
    if churn:
        o("| 名前 | 通算スキ | 最終反応 |\n|---|---|---|")
        for nm,c,ls in churn[:15]: o(f"| {nm} | {c} | {ls} |")
    else: o("（該当なし）")

    # プロンプト（MVP：①②③に対応・答え合わせ等は将来拡張なので入れない）
    o("\n---\n## 🤖 分析プロンプト（このまま続けてAIに頼める）")
    o("""
1. **振り返り**：「①の記事マスターを見て、補正スキ率・深さ・24h初速・新規/常連比から、今月の"刺さった型"と"空振りの型"をテーマ・文体で各3つ。順位や優劣の断定はせず傾向で。」
2. **次の一手（主軸）**：「②の定着と③の過去常連の傾向から、来月書くと良いテーマ・切り口を3つ。新規を連れてくる型と常連が喜ぶ型を分けて。」
3. **振り返りnoteの下書き**：「この分析を読者に見せられる振り返りnoteの下書きに。数字は一次情報として明示し（補正スキ率・深さ・24h初速・新規/常連比など）、数字の羅列でなく"数字から何が見えたか"まで書く。個人名・個別読者の通算スキ数・最終反応日は本文に出さない（必要なら『過去によく反応してくれていた読者層』など集計・傾向で）。推測は推測として書く。」
4. **注意**：「②の今月の定着率は期間内初反応者を含むため参考値として扱う。③の個人別データは本文に出さず、読者層の傾向分析にのみ使う。」
""")

if __name__ == "__main__":
    main()
