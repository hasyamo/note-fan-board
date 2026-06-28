// ===== note fan board =====

// ===== Data =====
let articlesData = [];
let likesData = [];
let followersData = [];
let commentsData = [];
let magazineEvents = [];
let magazineDetails = {};
let magazinesLoaded = false;
let lastUpdated = '--';
let creatorUrlname = '';
let linesData = {};

async function loadLines() {
  if (Object.keys(linesData).length > 0) return;
  try {
    const res = await fetch('./data/lines.json?t=' + Date.now());
    if (res.ok) linesData = await res.json();
  } catch(e) { console.error('lines.json load error:', e); }
}

function pickLine(character, patternKey, vars) {
  const char = linesData[character] || {};
  let template = char[patternKey];
  if (!template) return '';
  // 配列（複数バリエーション）の場合はランダム選出
  if (Array.isArray(template)) {
    template = template[Math.floor(Math.random() * template.length)];
  }
  return template.replace(/\$\{(\w+)\}/g, (_, key) => (vars && vars[key] !== undefined ? vars[key] : ''));
}

// ===== Date Utils =====
const DAYS_JA = ['日','月','火','水','木','金','土'];

function parseDate(s) { const [y,m,d] = s.split('-'); return new Date(y, m-1, d); }
function formatDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function getMondayOf(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function getDayLabel(dateStr) {
  const d = parseDate(dateStr);
  return dateStr + '（' + DAYS_JA[d.getDay()] + '）';
}

function getTodayJST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utc + 9 * 3600000);
  // 5:00 JST boundary: before 5am counts as previous day
  if (jst.getHours() < 5) {
    jst.setDate(jst.getDate() - 1);
  }
  return formatDate(jst);
}

// Ranking date: 5:00 JST boundary
function getRankingDate(likedAt) {
  if (!likedAt) return '';
  const d = new Date(likedAt);
  const jstHours = (d.getUTCHours() + 9) % 24;
  const dateStr = likedAt.slice(0, 10);
  if (jstHours < 5) {
    const prev = new Date(parseDate(dateStr));
    prev.setDate(prev.getDate() - 1);
    return formatDate(prev);
  }
  return dateStr;
}

// ===== Character =====
const CHAR_FILES = { you: 'tue', rinka: 'thu', runa: 'fri', hiyori: 'sun' };
const CHAR_NAMES = { you: '陽（朝の報告）', rinka: '凛華（関係維持 / 辛口）', runa: 'るな（感謝 / 盛り上げ）', hiyori: '日和（マガジン追加）' };

function charImgSrc(charKey) {
  // Use ohayo-kanojo character images hosted on v1
  return `https://hasyamo.github.io/note-stats-tracker/images/eyes-thumb/eyes-${CHAR_FILES[charKey]}.webp`;
}

function naviHTML(charKey, line) {
  return `<div class="navi">
    <img class="navi-img" src="${charImgSrc(charKey)}" alt="${CHAR_NAMES[charKey]}">
    <div class="navi-body">
      <div class="navi-name">${CHAR_NAMES[charKey]}</div>
      <div class="navi-line">${line}</div>
    </div>
  </div>`;
}

// ===== User Classification =====
function buildUserWeeks() {
  const userWeeks = {};
  likesData.forEach(l => {
    const uid = l.like_user_id;
    const d = (l.liked_at || '').slice(0, 10);
    if (!d) return;
    const likeWeek = getMondayOf(d);
    if (!userWeeks[uid]) userWeeks[uid] = new Set();
    userWeeks[uid].add(likeWeek);
  });
  return userWeeks;
}

function classifyUser(uid, periodStart, userWeeks) {
  const weeks = userWeeks[uid] || new Set();
  const prevWeeks = [];
  let w = parseDate(getMondayOf(periodStart));
  for (let i = 0; i < 4; i++) { w.setDate(w.getDate() - 7); prevWeeks.push(formatDate(w)); }
  const periodWeekStart = getMondayOf(periodStart);
  const hasBeforePeriod = [...weeks].some(w => w < periodWeekStart);
  const recentActiveWeeks = prevWeeks.filter(pw => weeks.has(pw)).length;
  if (!hasBeforePeriod) return 'new';
  if (recentActiveWeeks >= 3) return 'regular';
  if (recentActiveWeeks === 0) return 'return';
  return 'occasional';
}

// ===== Period Range =====
function getPeriodRange(period) {
  const today = getTodayJST();
  if (period === 'week') {
    const mon = getMondayOf(today);
    const sun = new Date(parseDate(mon)); sun.setDate(sun.getDate() + 6);
    return { start: mon, end: formatDate(sun) };
  }
  if (period === 'lastweek') {
    const mon = parseDate(getMondayOf(today));
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { start: formatDate(mon), end: formatDate(sun) };
  }
  if (period === 'month') {
    const start = today.slice(0, 7) + '-01';
    return { start, end: today };
  }
  if (period === 'lastmonth') {
    const d = parseDate(today);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const start = formatDate(d).slice(0, 7) + '-01';
    const endD = parseDate(today.slice(0, 7) + '-01');
    endD.setDate(endD.getDate() - 1);
    return { start, end: formatDate(endD) };
  }
  return { start: '', end: today };
}

// ===== Sort Settings =====
// タブごとのソート設定（古い順/新しい順 + コメ優先 ON/OFF）
// localStorageキー: sortSetting:{urlname}:{tabId}
function getSortSetting(tabId) {
  if (!creatorUrlname || !tabId) return { direction: 'oldest', commentPriority: false };
  try {
    const raw = localStorage.getItem(`sortSetting:${creatorUrlname}:${tabId}`);
    if (!raw) return { direction: 'oldest', commentPriority: false };
    const v = JSON.parse(raw);
    return {
      direction: v.direction === 'newest' ? 'newest' : 'oldest',
      commentPriority: !!v.commentPriority,
    };
  } catch (e) {
    return { direction: 'oldest', commentPriority: false };
  }
}
function saveSortSetting(tabId, setting) {
  if (!creatorUrlname || !tabId) return;
  try {
    localStorage.setItem(`sortSetting:${creatorUrlname}:${tabId}`, JSON.stringify(setting));
  } catch (e) {}
}
// ソートUI生成（ID prefixでイベント識別）
function sortToggleHTML(tabId, setting) {
  return `<div class="sort-toggle" data-sort-tab="${tabId}">
    <span class="sort-label">並び:</span>
    <button class="sort-pill${setting.direction === 'oldest' ? ' active' : ''}" data-action="direction" data-value="oldest">古い順</button>
    <button class="sort-pill${setting.direction === 'newest' ? ' active' : ''}" data-action="direction" data-value="newest">新しい順</button>
    <button class="sort-pill sort-comment${setting.commentPriority ? ' active' : ''}" data-action="comment">コメ優先</button>
  </div>`;
}
// ソート設定の比較ロジック
function applySortSetting(arr, getTime, setting) {
  // コメ優先 → そうじゃない、各グループ内で時刻順
  const sorted = arr.slice().sort((a, b) => {
    if (setting.commentPriority) {
      const aHas = (a.commentCount || 0) > 0 ? 1 : 0;
      const bHas = (b.commentCount || 0) > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas; // コメ持ちが上
    }
    const at = getTime(a) || '';
    const bt = getTime(b) || '';
    if (setting.direction === 'newest') return bt.localeCompare(at);
    return at.localeCompare(bt);
  });
  return sorted;
}

// ===== Suki Timing Multiplier =====
function getSukiMultiplier(likedAt, noteKey) {
  const art = articlesData.find(a => a.key === noteKey);
  if (!art || !art.published_at || !likedAt) return 1;
  const pubTime = new Date(art.published_at);
  const likeTime = new Date(likedAt);
  const diffHours = (likeTime - pubTime) / (1000 * 60 * 60);
  if (diffHours < 0) return 1;
  if (diffHours <= 1) return 3;
  if (diffHours <= 6) return 2;
  if (diffHours <= 24) return 1.5;
  return 1;
}

// ===== Ranking Score =====
// 新仕様: タイミング係数 + コメント×3 + マガジン追加×2 + 継続性（複数記事スキ-1）×0.5
// ユーザー照合は urlname ベース
function buildRankingUsers(periodStart, periodEnd) {
  // periodStart/periodEnd は 'YYYY-MM-DD' 形式。getRankingDate() も同形式を返す
  const inPeriod = (dateStr) => {
    const d = getRankingDate(dateStr);
    return d >= periodStart && d <= periodEnd;
  };
  // ISO datetime 文字列を 'YYYY-MM-DD' (JST) に変換してから比較
  const toDateKey = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    // JSTでの日付キー
    const jst = new Date(d.getTime() + 9 * 3600 * 1000);
    return jst.toISOString().slice(0, 10);
  };
  const inPeriodISO = (isoStr) => {
    const k = toDateKey(isoStr);
    return k && k >= periodStart && k <= periodEnd;
  };

  const userMap = {};
  const getOrInit = (urlname, fallbackName, fallbackUid) => {
    const key = urlname || fallbackUid;
    if (!userMap[key]) {
      userMap[key] = {
        uid: fallbackUid || key,
        urlname: urlname || '',
        name: fallbackName || urlname || fallbackUid,
        count: 0,
        timing: 0,
        commentCount: 0,
        magazineAddCount: 0,
        likedNotes: new Set(),
        followerCount: 0,
      };
    }
    return userMap[key];
  };

  // Likes
  likesData.forEach(l => {
    if (!inPeriod(l.liked_at)) return;
    const u = getOrInit(l.like_user_urlname, l.like_username, l.like_user_id);
    u.count++;
    u.timing += getSukiMultiplier(l.liked_at, l.note_key);
    u.likedNotes.add(l.note_key);
    const fc = parseInt(l.follower_count) || 0;
    if (fc > u.followerCount) u.followerCount = fc;
    if (l.like_username && !u.name) u.name = l.like_username;
  });

  // Comments (urlname基準。likesにいないコメンターもエントリ作成)
  commentsData.forEach(c => {
    if (!inPeriodISO(c.commented_at)) return;
    const u = getOrInit(c.user_urlname, c.user_name, c.user_urlname);
    u.commentCount++;
  });

  // Magazine additions (magazine owner urlname基準)
  magazineEvents.forEach(e => {
    if (e.event_type !== 'added') return;
    if (!inPeriodISO(e.detected_at)) return;
    const mag = magazineDetails[e.magazine_key];
    if (!mag) return;
    const owner = mag.user?.urlname;
    if (!owner) return;
    const u = getOrInit(owner, mag.user?.nickname, owner);
    u.magazineAddCount++;
  });

  // Score計算
  Object.values(userMap).forEach(u => {
    const continuity = Math.max(0, u.likedNotes.size - 1) * 0.5;
    u.score = u.timing + u.commentCount * 3 + u.magazineAddCount * 2 + continuity;
    u.likedNotesCount = u.likedNotes.size;
    delete u.likedNotes;
  });

  return Object.values(userMap);
}

// ===== Profile Image =====
const PROXY_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/';
const profileCache = {};
async function getProfileImageUrl(urlname) {
  if (!urlname) return null;
  if (profileCache[urlname]) return profileCache[urlname];
  try {
    const resp = await fetch(`${PROXY_URL}?id=${encodeURIComponent(urlname)}`);
    if (resp.ok) {
      const data = await resp.json();
      const url = data?.data?.profileImageUrl || null;
      if (url) profileCache[urlname] = url;
      return url;
    }
  } catch(e) {}
  return null;
}

async function loadAvatars() {
  const imgs = document.querySelectorAll('.person-avatar[data-urlname]');
  for (const img of imgs) {
    const urlname = img.dataset.urlname;
    const url = await getProfileImageUrl(urlname);
    if (url) img.src = url;
  }
}

