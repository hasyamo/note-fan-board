#!/usr/bin/env python3
"""
READER MAP — 読者関係グラフデータ生成
usage: python3 scripts/build_relation_graph.py [urlname]
       urlname省略時は hasyamo

出力: data/{urlname}/relation_graph.json
      → relation_graph.html から読み込む

【読者タイプ優先順位】
  core      > commenter > regular > newcomer > dormant > active
"""
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ===== 設定 =====
BASE     = Path(__file__).parent.parent
URLNAME  = sys.argv[1] if len(sys.argv) > 1 else "hasyamo"
DATA_DIR = BASE / "data" / URLNAME
OUTPUT   = DATA_DIR / "relation_graph.json"

TODAY = datetime.now(timezone(timedelta(hours=9))).date()

# 表示閾値（ジュリ仕様）
SCORE_DEFAULT   = 5   # 通常表示
SCORE_CORE      = 10  # core判定
SCORE_PERIPHERAL = 3  # 薄表示（peripheral）

# コメント常連判定
COMMENTER_ARTICLES_LAST30 = 3   # 直近30日で3記事以上にコメント

# ===== CSV読み込み =====
def load_csv(path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))

likes    = load_csv(DATA_DIR / "likes.csv")
comments = load_csv(DATA_DIR / "comments.csv")

print(f"likes: {len(likes)}件, comments: {len(comments)}件")

# ===== 日付パース =====
def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(
            timezone(timedelta(hours=9))
        ).date()
    except Exception:
        return None

# ===== ユーザ別集計 =====
# likes.csv: note_key, like_user_id, like_username, like_user_urlname, liked_at, follower_count
user_likes      = defaultdict(list)   # urlname -> [date]
user_name       = {}                  # urlname -> display name
user_follower   = {}                  # urlname -> follower_count
user_icon       = {}                  # urlname -> icon url

