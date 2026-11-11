// GET /api/stores -> active book stores for the registration form dropdown.
import { db, init, send } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  try {
    await init();
    const stores = await db()`SELECT slug, name FROM stores WHERE active ORDER BY name`;
    send(res, 200, { stores });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Could not load stores' });
  }
}