// ===== Tab Switching =====
function switchTab(tabName, opts) {
  const adjustScroll = !opts || opts.adjustScroll !== false;
  document.querySelectorAll('.tab-bar-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const tabEl = document.getElementById(tabId);
  if (tabEl) tabEl.classList.add('active');
  history.replaceState(null, '', location.pathname + location.search + '#' + tabName);
  if (adjustScroll) {
    const header = document.querySelector('.header');
    const headerH = header ? header.offsetHeight : 0;
    if (window.scrollY > headerH) {
      window.scrollTo({ top: headerH, behavior: 'instant' });
    }
  }

  if (tabName === 'today') renderToday();
  if (tabName === 'fans') renderFans();
  if (tabName === 'ranking') renderRanking();
  if (tabName === 'magazines') renderMagazines();
}

document.querySelectorAll('.tab-bar-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ===== Today Tab =====
// Today タブのサブタブ
let todaySubTab = 'overview'; // 'overview' | 'yesterday' | 'latest_reaction'

function renderToday() {
  const el = document.getElementById('todayContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">データなし</div>'; return; }

  const subToggleHtml = `
    <div class="today-sub-tabs">
      <button class="today-sub-tab${todaySubTab==='overview'?' active':''}" data-sub="overview">概況</button>
      <button class="today-sub-tab${todaySubTab==='yesterday'?' active':''}" data-sub="yesterday">スキ速報</button>
      <button class="today-sub-tab${todaySubTab==='latest_reaction'?' active':''}" data-sub="latest_reaction">最新記事への反応</button>
    </div>
  `;

  let result;
  if (todaySubTab === 'yesterday') {
    result = renderTodayYesterday();
  } else if (todaySubTab === 'latest_reaction') {
    result = renderTodayLatestReaction();
  } else {
    result = renderTodayOverview();
  }

  // 順序: キャラコメント → サブタブ → コンテンツ
  el.innerHTML = naviHTML('you', result.line) + subToggleHtml + result.body;

  // サブタブのリスナー
  document.querySelectorAll('.today-sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      todaySubTab = btn.dataset.sub;
      renderToday();
    });
  });

  loadAvatars();
  if (todaySubTab === 'overview' && followersData.length >= 2) setTimeout(drawFollowerChart, 50);

  // 「最新記事への反応」用の操作リスナー
  if (todaySubTab === 'latest_reaction') attachLatestReactionListeners();
}

// ===== Today: 概況 =====
function renderTodayOverview() {
  const today = getTodayJST();
  const yesterday = formatDate(new Date(parseDate(today).getTime() - 86400000));

  const yesterdayLikes = likesData.filter(l => getRankingDate(l.liked_at) === yesterday);
  const userMap = {};
  yesterdayLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = { name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', count: 0, followerCount: parseInt(l.follower_count) || 0 };
    }
    userMap[uid].count++;
  });
  const yesterdayUsers = Object.values(userMap).sort((a, b) => b.count - a.count);

  const userWeeks = buildUserWeeks();
  const yesterdayClassified = {};
  yesterdayUsers.forEach(u => {
    const like = yesterdayLikes.find(l => (l.like_username || l.like_user_urlname) === u.name || l.like_user_urlname === u.urlname);
    if (like) {
      yesterdayClassified[like.like_user_id] = classifyUser(like.like_user_id, yesterday, userWeeks);
    }
  });
  const returnUsers = yesterdayUsers.filter(u => {
    const like = yesterdayLikes.find(l => l.like_user_urlname === u.urlname);
    return like && yesterdayClassified[like.like_user_id] === 'return';
  });
  const newUsers = yesterdayUsers.filter(u => {
    const like = yesterdayLikes.find(l => l.like_user_urlname === u.urlname);
    return like && yesterdayClassified[like.like_user_id] === 'new';
  });
  const regularUsers = yesterdayUsers.filter(u => {
    const like = yesterdayLikes.find(l => l.like_user_urlname === u.urlname);
    return like && yesterdayClassified[like.like_user_id] === 'regular';
  });

  let youLine;
  if (returnUsers.length > 0) {
    youLine = pickLine('you', 'return_with_name', { name: returnUsers[0].name });
  } else if (newUsers.length > 0) {
    youLine = pickLine('you', 'new_with_name', { name: newUsers[0].name });
  } else if (regularUsers.length > 0) {
    youLine = pickLine('you', 'regular_with_name', { name: regularUsers[0].name });
  } else if (yesterdayUsers.length >= 5) {
    youLine = pickLine('you', 'many_visitors', { count: yesterdayUsers.length });
  } else if (yesterdayUsers.length >= 1) {
    youLine = pickLine('you', 'some_visitors', { count: yesterdayUsers.length });
  } else {
    youLine = pickLine('you', 'no_visitors');
  }

  let body = '';
  if (followersData.length > 0) {
    const latest = followersData[followersData.length - 1];
    const prev = followersData.length >= 2 ? followersData[followersData.length - 2] : latest;
    const diff = latest.follower_count - prev.follower_count;
    const sign = diff >= 0 ? '+' : '';
    const diffColor = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-pink)';
    body += `<div class="section">
      <div class="section-title">フォロワー</div>
      <div style="font-family:var(--font-mono);font-size:24px;font-weight:700">${latest.follower_count}<span style="font-size:14px;color:${diffColor};margin-left:8px">${sign}${diff}</span></div>`;

    if (followersData.length >= 2) {
      body += `<div style="display:flex;gap:16px;font-size:10px;color:var(--text-muted);margin-top:12px;margin-bottom:4px">
        <span><span style="color:var(--accent-cyan)">━</span> フォロワー</span>
        <span><span style="color:var(--accent-pink);opacity:0.5">█</span> もらったスキ数</span>
      </div>`;
      body += `<div class="chart-wrap"><canvas id="followerCanvas"></canvas></div>`;
    }
    body += `</div>`;
  }
  return { line: youLine, body };
}

// ===== Today: 昨日のスキ速報 =====
function renderTodayYesterday() {
  const today = getTodayJST();
  const yesterday = formatDate(new Date(parseDate(today).getTime() - 86400000));

  const yesterdayLikes = likesData.filter(l => getRankingDate(l.liked_at) === yesterday);
  // 昨日のコメント（urlname基準でカウント）
  const commentCountByUrlname = {};
  commentsData.forEach(c => {
    if (!c.commented_at) return;
    const d = (c.commented_at || '').slice(0, 10);
    if (d !== yesterday) return;
    const key = c.user_urlname;
    if (!key) return;
    commentCountByUrlname[key] = (commentCountByUrlname[key] || 0) + 1;
  });
  const userMap = {};
  yesterdayLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = { name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', count: 0, commentCount: 0, followerCount: parseInt(l.follower_count) || 0, latestAt: '' };
    }
    userMap[uid].count++;
    if (l.liked_at > userMap[uid].latestAt) userMap[uid].latestAt = l.liked_at;
  });
  // urlnameでコメント数をマージ
  Object.values(userMap).forEach(u => {
    if (u.urlname && commentCountByUrlname[u.urlname]) {
      u.commentCount = commentCountByUrlname[u.urlname];
    }
  });
  const sortSetting = getSortSetting('yesterday');
  const yesterdayUsers = applySortSetting(Object.values(userMap), u => u.latestAt, sortSetting);
  const totalSuki = yesterdayLikes.length;

  // セリフ（陽）: 概況と同じFans分類ベースだが、ここではスキ件数中心
  let youLine;
  if (yesterdayUsers.length === 0) {
    youLine = pickLine('you', 'no_visitors');
  } else if (yesterdayUsers.length >= 5) {
    youLine = pickLine('you', 'many_visitors', { count: yesterdayUsers.length });
  } else {
    youLine = pickLine('you', 'some_visitors', { count: yesterdayUsers.length });
  }

  let body = `<div class="section">
    <div class="section-title">昨日のスキ速報 <span style="font-weight:400;color:var(--text-muted)">${getDayLabel(yesterday)}</span></div>
    <div class="suki-total"><span class="suki-total-count">${totalSuki}</span><span class="suki-total-unit">スキ</span></div>
    ${sortToggleHTML('yesterday', sortSetting)}`;

  if (yesterdayUsers.length > 0) {
    body += yesterdayUsers.map(u => {
      const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
      const reactionText = u.commentCount > 0 ? `<span class="comment-badge">${u.commentCount}コメ</span>・${u.count}スキ` : `${u.count}スキ`;
      return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener">
        <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="person-name"><span class="person-name-text">${u.name}</span></div>
        <div class="person-stats">${reactionText}<br>${u.followerCount.toLocaleString()} followers</div>
      </a>`;
    }).join('');
  } else {
    body += `<div class="no-data">昨日のスキはありません</div>`;
  }
  body += `</div>`;
  return { line: youLine, body };
}

// ===== Today: 最新記事への反応 =====
const LATEST_REACTION_TTL_DAYS = 3;

function latestReactionStorageKey(noteKey, likerUrlname) {
  return `latestReactionCheck:${creatorUrlname}:${noteKey}:${likerUrlname}`;
}

function getLatestReactionCheck(noteKey, likerUrlname) {
  if (!likerUrlname) return null;
  try {
    const raw = localStorage.getItem(latestReactionStorageKey(noteKey, likerUrlname));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      localStorage.removeItem(latestReactionStorageKey(noteKey, likerUrlname));
      return null;
    }
    return data;
  } catch(e) { return null; }
}

function setLatestReactionCheck(noteKey, likerUrlname, status) {
  if (!likerUrlname) return;
  const now = new Date();
  const expires = new Date(now.getTime() + LATEST_REACTION_TTL_DAYS * 86400000);
  const data = { status, checkedAt: now.toISOString(), expiresAt: expires.toISOString() };
  localStorage.setItem(latestReactionStorageKey(noteKey, likerUrlname), JSON.stringify(data));
}

function clearLatestReactionCheck(noteKey, likerUrlname) {
  if (!likerUrlname) return;
  localStorage.removeItem(latestReactionStorageKey(noteKey, likerUrlname));
}

function renderTodayLatestReaction() {
  if (!articlesData || articlesData.length === 0) {
    return { line: '最新記事のデータがまだありません。', body: '<div class="no-data">最新記事への反応はまだ表示できません。</div>' };
  }
  // 最新記事
  const sorted = articlesData.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const latest = sorted[0];
  if (!latest) {
    return { line: '最新記事が見つかりません。', body: '<div class="no-data">最新記事が見つかりません。</div>' };
  }

  // 最新記事へのスキ
  const latestLikes = likesData.filter(l => l.note_key === latest.key);
  // urlname基準でユニーク化（同一人物が重複登録されてないはずだが念のため）
  const seen = new Set();
  const unique = [];
  for (const l of latestLikes) {
    const key = l.like_user_urlname || l.like_user_id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(l);
  }
  // 最新記事へのコメント数（urlname基準）
  const commentCountForLatest = {};
  commentsData.forEach(c => {
    if (c.note_key !== latest.key) return;
    const key = c.user_urlname;
    if (!key) return;
    commentCountForLatest[key] = (commentCountForLatest[key] || 0) + 1;
  });

  // Fans分類
  const userWeeks = buildUserWeeks();
  const today = getTodayJST();

  // チェック状態と分類を付与
  const enriched = unique.map(l => {
    const cat = classifyUser(l.like_user_id, today, userWeeks);
    const check = getLatestReactionCheck(latest.key, l.like_user_urlname || l.like_user_id);
    const urlname = l.like_user_urlname || '';
    return {
      uid: l.like_user_id,
      urlname,
      name: l.like_username || l.like_user_urlname || l.like_user_id,
      followerCount: parseInt(l.follower_count) || 0,
      likedAt: l.liked_at,
      category: cat,
      commentCount: urlname ? (commentCountForLatest[urlname] || 0) : 0,
      checked: !!(check && check.status === 'checked'),
    };
  });

  // ソート設定を適用
  const sortSetting = getSortSetting('latestReaction');
  const sortedEnriched = applySortSetting(enriched, u => u.likedAt, sortSetting);

  // 未チェック → チェック済み の順、各グループ内はソート設定の順序を維持
  const unchecked = sortedEnriched.filter(e => !e.checked);
  const checked = sortedEnriched.filter(e => e.checked);
  const all = [...unchecked, ...checked];

  // セリフ（陽）
  let youLine;
  if (enriched.length === 0) {
    youLine = '最新記事への反応はまだないよ。これから集まってくるね！';
  } else if (unchecked.length === 0) {
    youLine = `最新記事の${enriched.length}人、ぜんぶ会いに行ったね！すごい！`;
  } else if (unchecked.length >= 10) {
    youLine = `最新記事に${enriched.length}人来てくれたよ！${unchecked.length}人、まだ会いに行けてないから順番に行こう！`;
  } else {
    youLine = `最新記事に${enriched.length}人来てくれたよ。${unchecked.length}人、まだ会いに行けてないよ！`;
  }

  const articleUrl = `https://note.com/${creatorUrlname}/n/${latest.key}`;
  let body = `<div class="latest-reaction-desc">最新記事にスキしてくれた人を表示します。<br>相手のページを見に行って、スキ返し・コメント・マガジン追加などが済んだらチェックしてください。</div>`;
  body += `<div class="latest-reaction-meta">
    <a class="latest-reaction-article" href="${articleUrl}" target="_blank" rel="noopener">「${latest.title}」</a>
    <div class="latest-reaction-counts">${enriched.length}人がスキ｜未チェック ${unchecked.length}人</div>
  </div>`;
  body += sortToggleHTML('latestReaction', sortSetting);

  if (enriched.length === 0) {
    body += `<div class="no-data">最新記事へのスキはまだありません。</div>`;
    return { line: youLine, body };
  }

  body += '<div class="latest-reaction-list">';
  body += all.map(u => latestReactionCard(u, latest.key)).join('');
  body += '</div>';
  return { line: youLine, body };
}

function latestReactionCard(u, noteKey) {
  const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
  const labels = [];
  if (u.category === 'new') labels.push('<span class="lr-label lr-label-new">新規</span>');
  else if (u.category === 'regular') labels.push('<span class="lr-label lr-label-regular">常連</span>');
  else if (u.category === 'return') labels.push('<span class="lr-label lr-label-return">久しぶり</span>');
  const labelsHtml = labels.join('');

  const timeStr = u.likedAt ? formatLikeTime(u.likedAt) : '';

  return `<div class="lr-card${u.checked ? ' lr-checked' : ''}" data-liker="${u.urlname}" data-note="${noteKey}" data-name="${escapeAttr(u.name)}">
    <div class="lr-header">
      <a href="${profileUrl}" target="_blank" rel="noopener" class="lr-avatar-link">
        <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect fill='%23333' width='40' height='40' rx='20'/%3E%3C/svg%3E" alt="">
      </a>
      <div class="lr-header-info">
        <a class="lr-name" href="${profileUrl}" target="_blank" rel="noopener">${u.name}</a>
        ${u.urlname ? `<div class="lr-urlname">@${u.urlname}${u.followerCount > 0 ? ` ・ ${u.followerCount.toLocaleString()} followers` : ''}</div>` : ''}
      </div>
      ${u.checked ? '<span class="lr-checked-mark">✅ チェック済み</span>' : ''}
    </div>
    <div class="lr-meta">
      ${labelsHtml}
      ${u.commentCount > 0 ? `<span class="lr-comment-count">${u.commentCount}コメ</span>` : ''}
      ${timeStr ? `<span class="lr-time">${timeStr}</span>` : ''}
    </div>
    <div class="lr-actions">
      <a class="lr-action-btn lr-action-visit" href="${profileUrl}" target="_blank" rel="noopener" data-action="visit">この人のページへ</a>
      ${u.checked
        ? `<button class="lr-action-btn lr-action-uncheck" data-action="uncheck">チェック解除</button>`
        : `<button class="lr-action-btn lr-action-check" data-action="check">チェック済みにする</button>`
      }
    </div>
  </div>`;
}

function escapeAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatLikeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  // JSTで yyyy-MM-dd HH:mm 形式
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function attachLatestReactionListeners() {
  document.querySelectorAll('.lr-card .lr-action-check').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const card = btn.closest('.lr-card');
      const liker = card.dataset.liker;
      const noteKey = card.dataset.note;
      setLatestReactionCheck(noteKey, liker, 'checked');
      renderToday();
    });
  });
  document.querySelectorAll('.lr-card .lr-action-uncheck').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const card = btn.closest('.lr-card');
      const liker = card.dataset.liker;
      const noteKey = card.dataset.note;
      clearLatestReactionCheck(noteKey, liker);
      renderToday();
    });
  });
  // クリエイターページへ遷移する瞬間に「戻りモーダル」用にpending登録
  document.querySelectorAll('.lr-card .lr-action-visit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.lr-card');
      const liker = card.dataset.liker;
      const noteKey = card.dataset.note;
      const name = card.dataset.name || liker;
      setPendingLatestReaction(noteKey, liker, name);
    });
  });
}