# user_icons.csv があれば先に読み込む（collect.py が生成、全クリエイター共通）
user_icons_csv = BASE / "data" / "user_icons.csv"
if user_icons_csv.exists():
    with open(user_icons_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            u = row.get("urlname", "").strip()
            icon = row.get("user_icon_url", "").strip()
            if u and icon:
                user_icon[u] = icon

for row in likes:
    u = row.get("like_user_urlname", "").strip()
    if not u:
        continue
    d = parse_dt(row.get("liked_at", ""))
    if d:
        user_likes[u].append(d)
    if u not in user_name:
        user_name[u] = row.get("like_username", u)
    icon = row.get("user_icon", "").strip()
    if icon and u not in user_icon:
        user_icon[u] = icon
    try:
        fc = int(row.get("follower_count") or 0)
        user_follower[u] = max(user_follower.get(u, 0), fc)
    except Exception:
        pass

# comments.csv: comment_id, note_key, user_key, user_name, user_urlname, user_icon, commented_at, body
user_comments       = defaultdict(list)          # urlname -> [date]
user_comment_notes  = defaultdict(set)           # urlname -> {note_key}  (コメントした記事)
user_comment_weeks  = defaultdict(set)           # urlname -> {iso_week}  (コメントした週)

for row in comments:
    u = row.get("user_urlname", "").strip()
    if not u:
        continue
    d = parse_dt(row.get("commented_at", ""))
    if d:
        user_comments[u].append(d)
        user_comment_notes[u].add(row.get("note_key", ""))
        user_comment_weeks[u].add(d.isocalendar()[:2])  # (year, week)
    if u not in user_name:
        user_name[u] = row.get("user_name", u)
    icon = row.get("user_icon", "").strip()
    if icon:
        user_icon[u] = icon

# ===== 全ユーザ =====
all_users = set(user_likes.keys()) | set(user_comments.keys())
print(f"ユニーク読者: {len(all_users)}人")

# ===== ノード生成 =====
nodes = []

for u in all_users:
    likes_dates    = sorted(user_likes.get(u, []))
    comments_dates = sorted(user_comments.get(u, []))
    all_dates      = sorted(likes_dates + comments_dates)
    if not all_dates:
        continue

    like_count    = len(likes_dates)
    comment_count = len(comments_dates)
    score         = like_count + comment_count * 5

    # 表示閾値（peripheral以下は除外、必要なら show_peripheral フラグで制御）
    if score < SCORE_PERIPHERAL:
        continue

    first_activity = all_dates[0]
    last_activity  = all_dates[-1]
    months_since   = (TODAY.year - first_activity.year) * 12 + (TODAY.month - first_activity.month)

    # 直近30日アクティブ
    cutoff_30 = TODAY - timedelta(days=30)
    recent_active = any(d >= cutoff_30 for d in all_dates)

    # 直近30日のコメント記事数・週数（コメント常連判定用）
    cutoff_30_comments = [d for d in comments_dates if d >= cutoff_30]
    cutoff_30_notes    = set()
    cutoff_8w          = TODAY - timedelta(weeks=8)
    cutoff_8w_weeks    = set()

    for row in comments:
        if row.get("user_urlname", "").strip() != u:
            continue
        d = parse_dt(row.get("commented_at", ""))
        if not d:
            continue
        if d >= cutoff_30:
            cutoff_30_notes.add(row.get("note_key", ""))
        if d >= cutoff_8w:
            cutoff_8w_weeks.add(d.isocalendar()[:2])

    comment_articles_last30 = len(cutoff_30_notes)
    comment_weeks_last8w    = len(cutoff_8w_weeks)

    # 月別集計
    monthly = defaultdict(lambda: {"likes": 0, "comments": 0})
    for d in likes_dates:
        monthly[f"{d.year}-{d.month:02d}"]["likes"] += 1
    for d in comments_dates:
        monthly[f"{d.year}-{d.month:02d}"]["comments"] += 1

    # ===== 属性判定 =====
    is_newcomer = months_since <= 1

    # dormant: score >= 10 かつ直近30日反応なし
    is_dormant = (score >= SCORE_CORE) and not recent_active

    # コメント常連: 直近30日で3記事以上 or 直近8週で4週以上
    is_comment_regular = (comment_articles_last30 >= COMMENTER_ARTICLES_LAST30) or (comment_weeks_last8w >= 4)

    is_core = score >= SCORE_CORE

    # ===== tags（非排他、レイヤー表示・カウント用） =====
    tags = []
    if is_core:                tags.append("core")
    if is_comment_regular:     tags.append("commenter")
    if comment_count >= 1:     tags.append("active_commenter")
    if like_count >= 5:        tags.append("regular")
    if is_newcomer:            tags.append("newcomer")
    if is_dormant:             tags.append("dormant")

    # ===== utype（排他、代表分類・色・主ラベル用） =====
    # 優先順位: dormant > core > commenter > active_commenter > regular > newcomer
    if is_dormant:
        utype = "dormant"
    elif is_core:
        utype = "core"
    elif is_comment_regular:
        utype = "commenter"
    elif comment_count >= 1:
        utype = "active_commenter"
    elif like_count >= 5:
        utype = "regular"
    elif is_newcomer:
        utype = "newcomer"
    else:
        # 軽いスキのみ（active相当）。代表分類は便宜上 newcomer/regular に寄せず、
        # tags が空なら全期間レイヤーには出ないが score>=3 なので peripheral 扱い。
        utype = "regular"

    nodes.append({
        "urlname":               u,
        "name":                  user_name.get(u, u),
        "icon":                  user_icon.get(u),
        "follower_count":        user_follower.get(u, 0),
        "like_count":            like_count,
        "comment_count":         comment_count,
        "comment_articles_last30": comment_articles_last30,
        "comment_weeks_last8w":  comment_weeks_last8w,
        "score":                 score,
        "utype":                 utype,
        "tags":                  tags,
        "months_since_first":    months_since,
        "first_activity":        str(first_activity),
        "last_activity":         str(last_activity),
        "recent_active":         recent_active,
        "monthly":               dict(monthly),
        "peripheral":            score < SCORE_DEFAULT,   # スキ5未満・コメントなし
    })

nodes.sort(key=lambda n: -n["score"])
print(f"ノード数（peripheral含む）: {len(nodes)}")

# ===== 月リスト =====
all_months = set()
for n in nodes:
    all_months.update(n["monthly"].keys())
months = sorted(all_months)

# ===== 統計 =====
stats = {
    "total_readers":      len(nodes),
    "core_users":         sum(1 for n in nodes if n["utype"] == "core"),
    "commenter_users":    sum(1 for n in nodes if n["utype"] in ("commenter", "active_commenter")),
    "total_likes":        sum(n["like_count"] for n in nodes),
    "total_comments":     sum(n["comment_count"] for n in nodes),
    "generated_at":       str(TODAY),
    "creator_urlname":    URLNAME,
}

# ===== 出力 =====
output = {"nodes": nodes, "months": months, "stats": stats}
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

print(f"✅ 出力: {OUTPUT}")
print(f"   読者数: {stats['total_readers']} (core:{stats['core_users']}, commenter:{stats['commenter_users']})")
print(f"   総スキ: {stats['total_likes']}, 総コメント: {stats['total_comments']}")
