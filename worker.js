export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/proxy')   return handleProxy(url);
    if (url.pathname === '/track')   return handleTrack(url, env, request);
    if (url.pathname === '/stats')   return handleStats(env);
    if (url.pathname === '/contact') return handleContact(env, request);

    return env.ASSETS.fetch(request);
  },
};

// ── Proxy de portadas kiosko.net ─────────────────────────────────────────────

async function handleProxy(url) {
  const paper = url.searchParams.get('paper');
  const date  = url.searchParams.get('date');

  if (!paper || !date || !/^\d{4}\/\d{2}\/\d{2}$/.test(date) || !/^[a-z0-9_]+$/.test(paper)) {
    return new Response('Bad request', { status: 400 });
  }

  const resp = await fetch(`https://img.kiosko.net/${date}/es/${paper}.750.jpg`, {
    headers: {
      'Referer': 'https://www.kiosko.net/',
      'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker)',
    },
  });

  if (!resp.ok) return new Response('Not found', { status: 404 });

  return new Response(resp.body, {
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Formulario de contacto ───────────────────────────────────────────────────

async function handleContact(env, request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }

  const name    = String(body.name    || '').trim().slice(0, 100);
  const message = String(body.message || '').trim().slice(0, 2000);

  if (!name || !message) {
    return new Response(JSON.stringify({ error: 'Nombre y mensaje son obligatorios' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { EmailMessage } = await import('cloudflare:email');

  const from = 'contacto@juntassisepuede.com';
  const to   = env.CONTACT_EMAIL;

  const rawEmail = [
    `MIME-Version: 1.0`,
    `From: Juntas Si Se Puede <${from}>`,
    `To: ${to}`,
    `Subject: Mensaje del portal de ${name}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Nombre: ${name}`,
    ``,
    `${message}`,
    ``,
    `---`,
    `Enviado desde juntassisepuede.com`,
  ].join('\r\n');

  try {
    const msg = new EmailMessage(from, to, rawEmail);
    await env.EMAIL.send(msg);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    const detail = err?.message || String(err);
    return new Response(JSON.stringify({ error: 'Error al enviar el mensaje', detail }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Contador de clics ────────────────────────────────────────────────────────

async function handleTrack(url, env, request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const paper = url.searchParams.get('paper');
  if (!paper || !/^[a-zA-Z0-9 _\-\.]{1,60}$/.test(paper)) {
    return new Response('Bad request', { status: 400 });
  }

  const key = `clicks:${paper}`;
  const current = parseInt(await env.CLICKS.get(key) || '0');
  await env.CLICKS.put(key, String(current + 1));

  await env.CLICKS.put(`last:${paper}`, new Date().toISOString());

  const totalKey = 'clicks:__total__';
  const total = parseInt(await env.CLICKS.get(totalKey) || '0');
  await env.CLICKS.put(totalKey, String(total + 1));

  return new Response('ok', {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

// ── Estadísticas ─────────────────────────────────────────────────────────────

async function handleStats(env) {
  const { keys } = await env.CLICKS.list({ prefix: 'clicks:' });

  const entries = await Promise.all(
    keys.map(async ({ name }) => {
      const paper = name.replace('clicks:', '');
      const count = parseInt(await env.CLICKS.get(name) || '0');
      const last  = await env.CLICKS.get(`last:${paper}`);
      return { paper, count, last };
    })
  );

  const total  = entries.find(e => e.paper === '__total__')?.count ?? 0;
  const papers = entries
    .filter(e => e.paper !== '__total__')
    .sort((a, b) => b.count - a.count);

  return new Response(JSON.stringify({ total, papers }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