// ===== Latest Reaction 戻りモーダル =====
const STORAGE_KEY_LR_PENDING = 'fanboard_pending_latest_reaction';

function setPendingLatestReaction(noteKey, urlname, name) {
  sessionStorage.setItem(STORAGE_KEY_LR_PENDING, JSON.stringify({ noteKey, urlname, name }));
}

function checkPendingLatestReaction() {
  const raw = sessionStorage.getItem(STORAGE_KEY_LR_PENDING);
  if (!raw) return;
  sessionStorage.removeItem(STORAGE_KEY_LR_PENDING);
  let data;
  try { data = JSON.parse(raw); } catch(e) { return; }
  const { noteKey, urlname, name } = data;
  const existing = getLatestReactionCheck(noteKey, urlname);
  if (existing && existing.status === 'checked') return; // すでにチェック済みなら何もしない
  showLatestReactionReturnModal(noteKey, urlname, name);
}

function showLatestReactionReturnModal(noteKey, urlname, name) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div style="max-width:400px;margin:120px auto;padding:24px;background:var(--section-bg);border-radius:16px;border:1px solid var(--border);text-align:center">
      <img src="${charImgSrc('you')}" alt="陽" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--accent-cyan);margin-bottom:8px">
      <div style="font-size:15px;color:var(--text-primary);margin-bottom:6px">この人への対応は済みましたか？</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:16px">${name}さん</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button onclick="event.preventDefault();handleLatestReactionAnswer('${noteKey}','${urlname}',true,this)" style="padding:10px 24px;background:var(--accent-pink);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">チェック済み</button>
        <button onclick="event.preventDefault();handleLatestReactionAnswer('${noteKey}','${urlname}',false,this)" style="padding:10px 24px;background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border);border-radius:8px;font-size:14px;cursor:pointer">まだ</button>
      </div>
    </div>`;
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
  modal.querySelector('button').focus();
}

function handleLatestReactionAnswer(noteKey, urlname, checked, btn) {
  if (checked) setLatestReactionCheck(noteKey, urlname, 'checked');
  btn.closest('.modal-overlay').remove();
  // Today タブが開いていてサブタブが latest_reaction なら再描画
  const todayTab = document.getElementById('tabToday');
  if (todayTab && todayTab.classList.contains('active') && todaySubTab === 'latest_reaction') {
    renderToday();
  }
}

function drawFollowerChart() {
  const canvas = document.getElementById('followerCanvas');
  if (!canvas) return;
  // Deduplicate: keep last record per day
  const byDate = {};
  followersData.forEach(d => { byDate[d.date] = d.follower_count; });
  const data = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).slice(-28).map(([date, follower_count]) => ({ date, follower_count }));
  const labels = data.map(d => {
    const dt = parseDate(d.date);
    return `${dt.getMonth()+1}/${dt.getDate()}\n${DAYS_JA[dt.getDay()]}`;
  });
  const values = data.map(d => d.follower_count);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Build daily suki counts
  const sukiByDate = {};
  likesData.forEach(l => {
    const d = (l.liked_at || '').slice(0, 10);
    if (d) sukiByDate[d] = (sukiByDate[d] || 0) + 1;
  });
  const sukiValues = data.map(d => sukiByDate[d.date] || 0);
  const sukiMax = Math.max(...sukiValues, 1);

  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth;
  const H = 160;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(2, 2);

  const pad = { t: 10, b: 35, l: 36, r: 32 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  // Left axis grid (followers)
  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - range * i / 4), pad.l - 4, y + 4);
  }

  // Right axis labels (suki count)
  ctx.fillStyle = '#fd79a8'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.fillText(Math.round(sukiMax * (1 - i / 4)), W - pad.r + 4, y + 4);
  }

  // X labels
  ctx.fillStyle = '#666'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 5));
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) {
      const [datePart, dayPart] = l.split('\n');
      const x = pad.l + cw * i / (labels.length - 1);
      ctx.fillText(datePart, x, H - 14);
      ctx.fillText(dayPart, x, H - 4);
    }
  });

  // Suki bars
  const barW = Math.max(2, cw / labels.length * 0.5);
  sukiValues.forEach((v, i) => {
    if (v === 0) return;
    const x = pad.l + cw * i / (labels.length - 1);
    const barH = (v / sukiMax) * ch;
    ctx.fillStyle = 'rgba(253,121,168,0.25)';
    ctx.fillRect(x - barW / 2, pad.t + ch - barH, barW, barH);
  });

  // Follower line fill
  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.lineTo(pad.l + cw, pad.t + ch); ctx.lineTo(pad.l, pad.t + ch); ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, 'rgba(0,212,255,0.25)'); grad.addColorStop(1, 'rgba(0,212,255,0.02)');
  ctx.fillStyle = grad; ctx.fill();

  // Follower line
  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

  // End dot
  const lx = pad.l + cw;
  const ly = pad.t + ch * (1 - (values[values.length - 1] - min) / range);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = '#00d4ff'; ctx.fill();
}

// ===== Fans Tab =====
function renderFans() {
  const el = document.getElementById('fansContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">データなし</div>'; return; }

  const range = getPeriodRange('week');
  const userWeeks = buildUserWeeks();
  const thisWeekLikes = likesData.filter(l => {
    const d = (l.liked_at || '').slice(0, 10);
    return d >= range.start && d <= range.end;
  });

  // 今週のコメント数（urlname基準）
  const thisWeekCommentCount = {};
  commentsData.forEach(c => {
    const d = (c.commented_at || '').slice(0, 10);
    if (d < range.start || d > range.end) return;
    const key = c.user_urlname;
    if (!key) return;
    thisWeekCommentCount[key] = (thisWeekCommentCount[key] || 0) + 1;
  });

  // Classify
  const classified = {};
  thisWeekLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!classified[uid]) {
      const cat = classifyUser(uid, range.start, userWeeks);
      classified[uid] = {
        name: l.like_username || l.like_user_urlname || uid,
        urlname: l.like_user_urlname || '',
        followerCount: parseInt(l.follower_count) || 0,
        count: 0, commentCount: 0, category: cat, latestAt: '',
      };
    }
    classified[uid].count++;
    if (l.liked_at > classified[uid].latestAt) classified[uid].latestAt = l.liked_at;
  });
  // urlname経由でコメント数をマージ
  Object.values(classified).forEach(u => {
    if (u.urlname && thisWeekCommentCount[u.urlname]) {
      u.commentCount = thisWeekCommentCount[u.urlname];
    }
  });

  const fansSortSetting = getSortSetting('fans');
  const all = applySortSetting(Object.values(classified), u => u.latestAt, fansSortSetting);
  const newList = all.filter(p => p.category === 'new');
  const returnList = all.filter(p => p.category === 'return');
  const regList = all.filter(p => p.category === 'regular');
  const occasionalList = all.filter(p => p.category === 'occasional');

  // At risk
  const prevWeeks = [];
  let w = parseDate(range.start);
  for (let i = 0; i < 4; i++) { w.setDate(w.getDate() - 7); prevWeeks.push(formatDate(w)); }
  const olderWeeks = [];
  let w2 = parseDate(range.start);
  for (let i = 0; i < 8; i++) { w2.setDate(w2.getDate() - 7); if (i >= 4) olderWeeks.push(formatDate(w2)); }

  const atRiskUsers = [];
  Object.entries(userWeeks).forEach(([uid, weeks]) => {
    if (classified[uid]) return;
    const recentActive = prevWeeks.filter(pw => weeks.has(pw)).length;
    const olderActive = olderWeeks.filter(ow => weeks.has(ow)).length;
    if (recentActive === 0 && olderActive >= 2) {
      const lastLike = likesData.filter(l => l.like_user_id === uid).pop();
      if (lastLike) {
        atRiskUsers.push({
          name: lastLike.like_username || lastLike.like_user_urlname || uid,
          urlname: lastLike.like_user_urlname || '',
          followerCount: parseInt(lastLike.follower_count) || 0,
          lastSeen: [...weeks].sort().pop(),
        });
      }
    }
  });
  atRiskUsers.sort((a, b) => b.followerCount - a.followerCount);

  // Pick first unreturned user from a list
  function pickUnreturned(list) {
    return list.find(u => !getSukiReturnStatus(u.urlname).liked);
  }

  // Character line (priority: return > new > at-risk > regular > fallback)
  let rinkaLine;
  const unreturnedReturn = pickUnreturned(returnList);
  const unreturnedNew = pickUnreturned(newList);
  if (unreturnedReturn && returnList.length >= 2) {
    rinkaLine = pickLine('rinka', 'return_multi', { name: unreturnedReturn.name, count: returnList.length });
  } else if (unreturnedReturn) {
    rinkaLine = pickLine('rinka', 'return_single', { name: unreturnedReturn.name });
  } else if (unreturnedNew && newList.length >= 3) {
    rinkaLine = pickLine('rinka', 'new_multi', { count: newList.length });
  } else if (unreturnedNew) {
    rinkaLine = pickLine('rinka', 'new_single', { name: unreturnedNew.name });
  } else if (atRiskUsers.length >= 3) {
    rinkaLine = pickLine('rinka', 'at_risk_multi', { name: atRiskUsers[0].name, count: atRiskUsers.length });
  } else if (atRiskUsers.length >= 1) {
    rinkaLine = pickLine('rinka', 'at_risk_single', { name: atRiskUsers[0].name });
  } else if (regList.length >= 5) {
    rinkaLine = pickLine('rinka', 'regular_many', { count: regList.length });
  } else {
    rinkaLine = pickLine('rinka', 'fallback');
  }

  let html = naviHTML('rinka', rinkaLine);

  // Tabs (5 tabs including at-risk)
  const atRiskListHTML = atRiskUsers.length > 0 ? atRiskUsers.slice(0, 15).map(u => {
    const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
    return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener">
      <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
      <div class="person-name">
        <span class="person-name-text">${u.name}</span>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">最終スキ: ${u.lastSeen}</div>
      </div>
      <div class="person-stats">${u.followerCount.toLocaleString()} followers</div>
    </a>`;
  }).join('') : '<div class="no-data">離脱危機なし</div>';

  // Store lists for "load more"
  _peopleLists = { new: newList, return: returnList, regular: regList, occasional: occasionalList };

  html += `<div class="section">
    <div class="section-title">今週のスキしてくれた人<br><span style="font-weight:400;color:var(--text-muted);font-size:0.85em">${getDayLabel(range.start)}〜${getDayLabel(range.end)}</span></div>
    ${sortToggleHTML('fans', fansSortSetting)}
    <div class="people-tabs">
      <div class="people-tab${activePeopleTab==='new'?' active':''}" onclick="switchPeopleTab(this,'new')">新規<br>(${newList.length})</div>
      <div class="people-tab${activePeopleTab==='return'?' active':''}" onclick="switchPeopleTab(this,'return')">復帰<br>(${returnList.length})</div>
      <div class="people-tab${activePeopleTab==='regular'?' active':''}" onclick="switchPeopleTab(this,'regular')">常連<br>(${regList.length})</div>
      <div class="people-tab${activePeopleTab==='occasional'?' active':''}" onclick="switchPeopleTab(this,'occasional')">たまに<br>(${occasionalList.length})</div>
      <div class="people-tab${activePeopleTab==='atrisk'?' active':''}" onclick="switchPeopleTab(this,'atrisk')" style="color:var(--accent-amber)">離脱危機<br>(${atRiskUsers.length})</div>
    </div>
    <div class="people-content${activePeopleTab==='new'?' active':''}" data-tab="new" style="${activePeopleTab==='new'?'':'display:none'}">${personListHTML(newList, '新規スキなし')}</div>
    <div class="people-content${activePeopleTab==='return'?' active':''}" data-tab="return" style="${activePeopleTab==='return'?'':'display:none'}">${personListHTML(returnList, '復帰なし')}</div>
    <div class="people-content${activePeopleTab==='regular'?' active':''}" data-tab="regular" style="${activePeopleTab==='regular'?'':'display:none'}">${personListHTML(regList, '常連なし')}</div>
    <div class="people-content${activePeopleTab==='occasional'?' active':''}" data-tab="occasional" style="${activePeopleTab==='occasional'?'':'display:none'}">${personListHTML(occasionalList, '該当なし')}</div>
    <div class="people-content${activePeopleTab==='atrisk'?' active':''}" data-tab="atrisk" style="${activePeopleTab==='atrisk'?'':'display:none'}">${atRiskListHTML}</div>
  </div>`;

  el.innerHTML = html;
  loadAvatars();
  setupPeopleObserver();
}

