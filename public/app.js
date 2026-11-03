"use strict";
// Dealdle client. Hash routes: #/ play, #/leaderboard, #/badges, #/friends, #/u/<name>, #/about.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Number(n || 0).toLocaleString("en-US");
const view = $("#view");

let guestId = null;
try {
  guestId = localStorage.getItem("dd_guest");
  if (!guestId) { guestId = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("dd_guest", guestId); }
} catch { guestId = crypto.randomUUID().replace(/-/g, ""); }

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Guest-Id": guestId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

let me = null, badgeInfo = {};

// ---------- rendering helpers ----------
function cardHtml(c, cls = "") {
  if (c == null) return `<div class="card back ${cls}"></div>`;
  const r = Engine.RANKS[c % 13], s = Engine.SUIT_SYMBOL[Engine.SUITS[Engine.suit(c)]];
  return `<div class="card ${Engine.red(c) ? "red" : ""} ${cls}" aria-label="${r}${s}">
    <div class="corner">${r}<small>${s}</small></div><div class="pip">${s}</div><div class="corner br">${r}<small>${s}</small></div></div>`;
}
const miniHand = cards => `<div class="hand mini">${cards.map(c => cardHtml(c)).join("")}</div>`;

function chip(b) {
  const info = badgeInfo[b.id] || {};
  return `<a class="chip ${info.rarity || ""} ${b.scoring === false ? "off" : ""}" href="#/badges" title="${esc(info.desc)}${b.scoring === false ? " (doesn't stack with a better badge in its family)" : ""}">
    ${info.emoji || ""} ${esc(info.name || b.id)} <b>${fmt(b.score)}</b></a>`;
}
const userLink = u => (u ? `<a href="#/u/${encodeURIComponent(u.name)}">${esc(u.name)}</a>` : "guest");
const heartBtn = r => `<button class="heart ${r.hearted ? "on" : ""}" data-heart="${r.id}">${r.hearted ? "♥" : "♡"} ${r.hearts}</button>`;

