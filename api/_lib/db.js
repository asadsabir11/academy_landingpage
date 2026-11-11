// Shared database + helper code for the /api functions.
// Files in folders starting with "_" are not deployed as their own endpoints.
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

let sql = null;
export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    sql = neon(url);
  }
  return sql;
}

// Creates the tables on first use, so no separate migration step is needed.
let ready = null;
export function init() {
  if (!ready) {
    ready = (async () => {
      const q = db();
      await q`CREATE TABLE IF NOT EXISTS stores (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL UNIQUE,
        active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await q`CREATE TABLE IF NOT EXISTS leads (
        id           SERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        email        TEXT NOT NULL,
        phone        TEXT NOT NULL UNIQUE,
        parent_email TEXT,
        level        TEXT NOT NULL CHECK (level IN ('O Level', 'A Level')),
        store_id     INTEGER NOT NULL REFERENCES stores(id),
        booked       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await q`CREATE INDEX IF NOT EXISTS leads_store_idx ON leads (store_id)`;
      // Seed a test store the very first time (only while the table is empty).
      await q`INSERT INTO stores (name, slug)
              SELECT 'Test Book Store', 'test-book-store'
              WHERE NOT EXISTS (SELECT 1 FROM stores)`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export function send(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

export function clean(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Pakistani numbers are stored as 92XXXXXXXXXX so 0300..., +92300... and 92300... match.
export function normalizePhone(v) {
  let d = clean(v, 40).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('03')) d = '92' + d.slice(1);
  if (d.length === 10 && d.startsWith('3')) d = '92' + d;
  return d.length >= 10 && d.length <= 15 ? d : '';
}

export function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'store';
}

// ---- Admin session (signed cookie, keyed by ADMIN_PASSWORD) -----------------
const COOKIE = 'tdt_admin';
const SESSION_HOURS = 12;

function sign(value) {
  return crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || '').update(value).digest('hex');
}

export function passwordMatches(given) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

export function setSession(res) {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  const token = exp + '.' + sign(exp);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
