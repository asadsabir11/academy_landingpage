// /api/admin?action=... -> everything the admin portal needs, behind a password login.
import { db, init, send, clean, slugify, passwordMatches, setSession, clearSession, isAdmin } from './_lib/db.js';

export default async function handler(req, res) {
  const action = clean(req.query.action, 30);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (req.method === 'POST' && action === 'login') {
    if (!process.env.ADMIN_PASSWORD) return send(res, 500, { error: 'ADMIN_PASSWORD is not set on the server.' });
    if (!passwordMatches(body.password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
      return send(res, 401, { error: 'Wrong password.' });
    }
    setSession(res);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && action === 'logout') {
    clearSession(res);
    return send(res, 200, { ok: true });
  }
  if (!isAdmin(req)) return send(res, 401, { error: 'Please log in.' });

  try {
    await init();
    const q = db();

    if (req.method === 'GET' && action === 'data') {
      const stores = await q`
        SELECT s.id, s.name, s.slug, s.active, s.created_at,
               count(l.id)::int AS leads,
               count(l.id) FILTER (WHERE l.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi')::int AS leads_month
        FROM stores s LEFT JOIN leads l ON l.store_id = s.id
        GROUP BY s.id ORDER BY s.name`;
      const leads = await q`
        SELECT l.id, l.name, l.email, l.phone, l.parent_email, l.level, l.booked, l.created_at, l.store_id, s.name AS store
        FROM leads l JOIN stores s ON s.id = l.store_id
        ORDER BY l.created_at DESC LIMIT 10000`;
      return send(res, 200, { stores, leads });
    }

    if (req.method === 'POST' && action === 'addStore') {
      const name = clean(body.name, 80);
      if (name.length < 2) return send(res, 400, { error: 'Please enter the store name.' });
      const [same] = await q`SELECT id FROM stores WHERE lower(name) = lower(${name})`;
      if (same) return send(res, 400, { error: 'A store with this name already exists.' });
      const base = slugify(name);
      const taken = await q`SELECT slug FROM stores WHERE slug = ${base} OR slug LIKE ${base + '-%'}`;
      const used = new Set(taken.map((r) => r.slug));
      let slug = base;
      for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
      const [store] = await q`INSERT INTO stores (name, slug) VALUES (${name}, ${slug}) RETURNING id, name, slug`;
      return send(res, 200, { ok: true, store });
    }

    if (req.method === 'POST' && action === 'updateStore') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return send(res, 400, { error: 'Bad store id.' });
      if (typeof body.name === 'string') {
        const name = clean(body.name, 80);
        if (name.length < 2) return send(res, 400, { error: 'Please enter the store name.' });
        await q`UPDATE stores SET name = ${name} WHERE id = ${id}`;
      }
      if (typeof body.active === 'boolean') await q`UPDATE stores SET active = ${body.active} WHERE id = ${id}`;
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'setBooked') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || typeof body.booked !== 'boolean') return send(res, 400, { error: 'Bad request.' });
      await q`UPDATE leads SET booked = ${body.booked} WHERE id = ${id}`;
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'deleteLead') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return send(res, 400, { error: 'Bad lead id.' });
      await q`DELETE FROM leads WHERE id = ${id}`;
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'Unknown action.' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error. Please try again.' });
  }
}