function countdown(ms) {
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function shareText(r) {
  const suits = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const sq = { Trash: "⬛", Common: "⬜", Uncommon: "🟩", Rare: "🟦", Epic: "🟪", Anomaly: "🟧", Mythic: "🟨" };
  const cards = r.final.map(c => Engine.RANKS[c % 13] + suits[Engine.SUITS[Engine.suit(c)]]).join(" ");
  const top = 100 - Engine.percentile(r.total);
  const topText = top <= 0 ? "" : ` • Top ${top < 1 ? +top.toFixed(2) : Math.ceil(top)}%`;
  const seen = new Set();
  const badges = r.badges.filter(b => b.scoring).sort((a, b) => b.score - a.score).filter(b => {
    const name = (badgeInfo[b.id] || {}).name || b.id;
    return !seen.has(name) && seen.add(name);
  });
  const lines = badges.slice(0, 3).map(b => { const i = badgeInfo[b.id] || {}; return `${sq[i.rarity] || "⬜"} ${i.emoji || ""} ${i.name || b.id}`; });
  if (badges.length > 3) lines.push(`+${badges.length - 3} more`);
  return [`Dealdle 🃏 ${cards}`, "", `${sq[r.rarity]} ${r.rarity.toUpperCase()}${topText}`, ...(r.poem ? ["", `“${r.poem}”`] : []), "", ...lines, "", `${fmt(r.total)} EP`, location.origin + "/"].join("\n");
}

// ---------- play ----------
let state = null, holds = [], timer = null;

async function renderPlay() {
  state = await api("/api/state");
  const r = state.roll;
  const signupHint = !me ? `<p class="small muted"><a href="#" data-auth="signup">Sign up</a> to save your hand and climb the leaderboard.</p>` : "";

  let body;
  if (!r) {
    body = `<div class="hand">${Array(7).fill(0).map(() => cardHtml(null)).join("")}</div>
      <button class="btn primary big" id="deal">DEAL</button>${signupHint}`;
  } else if (!r.final) {
    if (holds.length !== 7) holds = Array(7).fill(false);
    body = `<p class="muted">Tap the cards you want to keep, then draw once.</p>
      <div class="hand" id="hand">${r.dealt.map((c, i) => cardHtml(c, "clickable" + (holds[i] ? " held" : ""))).join("")}</div>
      <div class="preview" id="preview"></div>
      <div class="row" style="margin-top:18px"><button class="btn primary big" id="draw">DRAW</button></div>
      <p class="small muted" id="draw-hint"></p>${signupHint}`;
  } else {
    body = resultHtml(r, true) + signupHint;
  }

  view.innerHTML = `<section class="center">
      <h1>One hand per day.</h1><p class="tagline">Seven cards. Keep what you like, redraw the rest, and see what you've got.</p>
      ${body}
      <p class="small muted">Next deal in <span id="cd">${countdown(state.msToReset)}</span> · ${fmt(state.rollsToday)} hands today</p>
    </section>
    ${state.best ? `<section class="panel center"><h2 class="muted small">TODAY'S BEST HAND</h2>${resultHtml(state.best, false)}</section>` : ""}`;

  if (!r) $("#deal").onclick = async () => { $("#deal").disabled = true; await api("/api/deal", {}); holds = []; animateNext = "deal"; renderPlay(); };
  if (r && !r.final) wireHolds(r);
  if (r && r.final) wireResult(r);
  if (animateNext) { animate(animateNext, r); animateNext = null; }

  clearInterval(timer);
  const end = Date.now() + state.msToReset;
  timer = setInterval(() => {
    const el = $("#cd"); if (!el) return clearInterval(timer);
    const left = end - Date.now(); el.textContent = countdown(Math.max(0, left));
    if (left <= 0) { clearInterval(timer); holds = []; renderPlay(); }
  }, 1000);
}

let animateNext = null;
function animate(kind, r) {
  document.querySelectorAll(".hand:not(.mini)")[0]?.querySelectorAll(".card").forEach((el, i) => {
    if (kind === "draw" && r.hold && r.hold[i]) return;
    el.style.animationDelay = i * 70 + "ms"; el.classList.add("flip");
    // drop the animation once it ends, or its fill would pin the card and block the hold lift
    el.addEventListener("animationend", () => { el.classList.remove("flip"); el.style.animationDelay = ""; }, { once: true });
  });
}

function wireHolds(r) {
  const cards = [...$("#hand").children];
  const update = () => {
    cards.forEach((el, i) => el.classList.toggle("held", holds[i]));
    const n = holds.filter(Boolean).length;
    $("#draw").textContent = n === 7 ? "STAND" : "DRAW " + (7 - n);
    $("#draw-hint").textContent = n === 7 ? "Keeping every card." : "";
    const now = Engine.analyze(r.dealt);
    const top = now.badges.filter(b => b.scoring).slice(0, 3).map(b => badgeInfo[b.id]?.emoji + " " + badgeInfo[b.id]?.name).join(", ");
    $("#preview").textContent = `As dealt: ${fmt(now.total)} EP${top ? " · " + top : ""}`;
  };
  cards.forEach((el, i) => (el.onclick = () => { holds[i] = !holds[i]; update(); }));
  update();
  $("#draw").onclick = async () => {
    $("#draw").disabled = true;
    try { await api("/api/hold", { hold: holds }); animateNext = "draw"; renderPlay(); }
    catch (e) { toast(e.message); $("#draw").disabled = false; }
  };
}

function resultHtml(r, mine) {
  const poemBlock = r.poem ? `<p class="poem">“${esc(r.poem)}”</p>`
    : mine && me ? `<form class="poem-form" id="poem-form"><input name="poem" maxlength="140" placeholder="Write a line about your hand…"><button class="btn small">Post</button></form>`
    : mine ? `<p class="small muted">Sign up to write a poem for your hand.</p>` : "";
  return `${mine ? "" : `<p class="small">dealt to ${userLink(r.owner)} · ${heartBtn(r)}</p>`}
    <div class="hand">${r.final.map((c, i) => cardHtml(c, r.hold && r.hold[i] && mine ? "kept" : "")).join("")}</div>
    <div class="result-total">${fmt(r.total)} EP</div>
    <div class="rarity r-${r.rarity}">${r.rarity}</div>
    <div class="small muted">Better than ${r.pct.toFixed(2)}% of hands</div>
    ${badgeChips(r.badges, mine ? 99 : 10)}
    ${poemBlock}
    ${mine ? `<div class="row"><button class="btn small" id="share">Copy result</button>${r.owner ? heartBtn(r) : ""}</div>` : ""}`;
}

// Scoring badges up front; the ones beaten by a better badge in their family tucked away.
function badgeChips(badges, max) {
  const scoring = badges.filter(b => b.scoring), rest = badges.filter(b => !b.scoring);
  return `<div class="badges">${scoring.slice(0, max).map(chip).join("")}</div>
    ${scoring.length > max ? `<p class="small muted">+${scoring.length - max} more badges</p>` : ""}
    ${rest.length && max > 10 ? `<details class="more"><summary class="small muted">${rest.length} badges that didn't stack</summary>
      <div class="badges">${rest.map(chip).join("")}</div></details>` : ""}`;
}

function wireResult(r) {
  const share = $("#share");
  if (share) share.onclick = async () => { try { await navigator.clipboard.writeText(shareText(r)); toast("Copied!"); } catch { toast("Couldn't copy"); } };
  const form = $("#poem-form");
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/poem", { text: form.poem.value }); renderPlay(); } catch (err) { toast(err.message); }
  };
}