const PERSON_PAGE_SIZE = 50;

function personCardHTML(u) {
  const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
  const avatarClass = 'person-avatar' + (u.category === 'regular' ? ' regular' : '');
  const returnStatus = getSukiReturnStatus(u.urlname);
  const statusHTML = returnStatus.liked
    ? '<div style="color:var(--accent-green);font-size:11px">✅ スキ返し済</div>'
    : '<div style="color:var(--accent-amber);font-size:11px">❌ 未スキ返し</div>';
  const reactionText = (u.commentCount && u.commentCount > 0) ? `<span class="comment-badge">${u.commentCount}コメ</span>・${u.count}スキ` : `${u.count}スキ`;
  return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener" onclick="setPendingVisit('${u.urlname}','${u.name}')">
    <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
    <div class="person-name"><span class="person-name-text">${u.name}</span></div>
    <div class="person-stats">${reactionText}<br>${u.followerCount.toLocaleString()} followers<br>${statusHTML}</div>
  </a>`;
}

let _peopleLists = {};

function personListHTML(list, emptyMsg) {
  if (list.length === 0) return `<div class="no-data">${emptyMsg}</div>`;
  const initial = list.slice(0, PERSON_PAGE_SIZE).map(u => personCardHTML(u)).join('');
  const hasMore = list.length > PERSON_PAGE_SIZE;
  const sentinel = hasMore
    ? `<div class="people-sentinel" data-shown="${PERSON_PAGE_SIZE}"></div>`
    : (list.length > 0 ? '<div class="people-end">以上です</div>' : '');
  return initial + sentinel;
}

function appendPeopleNext(sentinel) {
  const content = sentinel.closest('.people-content');
  if (!content) return;
  const tab = content.dataset.tab;
  const list = _peopleLists[tab] || [];
  const shown = parseInt(sentinel.dataset.shown) || PERSON_PAGE_SIZE;
  const next = list.slice(shown, shown + PERSON_PAGE_SIZE);
  if (next.length === 0) {
    sentinel.outerHTML = '<div class="people-end">以上です</div>';
    return;
  }
  sentinel.insertAdjacentHTML('beforebegin', next.map(u => personCardHTML(u)).join(''));
  const newShown = shown + next.length;
  if (newShown >= list.length) {
    sentinel.outerHTML = '<div class="people-end">以上です</div>';
  } else {
    sentinel.dataset.shown = newShown;
    // 続きがあるなら observer に再アタッチして更にスクロールしたら次を出す
    if (_peopleObserver) {
      _peopleObserver.unobserve(sentinel);
      _peopleObserver.observe(sentinel);
    }
  }
  loadAvatars();
}

let _peopleObserver = null;

function setupPeopleObserver() {
  if (_peopleObserver) {
    _peopleObserver.disconnect();
  }
  _peopleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        appendPeopleNext(entry.target);
      }
    });
  }, { rootMargin: '200px' });
  // 表示中(active or display:none以外)の people-content 内のセンチネルだけ observe
  document.querySelectorAll('.people-content').forEach(content => {
    // display:none の要素内のセンチネルは観測しない（タブ切替時にもう一度 setup する）
    if (content.style.display === 'none') return;
    content.querySelectorAll('.people-sentinel').forEach(el => {
      _peopleObserver.observe(el);
    });
  });
}

function switchPeopleTab(btn, tab) {
  activePeopleTab = tab;
  btn.parentElement.querySelectorAll('.people-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const section = btn.closest('.section');
  section.querySelectorAll('.people-content').forEach(el => {
    el.style.display = el.dataset.tab === tab ? '' : 'none';
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  // 切替先タブの無限スクロール監視を再セットアップ
  setupPeopleObserver();
}

// ===== Ranking Tab =====
let rankPeriod = 'week';

function renderRanking() {
  const el = document.getElementById('rankingContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">データなし</div>'; return; }

  const range = getPeriodRange(rankPeriod);
  const users = buildRankingUsers(range.start, range.end).filter(u => u.count > 0);
  const ranked = users.sort((a, b) => b.score - a.score).slice(0, 20);

  // Classify
  const userWeeks = buildUserWeeks();
  const userCategory = {};
  ranked.forEach(u => { userCategory[u.uid] = classifyUser(u.uid, range.start, userWeeks); });

  // Character line
  const newCount = ranked.filter(u => userCategory[u.uid] === 'new').length;
  const regCount = ranked.filter(u => userCategory[u.uid] === 'regular').length;
  let runaLine;
  if (ranked.length > 0) {
    const top1Score = Math.round(ranked[0].score);
    const tiedCount = ranked.filter(u => Math.round(u.score) === top1Score).length;
    if (tiedCount >= 2) {
      runaLine = pickLine('runa', 'tied_top', { count: tiedCount });
    } else if (newCount >= 3) {
      runaLine = pickLine('runa', 'many_new', { count: newCount });
    } else if (regCount >= 10) {
      runaLine = pickLine('runa', 'many_regular', { count: regCount });
    } else {
      runaLine = pickLine('runa', 'top_name', { name: ranked[0].name });
    }
  } else {
    runaLine = pickLine('runa', 'no_data');
  }

  let html = naviHTML('runa', runaLine);

  // Period toggle
  html += `<div class="section">
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span>ファンランキング</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="toggle-btn" onclick="openScreenshot()" style="font-size:11px">スクショ用</button>
        <div class="toggle-group" id="rankPeriodToggle">
          <div class="toggle-btn${rankPeriod==='week'?' active':''}" data-period="week">今週</div>
          <div class="toggle-btn${rankPeriod==='lastweek'?' active':''}" data-period="lastweek">先週</div>
          <div class="toggle-btn${rankPeriod==='month'?' active':''}" data-period="month">今月</div>
          <div class="toggle-btn${rankPeriod==='lastmonth'?' active':''}" data-period="lastmonth">先月</div>
        </div>
      </div>
    </div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">${getDayLabel(range.start)}〜${getDayLabel(range.end)}</div>`;

  if (ranked.length === 0) {
    html += `<div class="no-data">この期間のスキデータなし</div>`;
  } else {
    html += ranked.map((u, i) => rankCard(u, i, ranked, userCategory)).join('');
  }
  html += `</div>`;

  el.innerHTML = html;

  // Period toggle listeners
  document.querySelectorAll('#rankPeriodToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      rankPeriod = btn.dataset.period;
      renderRanking();
    });
  });

  loadAvatars();
}

