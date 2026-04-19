// ===== note fan board =====

// ===== Data =====
let articlesData = [];
let likesData = [];
let followersData = [];
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
function renderToday() {
  const el = document.getElementById('todayContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">データなし</div>'; return; }

  const today = getTodayJST();
  const yesterday = formatDate(new Date(parseDate(today).getTime() - 86400000));

  // Yesterday's likes
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

  // Classify yesterday's users
  const userWeeks = buildUserWeeks();
  const yesterdayClassified = {};
  yesterdayUsers.forEach(u => {
    // Find uid from likesData
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

  // Character line (priority: return > new > regular > count > 0)
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

  let html = naviHTML('you', youLine);

  // Follower section
  if (followersData.length > 0) {
    const latest = followersData[followersData.length - 1];
    const prev = followersData.length >= 2 ? followersData[followersData.length - 2] : latest;
    const diff = latest.follower_count - prev.follower_count;
    const sign = diff >= 0 ? '+' : '';
    const diffColor = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-pink)';
    html += `<div class="section">
      <div class="section-title">フォロワー</div>
      <div style="font-family:var(--font-mono);font-size:24px;font-weight:700">${latest.follower_count}<span style="font-size:14px;color:${diffColor};margin-left:8px">${sign}${diff}</span></div>`;

    // Follower chart
    if (followersData.length >= 2) {
      html += `<div style="display:flex;gap:16px;font-size:10px;color:var(--text-muted);margin-top:12px;margin-bottom:4px">
        <span><span style="color:var(--accent-cyan)">━</span> フォロワー</span>
        <span><span style="color:var(--accent-pink);opacity:0.5">█</span> もらったスキ数</span>
      </div>`;
      html += `<div class="chart-wrap"><canvas id="followerCanvas"></canvas></div>`;
    }
    html += `</div>`;
  }

  // Yesterday's suki
  const totalSuki = yesterdayLikes.length;
  html += `<div class="section">
    <div class="section-title">昨日のスキ速報 <span style="font-weight:400;color:var(--text-muted)">${getDayLabel(yesterday)}</span></div>
    <div class="suki-total"><span class="suki-total-count">${totalSuki}</span><span class="suki-total-unit">スキ</span></div>`;

  if (yesterdayUsers.length > 0) {
    html += yesterdayUsers.map(u => {
      const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
      return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener">
        <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="person-name"><span class="person-name-text">${u.name}</span></div>
        <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()} followers</div>
      </a>`;
    }).join('');
  } else {
    html += `<div class="no-data">昨日のスキはありません</div>`;
  }
  html += `</div>`;

  el.innerHTML = html;
  loadAvatars();
  if (followersData.length >= 2) setTimeout(drawFollowerChart, 50);
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
        count: 0, category: cat,
      };
    }
    classified[uid].count++;
  });

  const all = Object.values(classified).sort((a, b) => b.count - a.count);
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
}

const PERSON_PAGE_SIZE = 20;

function personCardHTML(u) {
  const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
  const avatarClass = 'person-avatar' + (u.category === 'regular' ? ' regular' : '');
  const returnStatus = getSukiReturnStatus(u.urlname);
  const statusHTML = returnStatus.liked
    ? '<div style="color:var(--accent-green);font-size:11px">✅ スキ返し済</div>'
    : '<div style="color:var(--accent-amber);font-size:11px">❌ 未スキ返し</div>';
  return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener" onclick="setPendingVisit('${u.urlname}','${u.name}')">
    <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
    <div class="person-name"><span class="person-name-text">${u.name}</span></div>
    <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()} followers<br>${statusHTML}</div>
  </a>`;
}

let _peopleLists = {};

function loadMorePeople(btn) {
  const content = btn.closest('.people-content');
  const tab = content.dataset.tab;
  const list = _peopleLists[tab] || [];
  const shown = parseInt(btn.dataset.shown) || PERSON_PAGE_SIZE;
  const next = list.slice(shown, shown + PERSON_PAGE_SIZE);
  const newShown = shown + next.length;
  const remaining = list.length - newShown;

  btn.insertAdjacentHTML('beforebegin', next.map(u => personCardHTML(u)).join(''));

  if (remaining > 0) {
    btn.dataset.shown = newShown;
    btn.textContent = `もっと見る（残り${remaining}人）`;
  } else {
    btn.remove();
  }
  loadAvatars();
}

function personListHTML(list, emptyMsg) {
  if (list.length === 0) return `<div class="no-data">${emptyMsg}</div>`;
  const initial = list.slice(0, PERSON_PAGE_SIZE).map(u => personCardHTML(u)).join('');
  const moreBtn = list.length > PERSON_PAGE_SIZE
    ? `<button class="more-btn" onclick="loadMorePeople(this)" data-list-id="${Math.random().toString(36).slice(2)}" data-shown="${PERSON_PAGE_SIZE}">もっと見る（残り${list.length - PERSON_PAGE_SIZE}人）</button>`
    : '';
  return initial + moreBtn;
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
}

// ===== Ranking Tab =====
let rankPeriod = 'week';

function renderRanking() {
  const el = document.getElementById('rankingContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">データなし</div>'; return; }

  const range = getPeriodRange(rankPeriod);
  const periodLikes = likesData.filter(l => {
    const d = getRankingDate(l.liked_at);
    return d >= range.start && d <= range.end;
  });

  const userMap = {};
  periodLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = { uid, name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', count: 0, score: 0, followerCount: parseInt(l.follower_count) || 0 };
    }
    userMap[uid].count++;
    userMap[uid].score += getSukiMultiplier(l.liked_at, l.note_key);
  });

  const ranked = Object.values(userMap).sort((a, b) => b.score - a.score).slice(0, 20);

  // Classify
  const userWeeks = buildUserWeeks();
  const userCategory = {};
  ranked.forEach(u => { userCategory[u.uid] = classifyUser(u.uid, range.start, userWeeks); });

  // Character line
  const newCount = ranked.filter(u => userCategory[u.uid] === 'new').length;
  const regCount = ranked.filter(u => userCategory[u.uid] === 'regular').length;
  let runaLine;
  if (ranked.length > 0) {
    const top1Score = Math.round(ranked[0].score * 2);
    const tiedCount = ranked.filter(u => Math.round(u.score * 2) === top1Score).length;
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
      <span>スキランキング</span>
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

function rankCard(u, i, ranked, userCategory) {
  const rank = i === 0 ? 1 : (Math.round(u.score * 2) === Math.round(ranked[i - 1].score * 2) ? ranked[i - 1]._rank : i + 1);
  u._rank = rank;
  const cat = userCategory[u.uid] || '';
  const avatarClass = 'person-avatar' + (cat === 'regular' ? ' regular' : '');
  const badge = cat === 'regular' ? '<span class="badge badge-regular">常連</span>'
    : cat === 'new' ? '<span class="badge badge-new">New</span>' : '';
  const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
  return `<a class="person" href="${profileUrl}" target="_blank" rel="noopener">
    <div class="person-rank">${rank}</div>
    <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
    <div class="person-name"><span class="person-name-text">${u.name}</span>${badge}</div>
    <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()}<br>followers</div>
    <div class="person-score">${Math.round(u.score * 2)}<span>pt</span></div>
  </a>`;
}

// ===== Screenshot =====
function openScreenshot() {
  // Reuse v1 screenshot logic (simplified)
  const range = getPeriodRange(rankPeriod);
  const periodLikes = likesData.filter(l => {
    const d = getRankingDate(l.liked_at);
    return d >= range.start && d <= range.end;
  });
  const userMap = {};
  periodLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = { uid, name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', count: 0, score: 0, followerCount: parseInt(l.follower_count) || 0 };
    }
    userMap[uid].count++;
    userMap[uid].score += getSukiMultiplier(l.liked_at, l.note_key);
  });
  const ranked = Object.values(userMap).sort((a, b) => b.score - a.score).slice(0, 10);

  const periodLabels = { week: '今週', lastweek: '先週', month: '今月', lastmonth: '先月' };
  const left = ranked.slice(0, 5);
  const right = ranked.slice(5, 10);

  const cardHTML = (u, i) => {
    const rank = i === 0 ? 1 : (Math.round(u.score * 2) === Math.round(ranked[i - 1].score * 2) ? ranked[i - 1]._ssRank : i + 1);
    u._ssRank = rank;
    const avatarStyle = rank === 1 ? 'border:3px solid #d4af37;box-shadow:0 2px 8px rgba(0,0,0,0.15);' : 'border:2px solid #6c5ce7;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border-radius:12px;border:1px solid rgba(108,92,231,0.12);margin-bottom:6px">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:${rank<=1?'#d4af37':rank<=2?'#c0c0c0':rank<=3?'#cd7f32':'#ccc'};min-width:28px;text-align:center">${rank}</div>
      <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23eee' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="" style="border-radius:50%;${avatarStyle}">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#333">${u.name}さん</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:9px;color:#999">${u.count}スキ</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#fd79a8">${Math.round(u.score*2)}<span style="font-size:9px;color:#999">pt</span></div>
      </div>
    </div>`;
  };

  const html = `
    <div style="background:#fffbf2;color:#0a0a14;border-radius:20px;padding:28px 24px;font-family:'Noto Sans JP',sans-serif;max-width:860px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:900;color:#333"><span style="font-size:1.5em;font-weight:900;color:#6c5ce7">い</span>つもスキしてくれる人</div>
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

// Check when returning from note (tab switch back)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(checkPendingVisit, 800);
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
  const togglesHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;flex-wrap:wrap">
      <div class="toggle-group" id="magazineViewToggle">
        <div class="toggle-btn${magazineView==='magazine'?' active':''}" data-view="magazine">マガジン別</div>
        <div class="toggle-btn${magazineView==='article'?' active':''}" data-view="article">記事別</div>
      </div>
      <div class="toggle-group" id="magazinePeriodToggle">
        <div class="toggle-btn${magazinePeriod==='week'?' active':''}" data-period="week">今週</div>
        <div class="toggle-btn${magazinePeriod==='lastweek'?' active':''}" data-period="lastweek">先週</div>
        <div class="toggle-btn${magazinePeriod==='month'?' active':''}" data-period="month">今月</div>
        <div class="toggle-btn${magazinePeriod==='lastmonth'?' active':''}" data-period="lastmonth">先月</div>
        <div class="toggle-btn${magazinePeriod==='all'?' active':''}" data-period="all">全期間</div>
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
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = [];
    let current = '';
    let inQuotes = false;
    for (let c of line) {
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { vals.push(current); current = ''; }
      else { current += c; }
    }
    vals.push(current);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
    return obj;
  });
}

// ===== Data Loading =====
async function loadData(urlname) {
  creatorUrlname = urlname;
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

const APP_VERSION = '0.5.7';
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

init();