// hearts work anywhere
view.addEventListener("click", async e => {
  const b = e.target.closest("[data-heart]");
  if (!b) return;
  if (!me) return openAuth("signin");
  try {
    const res = await api("/api/heart", { rollId: b.dataset.heart });
    b.classList.toggle("on", res.hearted); b.textContent = (res.hearted ? "♥ " : "♡ ") + res.hearts;
  } catch (err) { toast(err.message); }
});

// ---------- leaderboard ----------
let lbView = "today", lbScope = "global";
async function renderLeaderboard() {
  const tabs = (items, cur, key) => items.map(([v, l]) => `<button data-${key}="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("");
  view.innerHTML = `<h1>Leaderboard</h1>
    <div class="tabs">${tabs([["today", "Today"], ["week", "This week"], ["alltime", "All-time"]], lbView, "v")}
      <span style="flex:1"></span>${tabs([["global", "Global"], ["friends", "Friends"]], lbScope, "s")}</div>
    <div class="panel" id="lb">Loading…</div>`;
  view.querySelectorAll("[data-v]").forEach(b => (b.onclick = () => { lbView = b.dataset.v; renderLeaderboard(); }));
  view.querySelectorAll("[data-s]").forEach(b => (b.onclick = () => { lbScope = b.dataset.s; renderLeaderboard(); }));
  try {
    const { rows } = await api(`/api/leaderboard?view=${lbView}&scope=${lbScope}`);
    $("#lb").innerHTML = !rows.length ? `<p class="muted center">No hands yet.</p>` : `<ol class="lb">${rows.map((row, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || "#" + (i + 1);
      if (lbView === "today") return `<li><span class="rank">${medal}</span>
        <div class="who">${userLink(row.owner)} <span class="rarity r-${row.rarity} small">${row.rarity}</span>${miniHand(row.final)}
          ${row.poem ? `<p class="poem">“${esc(row.poem)}”</p>` : ""}</div>
        <div class="score">${fmt(row.total)} EP<br>${heartBtn(row)}</div></li>`;
      return `<li><span class="rank">${medal}</span>
        <div class="who">${userLink(row.user)} <span class="small muted">· ${row.rolls} hands · 🔥 ${row.streak}</span>
          ${row.best ? `<div class="small muted">best: ${fmt(row.best.total)} EP</div>${miniHand(row.best.final)}` : ""}</div>
        <div class="score">${fmt(row.total)} EP</div></li>`;
    }).join("")}</ol>`;
  } catch (e) {
    $("#lb").innerHTML = `<p class="center muted">${esc(e.message)}</p>`;
  }
}

// ---------- badges ----------
async function renderBadges() {
  const list = Object.values(badgeInfo).sort((a, b) => a.score - b.score);
  const tiers = ["All", "Common", "Uncommon", "Rare", "Epic", "Anomaly", "Mythic"];
  let owned = {};
  if (me) try { owned = (await api("/api/profile?name=" + encodeURIComponent(me.name))).collection || {}; } catch {}
  const ownTabs = me ? `<div class="tabs" style="margin:0">${["All", "Collected", "Missing"].map(t => `<button data-own="${t}" class="${t === "All" ? "on" : ""}">${t}</button>`).join("")}</div>` : "";
  view.innerHTML = `<h1>Badges</h1><p class="muted">${fmt(list.length)} badges. EP is based on how often a badge shows up in a random seven-card deal.
    Badges in the same family don't stack: only the best one scores.</p>
    <div class="row" style="justify-content:flex-start;margin-bottom:12px"><input id="bsearch" placeholder="Search badges…" style="flex:1;min-width:180px">
      <div class="tabs" style="margin:0">${tiers.map(t => `<button data-tier="${t}" class="${t === "All" ? "on" : ""}">${t}</button>`).join("")}</div>${ownTabs}</div>
    <p class="small muted" id="bcount"></p>
    <div class="collection" id="blist">${list.map(b => `<div class="bcard" data-tier="${b.rarity}" data-own="${owned[b.id] ? 1 : 0}" data-text="${esc((b.name + " " + b.desc).toLowerCase())}"><span class="e">${b.emoji}</span><div>
      <div class="t">${esc(b.name)} <span class="chip ${b.rarity}" style="padding:1px 6px;font-size:11px">${b.rarity}</span></div>
      <div class="d">${esc(b.desc)}</div><div class="d mono">${fmt(b.score)} EP · ${pctText(b.p)}${owned[b.id] ? ` · ✓ ×${owned[b.id]}` : ""}</div></div></div>`).join("")}</div>`;
  let tier = "All", own = "All";
  const filter = () => {
    const q = $("#bsearch").value.trim().toLowerCase();
    let n = 0;
    for (const el of $("#blist").children) {
      const show = (tier === "All" || el.dataset.tier === tier) && (!q || el.dataset.text.includes(q))
        && (own === "All" || (el.dataset.own === "1") === (own === "Collected"));
      el.hidden = !show; n += show;
    }
    $("#bcount").textContent = `Showing ${fmt(n)}` + (me ? ` · you have ${fmt(list.filter(b => owned[b.id]).length)} of ${fmt(list.length)}` : "");
  };
  $("#bsearch").oninput = filter;
  view.querySelectorAll("[data-tier]").forEach(b => b.tagName === "BUTTON" && (b.onclick = () => {
    tier = b.dataset.tier; view.querySelectorAll("button[data-tier]").forEach(x => x.classList.toggle("on", x === b)); filter();
  }));
  view.querySelectorAll("button[data-own]").forEach(b => (b.onclick = () => {
    own = b.dataset.own; view.querySelectorAll("button[data-own]").forEach(x => x.classList.toggle("on", x === b)); filter();
  }));
  filter();
}
const pctText = p => (p >= 0.001 ? (p * 100).toFixed(2) + "%" : "1 in " + fmt(Math.round(1 / p)));

// ---------- profile ----------
async function renderProfile(name) {
  view.innerHTML = "Loading…";
  let p;
  try { p = await api("/api/profile?name=" + encodeURIComponent(name)); } catch (e) { view.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const rel = { none: `<button class="btn primary small" data-friend="add">Add friend</button>`,
    outgoing: `<button class="btn small" data-friend="remove">Cancel request</button>`,
    incoming: `<button class="btn primary small" data-friend="add">Accept friend request</button>`,
    friends: `<button class="btn small" data-friend="remove">Remove friend</button>` }[p.relation] || "";
  const all = Object.values(badgeInfo).sort((a, b) => a.score - b.score);
  const got = all.filter(b => p.collection[b.id]).length;
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>${esc(p.user.name)}</h1>${me ? rel : ""}</div>
    <p class="muted small">Joined ${new Date(p.joined).toLocaleDateString()} · ${p.friends} friends</p>
    <div class="stats">
      <div class="stat"><b>${fmt(p.lifetime)}</b><span class="muted small">lifetime EP</span></div>
      <div class="stat"><b>${p.rolls}</b><span class="muted small">hands played</span></div>
      <div class="stat"><b>🔥 ${p.streak}</b><span class="muted small">day streak</span></div>
      <div class="stat"><b>${got}/${all.length}</b><span class="muted small">badges found</span></div>
    </div>
    ${p.best ? `<div class="panel center"><h2 class="muted small">BEST HAND · ${p.best.day}</h2>${resultHtml(p.best, false)}</div>` : ""}
    <div class="panel"><h2>Recent hands</h2>${p.recent.length ? `<ol class="lb">${p.recent.map(r => `<li><span class="rank small">${r.day.slice(5)}</span>
      <div class="who">${miniHand(r.final)}${r.poem ? `<p class="poem">“${esc(r.poem)}”</p>` : ""}</div>
      <div class="score">${fmt(r.total)} EP<br><span class="rarity r-${r.rarity} small">${r.rarity}</span></div></li>`).join("")}</ol>` : `<p class="muted">No hands yet.</p>`}</div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h2>Badge collection</h2>
      <label class="small muted"><input type="checkbox" id="show-locked" style="width:auto"> show missing</label></div>
      <div class="collection" id="coll">${all.map(b => `<div class="bcard ${p.collection[b.id] ? "" : "locked"}" ${p.collection[b.id] ? "" : "hidden"}>
      <span class="e">${b.emoji}</span><div><div class="t">${esc(b.name)}</div><div class="d">${p.collection[b.id] ? "×" + p.collection[b.id] : esc(b.rarity)}</div></div></div>`).join("")}</div>
      ${got ? "" : `<p class="muted">No badges yet.</p>`}</div>`;
  $("#show-locked").onchange = e => $("#coll").querySelectorAll(".locked").forEach(el => (el.hidden = !e.target.checked));
  view.querySelectorAll("[data-friend]").forEach(btn => (btn.onclick = async () => {
    try { await api("/api/friends/" + btn.dataset.friend, { username: p.user.name }); renderProfile(name); refreshAccount(); }
    catch (e) { toast(e.message); }
  }));
}

// ---------- friends ----------
async function renderFriends() {
  if (!me) {
    view.innerHTML = `<h1>Friends</h1><div class="panel center"><p>Sign in to add friends and compare hands.</p>
      <button class="btn primary" data-auth="signin">Sign in</button></div>`;
    return;
  }
  const f = await api("/api/friends");
  const line = (x, actions) => `<li><span class="rank">${x.today ? "✅" : "⏳"}</span><div class="who">${userLink(x.user)}
      <div class="small muted">${x.today ? `today: ${fmt(x.today.total)} EP · <span class="r-${x.today.rarity}">${x.today.rarity}</span>` : "hasn't played today"}</div></div>
      <div class="row">${actions}</div></li>`;
  const btn = (act, name, label, cls = "") => `<button class="btn small ${cls}" data-act="${act}" data-name="${esc(name)}">${label}</button>`;
  view.innerHTML = `<h1>Friends</h1>
    <form class="panel row" id="add-friend"><input name="username" placeholder="Friend's username" required style="flex:1"><button class="btn primary">Add friend</button></form>
    ${f.incoming.length ? `<div class="panel"><h2>Requests</h2><ol class="lb">${f.incoming.map(x => line(x, btn("add", x.user.name, "Accept", "primary") + btn("remove", x.user.name, "Decline"))).join("")}</ol></div>` : ""}
    <div class="panel"><h2>Your friends (${f.friends.length})</h2>${f.friends.length ? `<ol class="lb">${f.friends
      .sort((a, b) => (b.today?.total || -1) - (a.today?.total || -1)).map(x => line(x, btn("remove", x.user.name, "Remove"))).join("")}</ol>`
      : `<p class="muted">No friends yet. Add someone by their username.</p>`}
      <p class="small"><a href="#/leaderboard" id="friends-lb">See the friends leaderboard →</a></p></div>
    ${f.outgoing.length ? `<div class="panel"><h2>Sent requests</h2><ol class="lb">${f.outgoing.map(x => line(x, btn("remove", x.user.name, "Cancel"))).join("")}</ol></div>` : ""}`;
  $("#friends-lb").onclick = () => { lbScope = "friends"; };
  $("#add-friend").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/friends/add", { username: e.target.username.value.trim() }); toast("Request sent"); renderFriends(); }
    catch (err) { toast(err.message); }
  };
  view.querySelectorAll("[data-act]").forEach(b => (b.onclick = async () => {
    try { await api("/api/friends/" + b.dataset.act, { username: b.dataset.name }); renderFriends(); refreshAccount(); }
    catch (err) { toast(err.message); }
  }));
}

