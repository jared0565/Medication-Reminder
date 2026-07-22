import webpush from 'web-push';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true, service: 'medication-reminder-push' });
    if (request.method === 'GET' && url.pathname === '/vapid-public-key') return Response.json({ publicKey: env.VAPID_PUBLIC_KEY });
    if (request.method === 'POST' && url.pathname === '/subscriptions') {
      const body = await request.json();
      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) return Response.json({ error: 'Invalid push subscription' }, { status: 400 });
      await env.DB.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, timezone) VALUES (?, ?, ?, ?)').bind(body.endpoint, body.keys.p256dh, body.keys.auth, body.timezone || 'UTC').run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