// 関係の深さ（💖1〜5）を TOP1 スコアとの相対比率で判定
function getDepthLevel(score, top1Score) {
  if (!top1Score || score <= 0) return 1;
  const r = score / top1Score;
  if (r >= 0.7) return 5;
  if (r >= 0.4) return 4;
  if (r >= 0.2) return 3;
  if (r >= 0.1) return 2;
  return 1;
}

function rankCard(u, i, ranked, userCategory) {
  const rank = i === 0 ? 1 : (Math.round(u.score) === Math.round(ranked[i - 1].score) ? ranked[i - 1]._rank : i + 1);
  u._rank = rank;
  const cat = userCategory[u.uid] || '';
  const avatarClass = 'person-avatar' + (cat === 'regular' ? ' regular' : '');
  const badge = cat === 'regular' ? '<span class="badge badge-regular">常連</span>'
    : cat === 'new' ? '<span class="badge badge-new">New</span>' : '';
  const top1 = ranked[0] ? ranked[0].score : 0;
  const depth = getDepthLevel(u.score, top1);
  const depthBadge = `<span class="depth-badge">💖${depth}</span>`;
  const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
  return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener">
    <div class="person-rank">${rank}</div>
    <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
    <div class="person-name"><span class="person-name-text">${u.name}</span>${badge}${depthBadge}</div>
    <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()}<br>followers</div>
    <div class="person-score">${Math.round(u.score)}<span>pt</span></div>
  </a>`;
}

// ===== Screenshot =====
function openScreenshot() {
  const range = getPeriodRange(rankPeriod);
  const users = buildRankingUsers(range.start, range.end).filter(u => u.count > 0);
  const ranked = users.sort((a, b) => b.score - a.score).slice(0, 10);

  const periodLabels = { week: '今週', lastweek: '先週', month: '今月', lastmonth: '先月' };
  const left = ranked.slice(0, 5);
  const right = ranked.slice(5, 10);

  const top1 = ranked[0] ? ranked[0].score : 0;
  const cardHTML = (u, i) => {
    const rank = i === 0 ? 1 : (Math.round(u.score) === Math.round(ranked[i - 1].score) ? ranked[i - 1]._ssRank : i + 1);
    u._ssRank = rank;
    const depth = getDepthLevel(u.score, top1);
    const avatarStyle = rank === 1 ? 'border:3px solid #d4af37;box-shadow:0 2px 8px rgba(0,0,0,0.15);' : 'border:2px solid #6c5ce7;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border-radius:12px;border:1px solid rgba(108,92,231,0.12);margin-bottom:6px">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:${rank<=1?'#d4af37':rank<=2?'#c0c0c0':rank<=3?'#cd7f32':'#ccc'};min-width:28px;text-align:center">${rank}</div>
      <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23eee' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="" style="border-radius:50%;${avatarStyle}">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#333">${u.name}さん</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:9px;color:#999">${u.count}スキ ／ <span style="color:#fd79a8">💖${depth}</span></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#fd79a8">${Math.round(u.score)}<span style="font-size:9px;color:#999">pt</span></div>
      </div>
    </div>`;
  };

  const html = `
    <div style="background:#fffbf2;color:#0a0a14;border-radius:20px;padding:28px 24px;font-family:'Noto Sans JP',sans-serif;max-width:860px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:900;color:#333"><span style="font-size:1.5em;font-weight:900;color:#6c5ce7">い</span>つも来てくれる人</div>
        <div style="font-size:12px;color:#999;margin-top:4px">${periodLabels[rankPeriod]||''} ${getDayLabel(range.start)}〜${getDayLabel(range.end)}</div>
      </div>
      <div class="screenshot-grid">
        <div>${left.map((u,i) => cardHTML(u,i)).join('')}</div>
        <div>${right.map((u,i) => cardHTML(u,i+5)).join('')}</div>
      </div>
      <div style="text-align:center;margin-top:16px;font-size:10px;color:#ccc;letter-spacing:2px">観測は続く。 / hasyamo</div>
    </div>`;

  document.getElementById('sukiScreenshotContent').innerHTML = html;
  document.getElementById('sukiScreenshotModal').style.display = '';
  loadAvatars();
}

function closeScreenshot() {
  document.getElementById('sukiScreenshotModal').style.display = 'none';
}

function openMagazineScreenshot() {
  const range = magazinePeriod === 'all' ? null : getPeriodRange(magazinePeriod);

  const allEvents = magazineEvents
    .filter(e => e.event_type === 'added' && magazineDetails[e.magazine_key])
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  const events = range
    ? allEvents.filter(e => {
        const d = e.detected_at.slice(0, 10);
        return d >= range.start && d <= range.end;
      })
    : allEvents;

  // マガジンごとにグループ化
  const groups = {};
  for (const e of events) {
    if (!groups[e.magazine_key]) {
      groups[e.magazine_key] = { magazine_key: e.magazine_key, events: [], latest_at: e.detected_at };
    }
    groups[e.magazine_key].events.push(e);
    if (e.detected_at > groups[e.magazine_key].latest_at) {
      groups[e.magazine_key].latest_at = e.detected_at;
    }
  }
  // スクショ用は件数の多い順
  const groupList = Object.values(groups).sort((a, b) => b.events.length - a.events.length || b.latest_at.localeCompare(a.latest_at));

  // 日和のセリフ
  const totalCount = events.length;
  const uniqueUsers = {};
  for (const g of groupList) {
    const user = magazineDetails[g.magazine_key].user || {};
    const key = user.urlname || user.nickname || g.magazine_key;
    if (!uniqueUsers[key]) uniqueUsers[key] = { name: user.nickname || user.urlname || '', count: 0 };
    uniqueUsers[key].count += g.events.length;
  }
  const topUser = Object.values(uniqueUsers).sort((a, b) => b.count - a.count)[0];
  let hiyoriLine;
  if (totalCount === 0) {
    hiyoriLine = pickLine('hiyori', 'no_event');
  } else if (topUser && topUser.count >= 3) {
    hiyoriLine = pickLine('hiyori', 'repeat_from_user', { name: topUser.name, count: topUser.count });
  } else if (totalCount >= 5) {
    hiyoriLine = pickLine('hiyori', 'many_event', { count: totalCount });
  } else if (totalCount >= 2) {
    hiyoriLine = pickLine('hiyori', 'multi_event', { count: totalCount });
  } else {
    hiyoriLine = pickLine('hiyori', 'single_event', { count: totalCount });
  }

  const periodLabels = { week: '今週', lastweek: '先週', month: '今月', lastmonth: '先月', all: '全期間' };
  const periodLabel = periodLabels[magazinePeriod] || '';
  const dateRange = range ? `${getDayLabel(range.start)}〜${getDayLabel(range.end)}` : '全期間';

  const cardHTML = (g) => {
    const mag = magazineDetails[g.magazine_key];
    const user = mag.user || {};
    const cover = mag.cover_landscape || mag.cover || '';
    const userName = user.nickname || user.urlname || '';
    const count = g.events.length;
    const userIcon = user.profile_image_path || '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border-radius:10px;border:1px solid rgba(108,92,231,0.12);margin-bottom:6px">
      ${cover ? `<img src="${cover}" alt="" style="width:72px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:72px;height:44px;background:#f0f0f0;border-radius:6px;flex-shrink:0"></div>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px">${mag.name || ''}</div>
        <div style="display:flex;align-items:center;gap:5px;min-width:0">
          ${userIcon ? `<img src="${userIcon}" alt="" style="width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0">` : ''}
          <div style="font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${userName}</div>
        </div>
      </div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#fd79a8;flex-shrink:0">${count}<span style="font-size:9px;color:#999">本</span></div>
    </div>`;
  };

  const half = Math.ceil(groupList.length / 2);
  const left = groupList.slice(0, half);
  const right = groupList.slice(half);

  const gridHtml = groupList.length > 6
    ? `<div class="screenshot-grid">
        <div>${left.map(cardHTML).join('')}</div>
        <div>${right.map(cardHTML).join('')}</div>
      </div>`
    : `<div>${groupList.map(cardHTML).join('')}</div>`;

  const emptyHtml = groupList.length === 0
    ? `<div style="text-align:center;padding:32px 0;color:#999;font-size:13px">この期間の追加はありません</div>`
    : gridHtml;

  const html = `
    <div style="background:#fffbf2;color:#0a0a14;border-radius:20px;padding:28px 24px;font-family:'Noto Sans JP',sans-serif;max-width:860px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:900;color:#333"><span style="font-size:1.5em;font-weight:900;color:#6c5ce7">マ</span>ガジンに追加してくれた方々</div>
        <div style="font-size:12px;color:#999;margin-top:4px">${periodLabel} ${dateRange}</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:#fff5f8;border-radius:12px;margin-bottom:16px">
        <img src="https://hasyamo.github.io/note-stats-tracker/images/eyes-thumb/eyes-sun.webp" alt="日和" style="width:40px;height:40px;border-radius:50%;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:#999;margin-bottom:2px">日和</div>
          <div style="font-size:13px;color:#333;line-height:1.5">${hiyoriLine}</div>
        </div>
      </div>
      ${emptyHtml}
      <div style="text-align:center;margin-top:16px;font-size:10px;color:#ccc;letter-spacing:2px">観測は続く。 / hasyamo</div>
    </div>`;

  document.getElementById('sukiScreenshotContent').innerHTML = html;
  document.getElementById('sukiScreenshotModal').style.display = '';
}

// ===== Suki Return Tracking =====
const STORAGE_KEY_RETURNS = 'fanboard_suki_returns';
const STORAGE_KEY_PENDING = 'fanboard_pending_visit';

function getSukiReturns() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY_RETURNS) || '{}');
}

function saveSukiReturns(data) {
  localStorage.setItem(STORAGE_KEY_RETURNS, JSON.stringify(data));
}

function getSukiReturnStatus(urlname) {
  if (!urlname) return { liked: false };
  const returns = getSukiReturns();
  const weekKey = getMondayOf(getTodayJST());
  const entry = returns[urlname];
  if (entry && entry.week === weekKey) return { liked: entry.liked };
  return { liked: false };
}

function setSukiReturnStatus(urlname, liked) {
  const returns = getSukiReturns();
  const weekKey = getMondayOf(getTodayJST());
  returns[urlname] = { liked, week: weekKey, updatedAt: new Date().toISOString() };
  saveSukiReturns(returns);
}

function setPendingVisit(urlname, name) {
  sessionStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify({ urlname, name }));
}

function checkPendingVisit() {
  const pending = sessionStorage.getItem(STORAGE_KEY_PENDING);
  if (!pending) return;
  sessionStorage.removeItem(STORAGE_KEY_PENDING);
  const { urlname, name } = JSON.parse(pending);
  const status = getSukiReturnStatus(urlname);
  if (status.liked) return;
  showReturnModal(urlname, name);
}

const RETURN_LINES = [
  '……ちゃんとスキした？',
  '読んだだけじゃ意味ないわよ。スキした？',
  '……で、スキは押したの？',
  '見ただけで帰ってきたんじゃないでしょうね。',
  '……スキくらい押しなさいよ。',
  'ちゃんと読んだなら、伝えなさい。',
];
function randomReturnLine() {
  return RETURN_LINES[Math.floor(Math.random() * RETURN_LINES.length)];
}