// ---------- about ----------
function renderAbout() {
  view.innerHTML = `<h1>What is Dealdle?</h1>
    <div class="panel"><p>Every day you get one hand of seven playing cards. Each card is drawn from its own full deck, so duplicates
      (even the exact same card twice) can happen.</p>
      <ol><li><b>Deal</b>: get your seven cards.</li><li><b>Hold</b>: tap the cards you want to keep.</li>
      <li><b>Draw</b>: everything you didn't hold is replaced, once.</li><li><b>Score</b>: your final hand is checked for
      <a href="#/badges">${Object.keys(badgeInfo).length} badges</a> worth EP (edge points).</li></ol>
      <p>Badges cover poker hands, suits, sums, famous cards, the order of your cards, and more. Rare badges are worth far more EP.
      Some badges belong to a family (like Pair → Three of a Kind → Four of a Kind) and only the best one in a family scores.</p>
      <p>Your hand's rarity compares its total EP with other hands: Trash (bottom 1%), Common, Uncommon (top 50%), Rare (top 25%),
      Epic (top 10%), Anomaly (top 5%) and Mythic (top 1%).</p>
      <p>Sign up to keep your lifetime score, build a streak, collect badges, write a poem for your hand, and add friends.
      A new day starts at midnight UTC.</p></div>`;
}

