// worker.js — serves both API routes and static assets from ./site

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const method = request.method.toUpperCase();

    // CORS & Cache prevention headers for live synchronization
    const API_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    };

    const json = (data, init = {}) =>
      new Response(JSON.stringify(data), {
        ...init,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...API_HEADERS,
          ...(init.headers || {}),
        },
      });

    const bad = (msg, code = 400) => json({ ok: false, error: msg }, { status: code });

    const safeJson = async (req) => {
      try { return await req.json(); } catch { return null; }
    };

    const isRoute = (name) => path === `/${name}` || path.endsWith(`/${name}`);

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: API_HEADERS });
    }

    // API: health check
    if (isRoute('health')) {
      return json({ ok: true, service: 'animal-wins', ts: Date.now() });
    }

    // API: GET /wins?code=ROOM
    if (isRoute('wins') && method === 'GET') {
      const code = (url.searchParams.get('code') || '').trim().toUpperCase();
      if (!code) return bad('Missing code');
      const key = kvKey(code);
      const raw = await env.KV_BINDING.get(key);
      if (!raw) {
        const doc = baselineDoc(code);
        await env.KV_BINDING.put(key, JSON.stringify(doc));
        return json(doc);
      }
      const doc = JSON.parse(raw);
      doc.score = doc.score || { baily: 0, taylor: 0 };
      doc.baily = clampInt(doc.baily, 0);
      doc.taylor = clampInt(doc.taylor, 0);
      return json(doc);
    }

    // API: POST /wins
    if (isRoute('wins') && method === 'POST') {
      const body = await safeJson(request);
      if (!body || !body.code) return bad('Missing code');
      const code = String(body.code).trim().toUpperCase();
      const key = kvKey(code);

      const existing = await env.KV_BINDING.get(key);
      let server = existing ? JSON.parse(existing) : baselineDoc(code, { version: 0, updatedAt: 0 });
      server.score = server.score || { baily: 0, taylor: 0 };

      const incomingTs = Number(body.updatedAt || Date.now());
      if (Number.isNaN(incomingTs)) return bad('Invalid updatedAt');

      // Update state if incoming change is newer or equal
      if (incomingTs >= Number(server.updatedAt || 0)) {
        server.baily = clampInt(body.baily, 0);
        server.taylor = clampInt(body.taylor, 0);
        server.score = {
          baily: clampInt(body.score && body.score.baily, 0),
          taylor: clampInt(body.score && body.score.taylor, 0),
        };
        server.updatedAt = incomingTs;
        server.version = Number(server.version || 0) + 1;
        await env.KV_BINDING.put(key, JSON.stringify(server));
      }
      return json(server);
    }

    // Static assets
    const assetResp = await env.ASSETS.fetch(request);
    if (assetResp.status !== 404) return assetResp;

    // SPA fallback for HTML navigations
    if (method === 'GET' && acceptsHtml(request)) {
      const rootUrl = new URL('/', url);
      return env.ASSETS.fetch(new Request(rootUrl.toString(), request));
    }

    return new Response('Not found', { status: 404 });
  },
};

function normalizePath(p) {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed || '/';
}

function kvKey(code) {
  return `wins:${String(code).trim().toUpperCase()}`;
}

function baselineDoc(code, extra = {}) {
  return {
    code: String(code).trim().toUpperCase(),
    baily: 0,
    taylor: 0,
    score: { baily: 0, taylor: 0 },
    updatedAt: Date.now(),
    version: 1,
    ...extra,
  };
}

function clampInt(val, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(val);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function acceptsHtml(request) {
  const h = request.headers.get('Accept') || '';
  return h.includes('text/html');
}