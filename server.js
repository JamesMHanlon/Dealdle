"use strict";
// Dealdle server: serves the game and the API. Node 18+.
// Data lives in Postgres when DATABASE_URL is set, otherwise in ./data/db.json (see storage.js).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Engine = require("./shared/engine");
const store = require("./storage");
Engine.setStats(require("./shared/stats.json"));

const PORT = Number(process.env.PORT) || 3000;
const SECURE_COOKIE = process.env.NODE_ENV === "production";
const POEM_MAX = 140;

// ---------- storage ----------
let db = null; // loaded before the server starts listening
const save = () => store.save();

// roll lookup: "u:<userId>|<day>" or "g:<guestId>|<day>" -> rollId
const rollKey = new Map();
const keyOf = (r) => (r.owner ? "u:" + r.owner : "g:" + r.guest) + "|" + r.day;

// ---------- helpers ----------
const id = (n = 12) => crypto.randomBytes(n).toString("base64url");
const today = () => new Date().toISOString().slice(0, 10);
function weekStart(day) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function prevDay(day) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
const drawCard = () => crypto.randomInt(52);
const userByName = (name) => Object.values(db.users).find(u => u.nameLower === String(name || "").toLowerCase());
const publicUser = (u) => u && { id: u.id, name: u.name };

function hashPassword(pw, salt = id(16)) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString("base64") };
}
function checkPassword(u, pw) {
  const h = crypto.scryptSync(pw, u.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(u.hash, "base64"));
}

function friendship(a, b) { return db.friends.find(f => (f.from === a && f.to === b) || (f.from === b && f.to === a)); }
function friendIds(uid) {
  return db.friends.filter(f => f.accepted && (f.from === uid || f.to === uid)).map(f => (f.from === uid ? f.to : f.from));
}

function rollView(r, viewer) {
  if (!r) return null;
  const owner = r.owner ? db.users[r.owner] : null;
  const out = { id: r.id, day: r.day, owner: publicUser(owner), dealt: r.dealt, hearts: r.hearts.length,
    hearted: !!viewer && r.hearts.includes(viewer.id) };
  if (r.final) Object.assign(out, { final: r.final, hold: r.hold, badges: r.badges, total: r.total, pct: r.pct,
    rarity: Engine.rarityOf(r.pct), poem: r.poem || null });
  return out;
}

function finishedRolls(filter) { return Object.values(db.rolls).filter(r => r.final && r.owner && filter(r)); }

function streakOf(uid) {
  let day = today(), n = 0;
  if (!rollKey.has("u:" + uid + "|" + day)) day = prevDay(day);
  while (rollKey.has("u:" + uid + "|" + day)) { n++; day = prevDay(day); }
  return n;
}