function showReturnModal(urlname, name) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div style="max-width:400px;margin:120px auto;padding:24px;background:var(--section-bg);border-radius:16px;border:1px solid var(--border);text-align:center">
      <img src="${charImgSrc('rinka')}" alt="凛華" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--accent-cyan);margin-bottom:8px">
      <div style="font-size:15px;color:var(--text-primary);margin-bottom:6px">${randomReturnLine()}</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:16px">${name}さんの記事</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button onclick="event.preventDefault();handleReturnAnswer('${urlname}',true,this)" style="padding:10px 24px;background:var(--accent-pink);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">スキした</button>
        <button onclick="event.preventDefault();handleReturnAnswer('${urlname}',false,this)" style="padding:10px 24px;background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border);border-radius:8px;font-size:14px;cursor:pointer">まだ</button>
      </div>
    </div>`;
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
  modal.querySelector('button').focus();
}

let activePeopleTab = 'new';

function handleReturnAnswer(urlname, liked, btn) {
  if (liked) setSukiReturnStatus(urlname, true);
  btn.closest('.modal-overlay').remove();
  // Refresh fans tab if active, preserving current people tab
  const fansTab = document.getElementById('tabFans');
  if (fansTab && fansTab.classList.contains('active')) {
    renderFans();
  }
}

// ソート切替: document 委譲
document.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!target || !target.closest) return;
  const wrap = target.closest('.sort-toggle');
  if (!wrap) return;
  const tabId = wrap.dataset.sortTab;
  if (!tabId) return;
  const btn = target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const cur = getSortSetting(tabId);
  if (action === 'direction') {
    const v = btn.dataset.value;
    if (v === 'oldest' || v === 'newest') cur.direction = v;
  } else if (action === 'comment') {
    cur.commentPriority = !cur.commentPriority;
  }
  saveSortSetting(tabId, cur);
  // 該当タブを再描画
  if (tabId === 'yesterday' || tabId === 'latestReaction') renderToday();
  else if (tabId === 'fans') renderFans();
});

// Check when returning from note (tab switch back)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    setTimeout(checkPendingVisit, 800);
    setTimeout(checkPendingLatestReaction, 800);
  }
});

// ===== Magazines Tab =====
let magazinePeriod = 'week';
let magazineView = 'magazine'; // 'magazine' or 'article'

async function loadMagazines() {
  if (magazinesLoaded) return;
  const base = `./data/${creatorUrlname}/`;
  const cacheBust = '?t=' + Date.now();

  try {
    const evRes = await fetch(base + 'magazine_events.csv' + cacheBust);
    if (evRes.ok) {
      magazineEvents = parseCSV(await evRes.text());
    }
  } catch(e) { console.error('magazine_events load error:', e); }

  // 外部マガジンのkeyを抽出して詳細JSONを読み込む
  const addedEvents = magazineEvents.filter(e => e.event_type === 'added');
  const magKeys = [...new Set(addedEvents.map(e => e.magazine_key))];
  await Promise.all(magKeys.map(async mk => {
    if (magazineDetails[mk]) return;
    try {
      const res = await fetch(base + 'magazines/' + mk + '.json' + cacheBust);
      if (res.ok) {
        magazineDetails[mk] = await res.json();
      }
    } catch(e) {}
  }));

  magazinesLoaded = true;
}

async function renderMagazines() {
  const el = document.getElementById('magazinesContent');
  if (!magazinesLoaded) {
    el.innerHTML = '<div class="loading">読み込み中...</div>';
    await loadMagazines();
  }

  const range = magazinePeriod === 'all' ? null : getPeriodRange(magazinePeriod);

  // 全addedイベント（マガジン詳細が取得できたもの）
  const allEvents = magazineEvents
    .filter(e => e.event_type === 'added' && magazineDetails[e.magazine_key])
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  const events = range
    ? allEvents.filter(e => {
        const d = e.detected_at.slice(0, 10);
        return d >= range.start && d <= range.end;
      })
    : allEvents;

  // ビュートグル + 期間セレクタHTML
  const screenshotBtn = magazineView === 'magazine'
    ? `<button class="toggle-btn" onclick="openMagazineScreenshot()" style="font-size:11px;margin-right:8px">スクショ用</button>`
    : '';
  const togglesHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;flex-wrap:wrap">
      <div class="toggle-group" id="magazineViewToggle">
        <div class="toggle-btn${magazineView==='magazine'?' active':''}" data-view="magazine">マガジン別</div>
        <div class="toggle-btn${magazineView==='article'?' active':''}" data-view="article">記事別</div>
      </div>
      <div style="display:flex;align-items:center;flex-wrap:wrap">
        ${screenshotBtn}
        <div class="toggle-group" id="magazinePeriodToggle">
          <div class="toggle-btn${magazinePeriod==='week'?' active':''}" data-period="week">今週</div>
          <div class="toggle-btn${magazinePeriod==='lastweek'?' active':''}" data-period="lastweek">先週</div>
          <div class="toggle-btn${magazinePeriod==='month'?' active':''}" data-period="month">今月</div>
          <div class="toggle-btn${magazinePeriod==='lastmonth'?' active':''}" data-period="lastmonth">先月</div>
          <div class="toggle-btn${magazinePeriod==='all'?' active':''}" data-period="all">全期間</div>
        </div>
      </div>
    </div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;text-align:right">${range ? getDayLabel(range.start) + '〜' + getDayLabel(range.end) : '全期間'}</div>
  `;

  if (events.length === 0) {
    const line = pickLine('hiyori', 'no_event');
    el.innerHTML = naviHTML('hiyori', line) + togglesHtml + '<div class="no-data">この期間のマガジン追加はありません。</div>';
    attachMagazinePeriodListeners();
    return;
  }

  // マガジンごとにグループ化
  const magGroups = {};
  for (const e of events) {
    if (!magGroups[e.magazine_key]) {
      magGroups[e.magazine_key] = {
        magazine_key: e.magazine_key,
        events: [],
        latest_at: e.detected_at,
      };
    }
    magGroups[e.magazine_key].events.push(e);
    if (e.detected_at > magGroups[e.magazine_key].latest_at) {
      magGroups[e.magazine_key].latest_at = e.detected_at;
    }
  }
  const magGroupList = Object.values(magGroups).sort((a, b) => b.latest_at.localeCompare(a.latest_at));

  // 記事ごとにグループ化
  const artGroups = {};
  for (const e of events) {
    if (!artGroups[e.note_key]) {
      artGroups[e.note_key] = {
        note_key: e.note_key,
        events: [],
        latest_at: e.detected_at,
      };
    }
    artGroups[e.note_key].events.push(e);
    if (e.detected_at > artGroups[e.note_key].latest_at) {
      artGroups[e.note_key].latest_at = e.detected_at;
    }
  }
  const artGroupList = Object.values(artGroups).sort((a, b) => b.latest_at.localeCompare(a.latest_at));

  let items;
  if (magazineView === 'magazine') {
    items = magGroupList.map(g => {
      const mag = magazineDetails[g.magazine_key];
      const user = mag.user || {};
      const date = g.latest_at.slice(0, 10) + ' ' + g.latest_at.slice(11, 16);
      const cover = mag.cover_landscape || mag.cover || '';
      const userIcon = user.profile_image_path || '';
      const userName = user.nickname || user.urlname || '';
      const userUrl = user.urlname ? `https://note.com/${user.urlname}` : '#';
      const magUrl = mag.magazine_url || '#';
      const count = g.events.length;

      const titles = g.events.map(e => {
        const art = articlesData.find(a => a.key === e.note_key);
        return art ? art.title : e.note_key;
      }).slice(0, 3);
      const titlesHtml = titles.map(t => `<div class="magazine-article">「${t}」</div>`).join('');

      return `
        <div class="magazine-card">
          ${cover ? `<a href="${magUrl}" target="_blank" rel="noopener"><img class="magazine-cover" src="${cover}" alt=""></a>` : ''}
          <div class="magazine-body">
            <div class="magazine-meta">
              <img class="magazine-user-icon" src="${userIcon}" alt="">
              <div class="magazine-user-info">
                <div class="magazine-name">${mag.name || ''}</div>
                <div class="magazine-user-name">${userName}</div>
              </div>
            </div>
            ${titlesHtml}
            <div class="magazine-footer">
              <div class="magazine-footer-row">
                <div class="magazine-date">${date}</div>
                <div class="magazine-count">${count}<span class="magazine-count-unit">本</span></div>
              </div>
              <div class="magazine-actions">
                <a class="magazine-action-btn" href="${magUrl}" target="_blank" rel="noopener">マガジンへ</a>
                <a class="magazine-action-btn" href="${userUrl}" target="_blank" rel="noopener">クリエータページへ</a>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    // 記事別ビュー（一覧形式）
    items = artGroupList.map(g => {
      const art = articlesData.find(a => a.key === g.note_key);
      const artTitle = art ? art.title : g.note_key;
      const artUrl = creatorUrlname ? `https://note.com/${creatorUrlname}/n/${g.note_key}` : '#';
      const date = g.latest_at.slice(0, 10) + ' ' + g.latest_at.slice(11, 16);
      const count = g.events.length;

      const magItems = g.events.map(e => {
        const mag = magazineDetails[e.magazine_key];
        if (!mag) return '';
        const user = mag.user || {};
        const userIcon = user.profile_image_path || '';
        const userName = user.nickname || user.urlname || '';
        const magUrl = mag.magazine_url || '#';
        return `
          <a class="article-mag-row" href="${magUrl}" target="_blank" rel="noopener">
            <img class="article-mag-icon" src="${userIcon}" alt="">
            <div class="article-mag-info">
              <div class="article-mag-name">${mag.name || ''}</div>
              <div class="article-mag-user">${userName}</div>
            </div>
          </a>
        `;
      }).join('');

      return `
        <div class="article-row">
          <div class="article-row-header">
            <a class="article-row-title" href="${artUrl}" target="_blank" rel="noopener">${artTitle}</a>
            <div class="article-row-meta">
              <span class="article-row-count">${count}マガジン</span>
              <span class="article-row-date">${date}</span>
            </div>
          </div>
          <div class="article-mag-list">${magItems}</div>
        </div>
      `;
    }).join('');
  }

  // 日和のセリフ決定（マガジン別時のデータ）
  const totalCount = events.length;
  const uniqueUsers = {};
  for (const g of magGroupList) {
    const user = magazineDetails[g.magazine_key].user || {};
    const key = user.urlname || user.nickname || g.magazine_key;
    if (!uniqueUsers[key]) uniqueUsers[key] = { name: user.nickname || user.urlname || '', count: 0 };
    uniqueUsers[key].count += g.events.length;
  }
  const topUser = Object.values(uniqueUsers).sort((a, b) => b.count - a.count)[0];

  let hiyoriLine;
  if (topUser && topUser.count >= 3) {
    hiyoriLine = pickLine('hiyori', 'repeat_from_user', { name: topUser.name, count: topUser.count });
  } else if (totalCount >= 5) {
    hiyoriLine = pickLine('hiyori', 'many_event', { count: totalCount });
  } else if (totalCount >= 2) {
    hiyoriLine = pickLine('hiyori', 'multi_event', { count: totalCount });
  } else {
    hiyoriLine = pickLine('hiyori', 'single_event', { count: totalCount });
  }

  const listClass = magazineView === 'magazine' ? 'magazine-list' : 'article-list';
  el.innerHTML = naviHTML('hiyori', hiyoriLine) + togglesHtml + `<div class="${listClass}">${items}</div>`;
  attachMagazinePeriodListeners();
}

