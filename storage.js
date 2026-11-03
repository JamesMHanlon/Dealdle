"use strict";
// Persistence for the in-memory db. The server keeps everything in memory and calls save() after changes.
//  - DATABASE_URL set (e.g. a free Neon or Supabase Postgres): each user, session, roll and friendship is a row
//    in one table, and only rows that changed since the last save are written.
//  - Otherwise: DATA_DIR/db.json (default ./data), for local testing.
const fs = require("fs");
const path = require("path");

const EMPTY = () => ({ users: {}, sessions: {}, rolls: {}, friends: [] });
const COLLECTIONS = ["users", "sessions", "rolls", "friends"];
const docKey = (coll, doc, key) => (coll === "friends" ? doc.from + "|" + doc.to : key);

function fileStore() {
  const dir = process.env.DATA_DIR || path.join(__dirname, "data"), file = path.join(dir, "db.json");
  return {
    kind: "file " + file,
    async load() {
      fs.mkdirSync(dir, { recursive: true });
      return fs.existsSync(file) ? { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, "utf8")) } : EMPTY();
    },
    async write(db) {
      fs.writeFileSync(file + ".tmp", JSON.stringify(db));
      fs.renameSync(file + ".tmp", file);
    },
  };
}

function pgStore(url) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 3 });
  const saved = new Map(); // "coll|key" -> JSON last written
  return {
    kind: "postgres",
    async load() {
      await pool.query(`CREATE TABLE IF NOT EXISTS dealdle_docs (
        coll text NOT NULL, key text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (coll, key))`);
      const db = EMPTY();
      for (const { coll, key, data } of (await pool.query("SELECT coll, key, data FROM dealdle_docs")).rows) {
        if (coll === "friends") db.friends.push(data); else if (db[coll]) db[coll][key] = data;
        saved.set(coll + "|" + key, JSON.stringify(data));
      }
      return db;
    },
    async write(db) {
      const now = new Map();
      for (const coll of COLLECTIONS) {
        const entries = coll === "friends" ? db.friends.map(d => [null, d]) : Object.entries(db[coll]);
        for (const [key, doc] of entries) now.set(coll + "|" + docKey(coll, doc, key), JSON.stringify(doc));
      }
      const upserts = [...now].filter(([k, json]) => saved.get(k) !== json);
      const deletes = [...saved.keys()].filter(k => !now.has(k));
      if (!upserts.length && !deletes.length) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [k, json] of upserts) {
          const i = k.indexOf("|");
          await client.query(`INSERT INTO dealdle_docs (coll, key, data) VALUES ($1, $2, $3)
            ON CONFLICT (coll, key) DO UPDATE SET data = EXCLUDED.data`, [k.slice(0, i), k.slice(i + 1), json]);
        }
        for (const k of deletes) {
          const i = k.indexOf("|");
          await client.query("DELETE FROM dealdle_docs WHERE coll = $1 AND key = $2", [k.slice(0, i), k.slice(i + 1)]);
        }
        await client.query("COMMIT");
        for (const [k, json] of upserts) saved.set(k, json);
        for (const k of deletes) saved.delete(k);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

// Saves are batched: changes within 250 ms go out together, and only one write runs at a time.
function create() {
  const store = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore();
  let db = null, timer = null, writing = Promise.resolve(), dirty = false;
  const flush = () => {
    timer = null;
    if (!dirty) return writing;
    dirty = false;
    writing = writing.then(() => store.write(db)).catch(e => { console.error("Save failed:", e.message); dirty = true; schedule(); });
    return writing;
  };
  const schedule = () => { if (!timer) timer = setTimeout(flush, 250); };
  return {
    kind: store.kind,
    async load() { db = await store.load(); return db; },
    save() { dirty = true; schedule(); },
    async flush() { clearTimeout(timer); await flush(); },
  };
}

module.exports = create();
