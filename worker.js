// worker.js — serves both API routes and static assets from ./site

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const method = request.method.toUpperCase();

    // Simple CORS config for API routes
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Helpers (scoped to fetch to avoid top-level return issues)
    const json = (data, init = {}) =>
      new Response(JSON.stringify(data), {
        ...init,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...CORS,
          ...(init.headers || {}),
        },
      });

    const bad = (msg, code = 400) => json({ ok: false, error: msg }, { status: code });

    const safeJson = async (req) => {
      try { return await req.json(); } catch { return null; }
    };

    const isRoute = (name) => path === `/${name}` || path.endsWith(`/${name}`);

    // CORS preflight for API
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // API: health
    if (isRoute('health')) {
      return json({ ok: true, service: 'animal-wins', ts: Date.now() });
    }

    // API: wins GET
    if (isRoute('wins') && method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) return bad('Missing code');
      const key = kvKey(code);
      const raw = await env.KV_BINDING.get(key);
      if (!raw) {
        const doc = baselineDoc(code);
        await env.KV_BINDING.put(key, JSON.stringify(doc));
        return json(doc);
      }
      const doc = JSON.parse(raw);
      doc.score = doc.score || { baily: 0, taylor: 0 }; // back-compat for docs saved before score tracking
      return json(doc);
    }

    // API: wins POST
    if (isRoute('wins') && method === 'POST') {
      const body = await safeJson(request);
      if (!body || !body.code) return bad('Missing code');
      const key = kvKey(body.code);

      const existing = await env.KV_BINDING.get(key);
      let server = existing ? JSON.parse(existing) : baselineDoc(body.code, { version: 0, updatedAt: 0 });
      server.score = server.score || { baily: 0, taylor: 0 }; // back-compat for docs saved before score tracking

      const incomingTs = Number(body.updatedAt || Date.now());
      if (Number.isNaN(incomingTs)) return bad('Invalid updatedAt');

      // Last-write-wins by updatedAt
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

    // Static assets (UI) for everything else
    // Try to serve from assets. If 404 and it's a likely SPA route, fall back to index.html.
    const assetResp = await env.ASSETS.fetch(request);
    if (assetResp.status !== 404) return assetResp;

    // SPA fallback: only for GET requests that accept HTML
    if (method === 'GET' && acceptsHtml(request)) {
      const rootUrl = new URL('/', url);
      return env.ASSETS.fetch(new Request(rootUrl.toString(), request));
    }

    // Not found
    return new Response('Not found', { status: 404 });
  },
};

// Utility functions (pure; safe at top-level)
function normalizePath(p) {
  // collapse duplicate trailing slashes; keep root as '/'
  const trimmed = p.replace(/\/+$/, '');
  return trimmed || '/';
}

function kvKey(code) {
  return `wins:${String(code).trim()}`;
}

function baselineDoc(code, extra = {}) {
  return {
    code,
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