function attachMagazinePeriodListeners() {
  document.querySelectorAll('#magazinePeriodToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      magazinePeriod = btn.dataset.period;
      renderMagazines();
    });
  });
  document.querySelectorAll('#magazineViewToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      magazineView = btn.dataset.view;
      renderMagazines();
    });
  });
}

// ===== CSV Parser =====
function parseCSV(text) {
  // クォート対応CSVパーサ: フィールド内の改行・カンマ・エスケープ("")を扱う
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } // エスケープされたダブルクォート
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cur); cur = '';
      } else if (c === '\n') {
        row.push(cur); cur = '';
        rows.push(row); row = [];
      } else {
        cur += c;
      }
    }
  }
  // 残り
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length === headers.length || (r.length === 1 && r[0] === '')).filter(r => r.length === headers.length).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

// ===== Data Loading =====
async function loadData(urlname) {
  creatorUrlname = urlname;
  // 読者マップβ リンクに現在のクリエイターを引き継ぐ
  const rmLink = document.getElementById('readerMapLink');
  if (rmLink) rmLink.href = `relation_graph.html?user=${encodeURIComponent(urlname)}`;
  const cacheBust = '?t=' + Date.now();
  const base = `./data/${urlname}/`;

  await loadLines();

  try {
    // Articles
    const artRes = await fetch(base + 'articles.csv' + cacheBust);
    if (artRes.ok) {
      articlesData = parseCSV(await artRes.text()).map(r => ({
        date: r.date || '', key: r.key, title: r.title || '', published_at: r.published_at || '',
        like_count: parseInt(r.like_count) || 0, comment_count: parseInt(r.comment_count) || 0,
      }));
    }

    // Likes
    const likesRes = await fetch(base + 'likes.csv' + cacheBust);
    if (likesRes.ok) { likesData = parseCSV(await likesRes.text()); }

    // Comments
    try {
      const comRes = await fetch(base + 'comments.csv' + cacheBust);
      if (comRes.ok) { commentsData = parseCSV(await comRes.text()); }
    } catch(e) { /* comments.csv is optional */ }

    // Followers
    const fRes = await fetch(base + 'followers.csv' + cacheBust);
    if (fRes.ok) {
      followersData = parseCSV(await fRes.text()).map(r => ({
        date: r.date, follower_count: parseInt(r.follower_count) || 0,
      }));
    }

    // Last updated
    const updRes = await fetch(base + 'last_updated.txt' + cacheBust);
    if (updRes.ok) {
      lastUpdated = (await updRes.text()).trim();
    }
  } catch(e) {
    console.error('Data load error:', e);
  }
}

// ===== Init =====
const STORAGE_KEY_USER = 'fanboard_user';

function showUserSelectModal(creators) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = '';
    modal.innerHTML = `
      <div style="max-width:400px;margin:100px auto;padding:28px;background:var(--section-bg);border-radius:16px;border:1px solid var(--border);text-align:center">
        <img src="images/icon-192.png" alt="" style="width:64px;height:64px;border-radius:50%;margin-bottom:12px">
        <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:4px">観測は続く。</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">あなたのnote IDを入力してください</div>
        <input id="userInput" type="text" placeholder="例: hasyamo" style="width:100%;padding:12px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:15px;text-align:center;outline:none;box-sizing:border-box">
        <div id="userError" style="font-size:12px;color:var(--accent-pink);margin-top:8px;display:none"></div>
        <button id="userSubmit" style="margin-top:16px;padding:12px 32px;background:var(--accent-cyan);color:#1a1a2e;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;width:100%">はじめる</button>
      </div>`;
    document.body.appendChild(modal);

    const input = document.getElementById('userInput');
    const error = document.getElementById('userError');
    const submit = document.getElementById('userSubmit');

    function trySubmit() {
      const val = input.value.trim();
      if (!val) { error.textContent = 'IDを入力してください'; error.style.display = ''; return; }
      if (creators && !creators.includes(val)) {
        error.textContent = 'このIDは登録されていません。noteではしゃもまでDMください。';
        error.style.display = '';
        return;
      }
      localStorage.setItem(STORAGE_KEY_USER, val);
      modal.remove();
      resolve(val);
    }

    submit.addEventListener('click', trySubmit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmit(); });
    input.focus();
  });
}