// ---------- http plumbing ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(s => s.trim().split("=")).filter(p => p[0]).map(([k, v]) => [k, decodeURIComponent(v || "")]));
}
function sessionCookie(token, maxAge) {
  return `dd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (SECURE_COOKIE ? "; Secure" : "");
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 10_000) { reject(new HttpError(413, "Too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, "Bad JSON")); } });
  });
}

// Simple per-IP limiter for sign-in attempts.
const attempts = new Map();
function limit(req, max = 10, windowMs = 60_000) {
  // behind a host's proxy the real client is the first X-Forwarded-For entry
  const fwd = SECURE_COOKIE && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || req.socket.remoteAddress, now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < windowMs);
  if (a.length >= max) fail(429, "Too many attempts. Wait a minute and try again.");
  a.push(now); attempts.set(ip, a);
}

// ---------- API ----------
const routes = {};
const route = (method, p, fn) => { routes[method + " " + p] = fn; };

function myRoll(ctx) {
  const key = ctx.user ? "u:" + ctx.user.id + "|" + today() : ctx.guest ? "g:" + ctx.guest + "|" + today() : null;
  return key && rollKey.has(key) ? db.rolls[rollKey.get(key)] : null;
}

route("GET", "/api/state", (ctx) => {
  const day = today();
  const todays = finishedRolls(r => r.day === day);
  const best = todays.sort((a, b) => b.total - a.total || a.finishedAt - b.finishedAt)[0];
  const tomorrow = new Date(day + "T00:00:00Z"); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const pending = ctx.user ? db.friends.filter(f => !f.accepted && f.to === ctx.user.id).length : 0;
  return { user: publicUser(ctx.user), day, msToReset: tomorrow - Date.now(), roll: rollView(myRoll(ctx), ctx.user),
    rollsToday: todays.length, best: rollView(best, ctx.user), friendRequests: pending };
});

route("POST", "/api/deal", (ctx) => {
  if (!ctx.user && !ctx.guest) fail(400, "Missing guest id");
  const existing = myRoll(ctx);
  if (existing) return { roll: rollView(existing, ctx.user) };
  const r = { id: id(9), day: today(), owner: ctx.user ? ctx.user.id : null, guest: ctx.user ? null : ctx.guest,
    dealt: Array.from({ length: Engine.HAND_SIZE }, drawCard), final: null, hearts: [], createdAt: Date.now() };
  db.rolls[r.id] = r; rollKey.set(keyOf(r), r.id); save();
  return { roll: rollView(r, ctx.user) };
});

route("POST", "/api/hold", (ctx, body) => {
  const r = myRoll(ctx);
  if (!r) fail(400, "Deal first.");
  if (r.final) fail(400, "You've already played today.");
  const hold = Array.isArray(body.hold) && body.hold.length === Engine.HAND_SIZE ? body.hold.map(Boolean) : fail(400, "Bad hold");
  r.hold = hold;
  r.final = r.dealt.map((c, i) => (hold[i] ? c : drawCard()));
  const result = Engine.analyze(r.final);
  r.badges = result.badges; r.total = result.total; r.pct = Engine.percentile(result.total);
  r.finishedAt = Date.now(); save();
  return { roll: rollView(r, ctx.user) };
});

route("POST", "/api/poem", (ctx, body) => {
  const r = myRoll(ctx);
  if (!r || !r.final) fail(400, "Finish today's hand first.");
  const text = String(body.text || "").replace(/\s+/g, " ").trim();
  if (!text) fail(400, "Write something first.");
  if (text.length > POEM_MAX) fail(400, `Keep it under ${POEM_MAX} characters.`);
  r.poem = text; save();
  return { roll: rollView(r, ctx.user) };
});

route("POST", "/api/heart", (ctx, body) => {
  if (!ctx.user) fail(401, "Sign in to heart rolls.");
  const r = db.rolls[body.rollId];
  if (!r || !r.final) fail(404, "Roll not found.");
  const i = r.hearts.indexOf(ctx.user.id);
  if (i >= 0) r.hearts.splice(i, 1); else r.hearts.push(ctx.user.id);
  save();
  return { hearts: r.hearts.length, hearted: i < 0 };
});

function startSession(user) {
  const token = id(24);
  db.sessions[token] = { userId: user.id, created: Date.now() };
  save();
  return sessionCookie(token, 60 * 60 * 24 * 365);
}

route("POST", "/api/signup", (ctx, body, req) => {
  limit(req);
  const name = String(body.username || "").trim(), pw = String(body.password || "");
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) fail(400, "Usernames are 3-20 letters, numbers or underscores.");
  if (pw.length < 6) fail(400, "Passwords need at least 6 characters.");
  if (userByName(name)) fail(409, "That username is taken.");
  const u = { id: id(9), name, nameLower: name.toLowerCase(), ...hashPassword(pw), created: Date.now() };
  db.users[u.id] = u;
  // A new account takes over the hand it played as a guest today.
  const gk = ctx.guest && "g:" + ctx.guest + "|" + today();
  if (gk && rollKey.has(gk)) {
    const r = db.rolls[rollKey.get(gk)];
    rollKey.delete(gk); r.owner = u.id; r.guest = null; rollKey.set(keyOf(r), r.id);
  }
  return { body: { user: publicUser(u) }, headers: { "Set-Cookie": startSession(u) } };
});

route("POST", "/api/login", (ctx, body, req) => {
  limit(req);
  const u = userByName(body.username);
  if (!u || !checkPassword(u, String(body.password || ""))) fail(401, "Wrong username or password.");
  return { body: { user: publicUser(u) }, headers: { "Set-Cookie": startSession(u) } };
});

route("POST", "/api/logout", (ctx) => {
  if (ctx.token) { delete db.sessions[ctx.token]; save(); }
  return { body: { ok: true }, headers: { "Set-Cookie": sessionCookie("", 0) } };
});

route("GET", "/api/leaderboard", (ctx, _b, _r, q) => {
  const view = q.get("view") || "today", scope = q.get("scope") || "global";
  let allowed = null;
  if (scope === "friends") {
    if (!ctx.user) fail(401, "Sign in to see your friends.");
    allowed = new Set([ctx.user.id, ...friendIds(ctx.user.id)]);
  }
  const day = today(), ws = weekStart(day);
  const inView = r => (view === "today" ? r.day === day : view === "week" ? r.day >= ws : true);
  const rolls = finishedRolls(r => inView(r) && (!allowed || allowed.has(r.owner)));

  if (view === "today") {
    const rows = rolls.sort((a, b) => b.total - a.total || a.finishedAt - b.finishedAt).slice(0, 100);
    return { view, rows: rows.map(r => rollView(r, ctx.user)) };
  }
  const per = new Map();
  for (const r of rolls) {
    const e = per.get(r.owner) || { user: publicUser(db.users[r.owner]), total: 0, rolls: 0, best: null };
    e.total += r.total; e.rolls++;
    if (!e.best || r.total > e.best.total) e.best = r;
    per.set(r.owner, e);
  }
  const rows = [...per.values()].sort((a, b) => b.total - a.total).slice(0, 100)
    .map(e => ({ ...e, best: rollView(e.best, ctx.user), streak: streakOf(e.user.id) }));
  return { view, rows };
});

route("GET", "/api/profile", (ctx, _b, _r, q) => {
  const u = userByName(q.get("name"));
  if (!u) fail(404, "No player by that name.");
  const rolls = finishedRolls(r => r.owner === u.id).sort((a, b) => (a.day < b.day ? 1 : -1));
  const collection = {};
  for (const r of rolls) for (const b of r.badges) collection[b.id] = (collection[b.id] || 0) + 1;
  let relation = null;
  if (ctx.user && ctx.user.id !== u.id) {
    const f = friendship(ctx.user.id, u.id);
    relation = !f ? "none" : f.accepted ? "friends" : f.from === ctx.user.id ? "outgoing" : "incoming";
  }
  const best = rolls.reduce((m, r) => (!m || r.total > m.total ? r : m), null);
  return { user: publicUser(u), joined: u.created, lifetime: rolls.reduce((t, r) => t + r.total, 0), rolls: rolls.length,
    streak: streakOf(u.id), best: rollView(best, ctx.user), recent: rolls.slice(0, 30).map(r => rollView(r, ctx.user)),
    collection, relation, friends: friendIds(u.id).length };
});

route("GET", "/api/friends", (ctx) => {
  if (!ctx.user) fail(401, "Sign in to add friends.");
  const me = ctx.user.id, day = today();
  const card = uid => {
    const u = db.users[uid], r = rollKey.has("u:" + uid + "|" + day) ? db.rolls[rollKey.get("u:" + uid + "|" + day)] : null;
    return { user: publicUser(u), today: r && r.final ? { total: r.total, rarity: Engine.rarityOf(r.pct) } : null };
  };
  return {
    friends: friendIds(me).map(card),
    incoming: db.friends.filter(f => !f.accepted && f.to === me).map(f => card(f.from)),
    outgoing: db.friends.filter(f => !f.accepted && f.from === me).map(f => card(f.to)),
  };
});

route("POST", "/api/friends/add", (ctx, body) => {
  if (!ctx.user) fail(401, "Sign in to add friends.");
  const other = userByName(body.username);
  if (!other) fail(404, "No player by that name.");
  if (other.id === ctx.user.id) fail(400, "That's you!");
  const f = friendship(ctx.user.id, other.id);
  if (!f) db.friends.push({ from: ctx.user.id, to: other.id, accepted: false, created: Date.now() });
  else if (!f.accepted && f.to === ctx.user.id) f.accepted = true; // they asked first, so this accepts
  save();
  return { ok: true };
});

route("POST", "/api/friends/remove", (ctx, body) => {
  if (!ctx.user) fail(401, "Sign in first.");
  const other = userByName(body.username);
  const f = other && friendship(ctx.user.id, other.id);
  if (f) { db.friends.splice(db.friends.indexOf(f), 1); save(); }
  return { ok: true };
});

route("GET", "/api/badges", () => ({
  badges: Engine.BADGES.map(b => ({ id: b.id, name: b.name, emoji: b.emoji, desc: b.desc, family: b.family || null,
    score: Engine.stats.scores[b.id], p: Engine.stats.probs[b.id], rarity: Engine.badgeRarity(Engine.stats.probs[b.id]) })),
}));

// ---------- static files ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function serveStatic(req, res, pathname) {
  let file;
  if (pathname.startsWith("/shared/")) file = path.join(__dirname, pathname);
  else file = path.join(__dirname, "public", pathname);
  const root = pathname.startsWith("/shared/") ? path.join(__dirname, "shared") : path.join(__dirname, "public");
  if (!file.startsWith(root)) return send(res, 403, { error: "Forbidden" });
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) file = path.join(__dirname, "public", "index.html"); // client-side routes
    fs.readFile(file, (e, data) => {
      if (e) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, decodeURIComponent(url.pathname));
  const handler = routes[req.method + " " + url.pathname];
  if (!handler) return send(res, 404, { error: "Not found" });
  try {
    if (req.method === "POST" && !String(req.headers["content-type"] || "").includes("application/json")) fail(415, "Send JSON");
    const token = parseCookies(req).dd_session;
    const session = token && db.sessions[token];
    const user = session ? db.users[session.userId] : null;
    const guest = /^[A-Za-z0-9_-]{8,64}$/.test(req.headers["x-guest-id"] || "") ? req.headers["x-guest-id"] : null;
    const body = req.method === "POST" ? await readBody(req) : {};
    const out = await handler({ user, guest, token: session ? token : null }, body, req, url.searchParams);
    if (out && out.body) send(res, 200, out.body, out.headers);
    else send(res, 200, out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : "Server error" });
  }
});

store.load().then(loaded => {
  db = loaded;
  for (const r of Object.values(db.rolls)) rollKey.set(keyOf(r), r.id);
  server.listen(PORT, () => console.log(`Dealdle on http://localhost:${PORT} (data: ${store.kind})`));
}).catch(e => { console.error("Could not load data:", e.message); process.exit(1); });

// Hosts stop idle servers with SIGTERM; write any pending changes first.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => store.flush().finally(() => process.exit(0)));