// ---------- account ----------
let authMode = "signin";
function openAuth(mode) {
  authMode = mode;
  $("#auth-title").textContent = $("#auth-submit").textContent = mode === "signin" ? "Sign in" : "Sign up";
  $("#auth-switch").textContent = mode === "signin" ? "No account? Sign up" : "Have an account? Sign in";
  $("#auth-form").password.autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("#auth-error").textContent = "";
  $("#auth").showModal();
}
$("#auth-switch").onclick = e => { e.preventDefault(); openAuth(authMode === "signin" ? "signup" : "signin"); };
$("#auth-close").onclick = () => $("#auth").close();
$("#auth-form").onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const res = await api(authMode === "signin" ? "/api/login" : "/api/signup", { username: f.username.value.trim(), password: f.password.value });
    me = res.user; f.reset(); $("#auth").close(); refreshAccount(); route();
    toast(authMode === "signin" ? `Welcome back, ${me.name}` : `Welcome, ${me.name}!`);
  } catch (err) { $("#auth-error").textContent = err.message; }
};
document.addEventListener("click", e => {
  const a = e.target.closest("[data-auth]");
  if (a) { e.preventDefault(); openAuth(a.dataset.auth); }
});

async function refreshAccount() {
  const s = await api("/api/state");
  me = s.user;
  $("#account").innerHTML = me
    ? `<a href="#/u/${encodeURIComponent(me.name)}"><b>${esc(me.name)}</b></a><button class="btn small" id="logout">Sign out</button>`
    : `<button class="btn small" data-auth="signin">Sign in</button><button class="btn primary small" data-auth="signup">Sign up</button>`;
  $("#nav-friends").innerHTML = "Friends" + (s.friendRequests ? `<span class="pill">${s.friendRequests}</span>` : "");
  const lo = $("#logout");
  if (lo) lo.onclick = async () => { await api("/api/logout", {}); me = null; refreshAccount(); route(); };
}

// ---------- router ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  document.querySelectorAll(".top nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#/" + h.split("/")[0]));
  try {
    if (h.startsWith("u/")) await renderProfile(decodeURIComponent(h.slice(2)));
    else if (h === "leaderboard") await renderLeaderboard();
    else if (h === "badges") await renderBadges();
    else if (h === "friends") await renderFriends();
    else if (h === "about") renderAbout();
    else await renderPlay();
  } catch (e) { view.innerHTML = `<p class="center">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}

(async function init() {
  const [stats, b] = await Promise.all([fetch("/shared/stats.json").then(r => r.json()), api("/api/badges")]);
  Engine.setStats(stats);
  badgeInfo = Object.fromEntries(b.badges.map(x => [x.id, x]));
  await refreshAccount();
  window.addEventListener("hashchange", route);
  route();
})();