async function init() {
  // Priority: URL query > localStorage > prompt
  const params = new URLSearchParams(location.search);
  let urlname = params.get('user') || '';

  // Path-based: /note-fan-board/hasyamo/
  if (!urlname) {
    const pathParts = location.pathname.replace(/\/$/, '').split('/');
    const repoIdx = pathParts.indexOf('note-fan-board');
    if (repoIdx >= 0 && pathParts.length > repoIdx + 1 && pathParts[repoIdx + 1] !== 'index.html') {
      urlname = pathParts[repoIdx + 1];
    }
  }

  // localStorage
  if (!urlname) {
    urlname = localStorage.getItem(STORAGE_KEY_USER) || '';
  }

  // Load creators list
  let creators = null;
  try {
    const creatorsRes = await fetch('./data/creators.csv?t=' + Date.now());
    if (creatorsRes.ok) {
      creators = parseCSV(await creatorsRes.text()).map(r => r.urlname).filter(u => u && !u.startsWith('#'));
    }
  } catch(e) {}

  // Validate or prompt
  if (!urlname || (creators && !creators.includes(urlname))) {
    localStorage.removeItem(STORAGE_KEY_USER);
    urlname = await showUserSelectModal(creators);
  } else {
    // Save to localStorage for PWA
    localStorage.setItem(STORAGE_KEY_USER, urlname);
  }

  // Dynamic manifest with user-specific start_url
  const base = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  const dynamicManifest = {
    name: '観測は続く。',
    short_name: '観測は続く。',
    description: '昨日、あなたに会いに来た人。',
    start_url: base + '?user=' + urlname,
    display: 'standalone',
    background_color: '#0a0a14',
    theme_color: '#0a0a14',
    icons: [
      { src: base + 'images/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: base + 'images/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  const manifestBlob = new Blob([JSON.stringify(dynamicManifest)], { type: 'application/json' });
  const manifestUrl = URL.createObjectURL(manifestBlob);
  const existingManifest = document.querySelector('link[rel="manifest"]');
  if (existingManifest) existingManifest.href = manifestUrl;

  await loadData(urlname);
  // ランキング計算にマガジンデータが必要なため事前ロード
  await loadMagazines();

  // Update header
  document.getElementById('creatorName').textContent = urlname;
  if (followersData.length > 0) {
    document.getElementById('followerCount').textContent = followersData[followersData.length - 1].follower_count;
  }
  document.getElementById('lastUpdate').textContent = lastUpdated;

  // Render active tab
  const hash = location.hash.replace('#', '');
  if (hash && document.querySelector(`.tab-bar-btn[data-tab="${hash}"]`)) {
    switchTab(hash, { adjustScroll: false });
  } else {
    renderToday();
  }

  // Register service worker (production only)
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Check version update
  checkVersionUpdate();
}

const APP_VERSION = '0.9.0';
const VERSION_KEY = 'fanboard_version';

async function checkVersionUpdate() {
  const lastSeen = localStorage.getItem(VERSION_KEY);
  if (lastSeen === APP_VERSION) return;

  // 初回はメッセージを出さず、記録だけ
  if (!lastSeen) {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    return;
  }

  // updates.jsonから現バージョンのメッセージを取得
  let items = null;
  try {
    const res = await fetch('./data/updates.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      items = data[APP_VERSION];
    }
  } catch (e) {}

  if (!items || items.length === 0) {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    return;
  }

  document.getElementById('updateVersion').textContent = 'v' + APP_VERSION;
  const body = document.getElementById('updateBody');
  body.innerHTML = items.map(t => `<li>${t}</li>`).join('');
  const modal = document.getElementById('updateModal');
  modal.style.display = 'flex';
  document.getElementById('updateCloseBtn').addEventListener('click', () => {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    modal.style.display = 'none';
  }, { once: true });
}

// ===== AI Analysis Pack (analysis_pack_export.py を直近30日版で移植) =====
// 命名・列順は Python 正本を踏襲。
function _ti(x) { const n = parseInt(x, 10); return isNaN(n) ? 0 : n; }
function _d10(s) { return (s || '').slice(0, 10); }
function _parseDt(dt) {
  if (!dt) return null;
  const t = Date.parse(dt.replace(/Z$/, '+00:00'));
  return isNaN(t) ? null : t;
}
function _round1(v) { return Math.round(v * 10) / 10; }
function _median(vals) {
  const a = vals.filter(v => v != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 課金記事マーカー判定（直近30日の対象記事だけ note 公開APIを直列で叩いて price を取る）
// note.com はCORSヘッダを返さないため、既存の CF Worker (PROXY_URL) 経由で叩く。
// Worker側で /api/v3/notes/ を ALLOWED_PATHS に含めてあり、CORSヘッダも付与される。
// fetch 失敗時は null を返す → '?' マーカーに落ちる
async function _fetchPaidMap(noteKeys) {
  const result = {};
  for (const key of noteKeys) {
    let price = null;
    try {
      const url = `${PROXY_URL}?path=${encodeURIComponent('/api/v3/notes/' + key)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        const p = j && j.data ? j.data.price : null;
        if (typeof p === 'number') price = p;
      } else {
        console.warn('[aiPack] price fetch !ok', key, res.status);
      }
    } catch (e) {
      console.warn('[aiPack] price fetch failed', key, e && e.message);
    }
    result[key] = price; // null = 失敗、number = 取得成功
    await new Promise(r => setTimeout(r, 600));
  }
  return result;
}

async function buildAnalysisPack() {
  // データソース：loadData/loadMagazinesで揃った既存変数
  const arts = {};
  for (const a of articlesData) arts[a.key] = a;
  const likes = (likesData || []).slice();
  const followers = (followersData || [])
    .map(r => [r.date, _ti(r.follower_count)])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const mag = magazineEvents || [];

  // 最新日（likes基準。Python正本と同じ）
  let dataLatest = '';
  for (const l of likes) {
    const d = _d10(l.liked_at);
    if (d > dataLatest) dataLatest = d;
  }
  if (!dataLatest) return '（データがありません）';

  // 対象月（データ最新日のその月。py: month）
  const month = dataLatest.slice(0, 7);

  // 直近30日の境界（②③共通。py: cutd）
  const latestMs = Date.parse(dataLatest + 'T23:59:59+09:00');
  const cutMs = latestMs - 30 * 86400 * 1000;
  const cutDate = new Date(cutMs);
  const pad = n => String(n).padStart(2, '0');
  const cutd = `${cutDate.getFullYear()}-${pad(cutDate.getMonth() + 1)}-${pad(cutDate.getDate())}`;

  // 公開当時フォロワー数（Python: fol_at）
  function folAt(date) {
    let v = null;
    for (const [dt, fc] of followers) {
      if (dt <= date) v = fc; else break;
    }
    return v;
  }

  // ユーザー単位の初反応・最終反応・通算
  const firstSeen = {}, lastSeen = {}, nameOf = {}, cnt = {};
  const sortedLikes = likes.slice().sort((a, b) => a.liked_at < b.liked_at ? -1 : a.liked_at > b.liked_at ? 1 : 0);
  for (const l of sortedLikes) {
    const u = l.like_user_id;
    if (!u) continue;
    if (!(u in firstSeen)) firstSeen[u] = _d10(l.liked_at);
    lastSeen[u] = _d10(l.liked_at);
    nameOf[u] = l.like_username || l.like_user_urlname || u;
    cnt[u] = (cnt[u] || 0) + 1;
  }

  // 記事別 likes / mag
  const likesByArt = {};
  for (const l of likes) {
    (likesByArt[l.note_key] = likesByArt[l.note_key] || []).push(l);
  }
  const magByArt = {};
  for (const m of mag) {
    if (m.event_type && m.event_type !== 'added') continue;
    magByArt[m.note_key] = (magByArt[m.note_key] || 0) + 1;
  }

  // py: month_rows（指定月に公開された記事）
  function monthRows(mo) {
    const rows = [];
    for (const k of Object.keys(arts)) {
      const a = arts[k];
      const pubDate = _d10(a.published_at);
      if (!pubDate || pubDate.slice(0, 7) !== mo) continue;
      const lk = _ti(a.like_count), cm = _ti(a.comment_count);
      const fol = folAt(pubDate);
      const pMs = _parseDt(a.published_at);
      let v24 = 0;
      if (pMs != null) {
        for (const l of (likesByArt[k] || [])) {
          const lt = _parseDt(l.liked_at);
          if (lt != null && (lt - pMs) >= 0 && (lt - pMs) <= 86400 * 1000) v24++;
        }
      }
      const shinki = (likesByArt[k] || []).filter(l => firstSeen[l.like_user_id] === _d10(l.liked_at)).length;
      const totalLikers = (likesByArt[k] || []).length;
      const depth = lk + cm * 5 + (magByArt[k] || 0) * 10;
      const eta = (fol && fol > 0) ? (lk / fol * 100) : null;
      rows.push({
        title: a.title || '',  // フルタイトル（切らない・記事番号に依存しない＝汎用）
        pubd: pubDate,
        lk, cm,
        mag: magByArt[k] || 0,
        fol,
        eta,
        v24,
        shinki,
        joren: totalLikers - shinki,
        depth,
      });
    }
    rows.sort((a, b) => a.pubd < b.pubd ? -1 : a.pubd > b.pubd ? 1 : 0);
    return rows;
  }

  const cur = monthRows(month);

  // 課金記事マーカー：①の表に出す記事だけ price を取得（直列・600ms sleep）
  // cur 内の各行に { ...., noteKey } を持たせるため、キーを別途確保
  const curKeys = [];
  for (const k of Object.keys(arts)) {
    const a = arts[k];
    const pubDate = _d10(a.published_at);
    if (pubDate && pubDate.slice(0, 7) === month) curKeys.push(k);
  }
  const paidMap = await _fetchPaidMap(curKeys);
  // cur 各行に対応する key を紐付け直す（titleが重複しても確実に対応）
  // マーカー：💎（課金）／🆕（公開後72h未満）／?（fetch失敗）。両方該当なら 💎🆕 の順
  const FRESH_MS = 72 * 3600 * 1000;
  for (const r of cur) {
    const k = Object.keys(arts).find(kk =>
      arts[kk].title === r.title && _d10(arts[kk].published_at) === r.pubd
    );
    r._key = k;
    const p = k != null ? paidMap[k] : null;
    const paidMark = p == null ? '?' : (p > 0 ? '💎' : '');
    const pubMs = k != null ? _parseDt(arts[k].published_at) : null;
    const isFresh = pubMs != null && (latestMs - pubMs) < FRESH_MS;
    const freshMark = isFresh ? '🆕' : '';
    const combined = `${paidMark}${freshMark}`;
    r._marker = combined ? `${combined} ` : '';
  }

  // ② コホート：初反応の月 → 直近30日の再反応＝定着（py: recent_actors 経由）
  const recentActors = new Set();
  for (const l of likes) {
    if (_d10(l.liked_at) >= cutd && l.like_user_id) recentActors.add(l.like_user_id);
  }
  const cohortMap = {};
  for (const u of Object.keys(firstSeen)) {
    const fm = firstSeen[u].slice(0, 7);
    if (!cohortMap[fm]) cohortMap[fm] = { total: 0, active: 0 };
    cohortMap[fm].total++;
    if (recentActors.has(u)) cohortMap[fm].active++;
  }
  const cohortKeys = Object.keys(cohortMap).sort();

  // ③ churn：通算2回以上 かつ 直近30日無反応（上位15件）
  const churn = [];
  for (const u of Object.keys(cnt)) {
    if (cnt[u] >= 2 && lastSeen[u] < cutd) {
      churn.push([nameOf[u], cnt[u], lastSeen[u]]);
    }
  }
  churn.sort((a, b) => b[1] - a[1]);

  // ===== Markdown 生成 =====
  const urlname = creatorUrlname || '';
  const lines = [];
  const o = s => lines.push(s);

  o(`# 📊 note分析パック（${urlname}）｜${month}・貼るだけAI分析用`);
  o(`対象月：${month}（${cur.length}本）／全${Object.keys(arts).length}本`);
  o('');
  o('> このMarkdownは、ChatGPTやClaudeなどのAIに貼ってnote運営を振り返るための分析パックです。');
  o('> このMarkdown自体をそのまま公開する前提ではなく、AIによる振り返り・分析・下書き作成のための一次情報です。');
  o('> 個人別の反応履歴を含む場合があります。AIの出力をnote記事などに転用する場合は、個人名や個別履歴が本文に出ないよう必ず編集してください。');
  o('> 補正スキ率＝スキ÷公開当時フォロワー数。母数の違いによる見え方のズレを抑えるための参考指標です。履歴外はN/A。');
  o('> 深さ＝スキ・コメント・マガジンなどから算出した、反応の濃さを見る独自指標です。');
  o('');

  // ① 記事マスター（フルタイトル＋公開日で区別＝記事番号に依存しない汎用）
  o(`## ① 記事マスター（${month}）`);
  if (cur.length === 0) {
    o('（該当期間に公開記事はありません）');
  } else {
    o('| 記事 | 公開 | スキ | コメ | マガ | 当時フォロ | 補正スキ率 | 24h初速 | 新規/常連 | 深さ |');
    o('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of cur.slice().sort((a, b) => a.pubd < b.pubd ? 1 : -1)) {
      const eta = r.eta != null ? `${_round1(r.eta)}%` : 'N/A';
      o(`| ${r._marker || ''}${r.title} | ${r.pubd} | ${r.lk} | ${r.cm} | ${r.mag} | ${r.fol ?? 'N/A'} | ${eta} | ${r.v24} | ${r.shinki}/${r.joren} | ${r.depth} |`);
    }
    o('');
    o('> 💎＝課金記事（有料／メンシプ限定）。コメント可能な読者が購入者・会員に限定されるため、無料記事と直接比較せず傾向で読んでください。 ／ 🆕＝公開後72時間未満。数字が育ち切っていない＝伸び続ける可能性があり、固まった数字として扱わないでください。 ／ ?＝判定取得に失敗。');
  }
  o('');

  // ② コホート
  o('## ② いつ出会った読者が、今も来てくれているか（初反応した月 → 直近30日の再反応＝定着）');
  o(`> ※${month} は直近30日内の初反応者を含むため定着率が高く出ます（参考値）。過去月との単純比較ではなく「今月出会った読者層」として扱ってください。`);
  if (cohortKeys.length === 0) {
    o('（データがありません）');
  } else {
    o('| 初反応した月 | 人数 | 直近30日の再反応 | 定着率 |');
    o('|---|---|---|---|');
    for (const k of cohortKeys) {
      const c = cohortMap[k];
      const rate = c.total > 0 ? `${Math.round(c.active / c.total * 100)}%` : 'N/A';
      o(`| ${k} | ${c.total} | ${c.active} | ${rate} |`);
    }
  }
  o('');

  // ③ 過去常連（churn）
  o('## ③ 直近30日では反応がない過去常連（通算2回以上スキ・直近30日無反応）');
  o('> この表は本文にそのまま出すためのものではありません。分析では「過去によく反応してくれていた読者層」「最近反応が途切れている層」として、集計・傾向で扱ってください（個人名・回数・日付は本文に出さない）。');
  if (churn.length === 0) {
    o('（該当なし）');
  } else {
    o('| 名前 | 通算スキ | 最終反応 |');
    o('|---|---|---|');
    for (const [nm, c, ls] of churn.slice(0, 15)) {
      o(`| ${nm} | ${c} | ${ls} |`);
    }
  }
  o('');

  // 分析プロンプト
  o('---');
  o('## 🤖 分析プロンプト（このまま続けてAIに頼める）');
  o('');
  o('1. **振り返り**：「①の記事マスターを見て、補正スキ率・深さ・24h初速・新規/常連比から、今月の\"刺さった型\"と\"空振りの型\"をテーマ・文体で各3つ。順位や優劣の断定はせず傾向で。」');
  o('2. **次の一手（主軸）**：「②の定着と③の過去常連の傾向から、来月書くと良いテーマ・切り口を3つ。新規を連れてくる型と常連が喜ぶ型を分けて。」');
  o('3. **振り返りnoteの下書き**：「この分析を読者に見せられる振り返りnoteの下書きに。数字は一次情報として明示し（補正スキ率・深さ・24h初速・新規/常連比など）、数字の羅列でなく\"数字から何が見えたか\"まで書く。個人名・個別読者の通算スキ数・最終反応日は本文に出さない（必要なら『過去によく反応してくれていた読者層』など集計・傾向で）。推測は推測として書く。」');
  o('4. **注意**：「②の今月の定着率は期間内初反応者を含むため参考値として扱う。③の個人別データは本文に出さず、読者層の傾向分析にのみ使う。」');
  o('');

  return lines.join('\n');
}

// ===== AI Pack Modal 制御 =====
let _aiPackMarkdown = '';

function openAiPack() {
  const modal = document.getElementById('aiPackModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeAiPack() {
  const modal = document.getElementById('aiPackModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}
function _aiPackToast(msg) {
  const t = document.getElementById('aiPackToast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(_aiPackToast._timer);
  _aiPackToast._timer = setTimeout(() => { t.style.display = 'none'; }, 1600);
}

function setupAiPack() {
  const openBtn = document.getElementById('aiPackBtn');
  if (openBtn) openBtn.addEventListener('click', openAiPack);

  const genBtn = document.getElementById('aiPackGenBtn');
  const out = document.getElementById('aiPackOutput');
  const actions = document.getElementById('aiPackActions');

  if (genBtn) genBtn.addEventListener('click', async () => {
    if (genBtn.disabled) return;
    const originalLabel = genBtn.textContent;
    genBtn.disabled = true;
    genBtn.textContent = '取得中…';
    try {
      _aiPackMarkdown = await buildAnalysisPack();
      out.value = _aiPackMarkdown;
      out.style.display = 'block';
      actions.style.display = 'flex';
    } catch (e) {
      console.error(e);
      _aiPackToast('生成に失敗しました');
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = originalLabel;
    }
  });

  const copyBtn = document.getElementById('aiPackCopyBtn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    if (!_aiPackMarkdown) return;
    try {
      await navigator.clipboard.writeText(_aiPackMarkdown);
      _aiPackToast('コピーしました');
    } catch (e) {
      out.select();
      document.execCommand('copy');
      _aiPackToast('コピーしました');
    }
  });

  const dlBtn = document.getElementById('aiPackDlBtn');
  if (dlBtn) dlBtn.addEventListener('click', () => {
    if (!_aiPackMarkdown) return;
    const blob = new Blob([_aiPackMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `note-analysis-pack_${creatorUrlname || 'note'}_${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const cgptBtn = document.getElementById('aiPackOpenChatGPTBtn');
  if (cgptBtn) cgptBtn.addEventListener('click', () => window.open('https://chatgpt.com/', '_blank', 'noopener'));
  const clBtn = document.getElementById('aiPackOpenClaudeBtn');
  if (clBtn) clBtn.addEventListener('click', () => window.open('https://claude.ai/new', '_blank', 'noopener'));

  // Esc で閉じる
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const m = document.getElementById('aiPackModal');
      if (m && m.style.display !== 'none') closeAiPack();
    }
  });
}

// init() の最後で AI Pack も配線
setupAiPack();

init();
