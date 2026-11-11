// POST /api/register -> saves a student lead from the QR registration form.
import { db, init, send, clean, EMAIL_RE, normalizePhone } from './_lib/db.js';

export const LEVELS = ['O Level', 'A Level'];

export function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const lead = {
    name: clean(b.name, 120),
    email: clean(b.email, 160).toLowerCase(),
    phone: normalizePhone(b.phone),
    parent_email: clean(b.parent_email, 160).toLowerCase(),
    level: clean(b.level, 20),
    store: clean(b.store, 80),
  };
  const errors = {};
  if (lead.name.length < 2) errors.name = 'Please enter the student name.';
  if (!EMAIL_RE.test(lead.email)) errors.email = 'Please enter a valid email.';
  if (!lead.phone) errors.phone = 'Please enter a valid phone number.';
  if (lead.parent_email && !EMAIL_RE.test(lead.parent_email)) errors.parent_email = 'Please enter a valid parent email, or leave it empty.';
  if (!LEVELS.includes(lead.level)) errors.level = 'Please choose O Level or A Level.';
  if (!lead.store) errors.store = 'Please choose the book store.';
  return { lead, errors };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = req.body || {};
  // Honeypot: real people never fill this hidden field.
  if (clean(body.website)) return send(res, 200, { ok: true });

  const { lead, errors } = validate(body);
  if (Object.keys(errors).length) return send(res, 400, { error: 'Please fix the highlighted fields.', fields: errors });

  try {
    await init();
    const q = db();
    const [store] = await q`SELECT id FROM stores WHERE slug = ${lead.store} AND active`;
    if (!store) return send(res, 400, { error: 'Please choose the book store.', fields: { store: 'Please choose the book store.' } });

    // One registration per phone number; a repeat keeps the first store's credit.
    const rows = await q`
      INSERT INTO leads (name, email, phone, parent_email, level, store_id)
      VALUES (${lead.name}, ${lead.email}, ${lead.phone}, ${lead.parent_email || null}, ${lead.level}, ${store.id})
      ON CONFLICT (phone) DO NOTHING
      RETURNING id`;
    send(res, 200, { ok: true, duplicate: rows.length === 0 });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
