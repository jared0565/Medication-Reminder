import webpush from 'web-push';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true, service: 'medication-reminder-push' });
    if (request.method === 'GET' && url.pathname === '/vapid-public-key') return Response.json({ publicKey: env.VAPID_PUBLIC_KEY });
    if (request.method === 'POST' && url.pathname === '/subscriptions') {
      const body = await request.json();
      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) return Response.json({ error: 'Invalid push subscription' }, { status: 400 });
      const reminders = Array.isArray(body.reminders) ? body.reminders.slice(0, 32) : [];
      await env.DB.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, timezone, reminders) VALUES (?, ?, ?, ?, ?)').bind(body.endpoint, body.keys.p256dh, body.keys.auth, body.timezone || 'UTC', JSON.stringify(reminders)).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
  async scheduled(_event, env) {
    const rows = await env.DB.prepare('SELECT endpoint, p256dh, auth, reminders FROM push_subscriptions').all();
    const now = Date.now();
    for (const row of rows.results || []) {
      let reminders = []; try { reminders = JSON.parse(row.reminders || '[]'); } catch { reminders = []; }
      const due = reminders.filter(item => Number(item.dueAt) <= now);
      if (!due.length) continue;
      try {
        webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        for (const item of due) await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: item.title || 'Medication due', body: item.body || 'A scheduled reminder is due.', tag: item.tag || `medication-${item.dueAt}` }));
        const remaining = reminders.filter(item => Number(item.dueAt) > now);
        await env.DB.prepare('UPDATE push_subscriptions SET reminders = ?, last_sent_at = CURRENT_TIMESTAMP WHERE endpoint = ?').bind(JSON.stringify(remaining), row.endpoint).run();
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();
      }
    }
  },
};
