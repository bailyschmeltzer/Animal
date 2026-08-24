addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handle(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/health') {
    return json({ ok: true, ts: Date.now() });
  }

  if (path === '/wins' && req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return bad('Missing code');
    const key = `wins:${code}`;
    const raw = await WINS_KV.get(key);
    if (!raw) {
      const doc = { code, baily: 0, taylor: 0, updatedAt: Date.now(), version: 1 };
      await WINS_KV.put(key, JSON.stringify(doc));
      return json(doc);
    }
    return json(JSON.parse(raw));
  }

  if (path === '/wins' && req.method === 'POST') {
    const body = await safeJson(req);
    if (!body || !body.code) return bad('Missing code');
    const key = `wins:${body.code}`;

    const existing = await WINS_KV.get(key);
    let server = existing ? JSON.parse(existing) : { code: body.code, baily: 0, taylor: 0, updatedAt: 0, version: 0 };

    const incomingTs = Number(body.updatedAt || Date.now());
    if (incomingTs >= Number(server.updatedAt || 0)) {
      server.baily = Math.max(0, Number(body.baily || 0));
      server.taylor = Math.max(0, Number(body.taylor || 0));
      server.updatedAt = incomingTs;
      server.version = Number(server.version || 0) + 1;
      await WINS_KV.put(key, JSON.stringify(server));
    }
    return json(server);
  }

  return notFound();
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...(init.headers || {}) }
  });
}
function bad(msg) { return json({ ok: false, error: msg }, { status: 400 }); }
function notFound() { return json({ ok: false, error: 'Not found' }, { status: 404 }); }

async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}