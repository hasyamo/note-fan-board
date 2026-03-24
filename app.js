// ===== note fan board =====

// ===== Data =====
let articlesData = [];
let likesData = [];
let followersData = [];
let creatorUrlname = '';

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
const CHAR_FILES = { you: 'tue', rinka: 'thu', runa: 'fri' };
const CHAR_NAMES = { you: '陽（朝の報告）', rinka: '凛華（関係維持 / 辛口）', runa: 'るな（感謝 / 盛り上げ）' };

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
function switchTab(tabName) {
  document.querySelectorAll('.tab-bar-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const tabEl = document.getElementById(tabId);
  if (tabEl) tabEl.classList.add('active');
  history.replaceState(null, '', location.pathname + location.search + '#' + tabName);

  if (tabName === 'today') renderToday();
  if (tabName === 'fans') renderFans();
  if (tabName === 'ranking') renderRanking();
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
    youLine = `久しぶりの人が戻ってきたよ！${returnUsers[0].name}さん、見に行こ！`;
  } else if (newUsers.length > 0) {
    youLine = `昨日、初めての人が来てくれたよ！${newUsers[0].name}さん、覚えておこ！`;
  } else if (regularUsers.length > 0) {
    youLine = `昨日も${regularUsers[0].name}さん来てくれてたよ！いつもありがとだね！`;
  } else if (yesterdayUsers.length >= 5) {
    youLine = `昨日${yesterdayUsers.length}人も来てくれたよ！にぎやかだったね！`;
  } else if (yesterdayUsers.length >= 1) {
    youLine = `昨日${yesterdayUsers.length}人来てくれたよ！一人ひとり、ちゃんと見よ！`;
  } else {
    youLine = `昨日はお休みだったみたい。でも大丈夫、今日の記事で変わるよ！`;
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
  html += `<div class="section">
    <div class="section-title">昨日のスキ速報 <span style="font-weight:400;color:var(--text-muted)">${getDayLabel(yesterday)}</span></div>`;

  if (yesterdayUsers.length > 0) {
    html += yesterdayUsers.map(u => {
      const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
      return `<div class="person">
        <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="person-name"><a href="${profileUrl}" target="_blank" rel="noopener">${u.name}</a></div>
        <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()} followers</div>
      </div>`;
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
  const data = followersData.slice(-28);
  const labels = data.map(d => d.date.slice(5));
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

  const pad = { t: 10, b: 25, l: 36, r: 32 };
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
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(l, pad.l + cw * i / (labels.length - 1), H - 6); });

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

  // Character line (priority: at-risk name > new name > return name > regular name > fallback)
  let rinkaLine;
  if (atRiskUsers.length >= 3) {
    rinkaLine = `……${atRiskUsers[0].name}さん含め${atRiskUsers.length}人、最近来てないわよ。放っておくの？`;
  } else if (atRiskUsers.length >= 1) {
    rinkaLine = `${atRiskUsers[0].name}さん、最近来てないわ。……気づいてる？`;
  } else if (returnList.length >= 1) {
    rinkaLine = `${returnList[0].name}さんが戻ってきたわ。……ちゃんと覚えてなさいよ。`;
  } else if (newList.length >= 3) {
    rinkaLine = `新しい人が${newList.length}人。……悪くないわね。`;
  } else if (newList.length >= 1) {
    rinkaLine = `${newList[0].name}さんが初めて来たわ。……ちゃんと覚えなさい。`;
  } else {
    rinkaLine = `今週のスキ、ちゃんと確認しなさい。`;
  }

  let html = naviHTML('rinka', rinkaLine);

  // Tabs (5 tabs including at-risk)
  const atRiskListHTML = atRiskUsers.length > 0 ? atRiskUsers.slice(0, 15).map(u => {
    const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
    return `<div class="person">
      <img class="person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
      <div class="person-name">
        <a href="${profileUrl}" target="_blank" rel="noopener">${u.name}</a>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">最終スキ: ${u.lastSeen}</div>
      </div>
      <div class="person-stats">${u.followerCount.toLocaleString()} followers</div>
    </div>`;
  }).join('') : '<div class="no-data">離脱危機なし</div>';

  html += `<div class="section">
    <div class="section-title">今週のスキしてくれた人 <span style="font-weight:400;color:var(--text-muted)">${range.start}〜${range.end}</span></div>
    <div class="people-tabs">
      <div class="people-tab active" onclick="switchPeopleTab(this,'new')">新規<br>(${newList.length})</div>
      <div class="people-tab" onclick="switchPeopleTab(this,'return')">復帰<br>(${returnList.length})</div>
      <div class="people-tab" onclick="switchPeopleTab(this,'regular')">常連<br>(${regList.length})</div>
      <div class="people-tab" onclick="switchPeopleTab(this,'occasional')">たまに<br>(${occasionalList.length})</div>
      <div class="people-tab" onclick="switchPeopleTab(this,'atrisk')" style="color:var(--accent-amber)">離脱危機<br>(${atRiskUsers.length})</div>
    </div>
    <div class="people-content active" data-tab="new">${personListHTML(newList, '新規スキなし')}</div>
    <div class="people-content" data-tab="return" style="display:none">${personListHTML(returnList, '復帰なし')}</div>
    <div class="people-content" data-tab="regular" style="display:none">${personListHTML(regList, '常連なし')}</div>
    <div class="people-content" data-tab="occasional" style="display:none">${personListHTML(occasionalList, '該当なし')}</div>
    <div class="people-content" data-tab="atrisk" style="display:none">${atRiskListHTML}</div>
  </div>`;

  el.innerHTML = html;
  loadAvatars();
}

function personListHTML(list, emptyMsg) {
  if (list.length === 0) return `<div class="no-data">${emptyMsg}</div>`;
  return list.slice(0, 20).map(u => {
    const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
    const avatarClass = 'person-avatar' + (u.category === 'regular' ? ' regular' : '');
    const returnStatus = getSukiReturnStatus(u.urlname);
    const statusHTML = returnStatus.liked
      ? '<div style="color:var(--accent-green);font-size:11px">✅ スキ返し済</div>'
      : '<div style="color:var(--accent-amber);font-size:11px">❌ 未スキ返し</div>';
    return `<div class="person">
      <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
      <div class="person-name"><a href="${profileUrl}" target="_blank" rel="noopener" onclick="setPendingVisit('${u.urlname}','${u.name}')">${u.name}</a></div>
      <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()} followers<br>${statusHTML}</div>
    </div>`;
  }).join('');
}

function switchPeopleTab(btn, tab) {
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
      runaLine = `${tiedCount}人が同率1位！みんなありがとー！`;
    } else if (newCount >= 3) {
      runaLine = `新しい人が${newCount}人もランクインしてるよ！広がってるね！`;
    } else if (regCount >= 10) {
      runaLine = `常連さんが${regCount}人！安定感あるね！`;
    } else {
      runaLine = `${ranked[0].name}さんがトップだよ！いつもありがとね！`;
    }
  } else {
    runaLine = `まだスキがないみたい。これからだよ！`;
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
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${getDayLabel(range.start)}〜${getDayLabel(range.end)}</div>`;

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
  return `<div class="person">
    <div class="person-rank">${rank}</div>
    <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
    <div class="person-name"><a href="${profileUrl}" target="_blank" rel="noopener">${u.name}</a>${badge}</div>
    <div class="person-stats">${u.count}スキ<br>${u.followerCount.toLocaleString()}<br>followers</div>
    <div class="person-score">${Math.round(u.score * 2)}<span>pt</span></div>
  </div>`;
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

function handleReturnAnswer(urlname, liked, btn) {
  if (liked) setSukiReturnStatus(urlname, true);
  btn.closest('.modal-overlay').remove();
  // Refresh fans tab if active
  const fansTab = document.getElementById('tabFans');
  if (fansTab && fansTab.classList.contains('active')) renderFans();
}

// Check when returning from note (tab switch back)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(checkPendingVisit, 300);
});

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

  try {
    // Articles
    const artRes = await fetch(base + 'articles.csv' + cacheBust);
    if (artRes.ok) {
      articlesData = parseCSV(await artRes.text()).map(r => ({
        key: r.key, title: r.title || '', published_at: r.published_at || '',
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
  } catch(e) {
    console.error('Data load error:', e);
  }
}

// ===== Init =====
async function init() {
  // Get urlname from path: /note-fan-board/hasyamo/ → hasyamo
  const pathParts = location.pathname.replace(/\/$/, '').split('/');
  const repoIdx = pathParts.indexOf('note-fan-board');
  let urlname = repoIdx >= 0 && pathParts.length > repoIdx + 1 ? pathParts[repoIdx + 1] : '';

  // Local dev: fallback to query param or default
  if (!urlname || urlname === 'index.html') {
    const params = new URLSearchParams(location.search);
    urlname = params.get('user') || 'hasyamo';
  }

  // Check if creator exists
  try {
    const creatorsRes = await fetch('./data/creators.csv?t=' + Date.now());
    if (creatorsRes.ok) {
      const creators = parseCSV(await creatorsRes.text()).map(r => r.urlname);
      if (!creators.includes(urlname)) {
        document.querySelector('.app').innerHTML = `
          <div style="text-align:center;padding:60px 20px">
            <h2 style="color:var(--accent-pink);margin-bottom:12px">このユーザーは登録されていません</h2>
            <p style="color:var(--text-muted);font-size:13px">note fan boardを使いたい方は、<a href="https://twitter.com/ohayo_kanojo" target="_blank">@ohayo_kanojo</a> にDMください。</p>
          </div>`;
        return;
      }
    }
  } catch(e) {}

  await loadData(urlname);

  // Update header
  document.getElementById('creatorName').textContent = urlname;
  if (followersData.length > 0) {
    document.getElementById('followerCount').textContent = followersData[followersData.length - 1].follower_count;
  }
  if (articlesData.length > 0) {
    document.getElementById('lastUpdate').textContent = articlesData[0].date || '--';
  }

  // Render active tab
  const hash = location.hash.replace('#', '');
  if (hash && document.querySelector(`.tab-bar-btn[data-tab="${hash}"]`)) {
    switchTab(hash);
  } else {
    renderToday();
  }

  // Register service worker (production only)
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
