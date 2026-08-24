if (request.method === 'OPTIONS') {
  return new Response(null, { headers: CORS });
}

const is = (name) => path === `/${name}` || path.endsWith(`/${name}`);

if (path === '/' || path === '') {
  return json({ ok: true, service: 'animal-wins', endpoints: ['GET /health', 'GET /wins?code=ROOM', 'POST /wins'] });
}

if (is('health')) {
  return json({ ok: true, ts: Date.now() });
}

if (is('wins') && request.method === 'GET') {
  const code = url.searchParams.get('code');
  if (!code) return bad('Missing code');
  const key = `wins:${code}`;
  const raw = await env.KV_BINDING.get(key);
  if (!raw) {
    const doc = { code, baily: 0, taylor: 0, updatedAt: Date.now(), version: 1 };
    await env.KV_BINDING.put(key, JSON.stringify(doc));
    return json(doc);
  }
  return json(JSON.parse(raw));
}

if (is('wins') && request.method === 'POST') {
  const body = await safeJson(request);
  if (!body || !body.code) return bad('Missing code');
  const key = `wins:${body.code}`;

  const existing = await env.KV_BINDING.get(key);
  let server = existing ? JSON.parse(existing) : { code: body.code, baily: 0, taylor: 0, updatedAt: 0, version: 0 };

  const incomingTs = Number(body.updatedAt || Date.now());
  if (incomingTs >= Number(server.updatedAt || 0)) {
    server.baily = Math.max(0, Number(body.baily || 0));
    server.taylor = Math.max(0, Number(body.taylor || 0));
    server.updatedAt = incomingTs;
    server.version = Number(server.version || 0) + 1;
    await env.KV_BINDING.put(key, JSON.stringify(server));
  }
  return json(server);
}

return json({ ok: false, error: 'Not found', path }, { status: 404 });

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...(init.headers || {}) }
  });
}
function bad(msg) { return json({ ok: false, error: msg }, { status: 400 }); }
async function safeJson(req) { try { return await req.json(); } catch { return null; } }