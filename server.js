// Farestey Template — servidor sin dependencias (Node 18+).
// Recibe un ID de Roblox (ropa, calcomanía, imagen...), sigue la plantilla
// hasta la imagen PNG real y la entrega para ver y descargar.
//
// Prueba varios caminos de Roblox en orden. Si tu cuenta tiene acceso al recurso,
// puedes activar tu sesión propia (mira el README: cookie.txt).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DELIVERY = process.env.ROBLOX_DELIVERY_URL || 'https://assetdelivery.roblox.com';
const APIS = process.env.ROBLOX_APIS_URL || 'https://apis.roblox.com';
const ECONOMY = process.env.ROBLOX_ECONOMY_URL || 'https://economy.roblox.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_DEPTH = 3;

// Sesión propia opcional (solo se envía a servidores de roblox.com).
const COOKIE = (() => {
  let c = process.env.ROBLOSECURITY || '';
  if (!c) { try { c = fs.readFileSync(path.join(__dirname, 'cookie.txt'), 'utf8'); } catch { /* sin archivo */ } }
  c = c.trim();
  // Si pegaste de más (comillas, nombre, llaves), nos quedamos solo con el valor de la cookie.
  const m = c.match(/_\|WARNING:[^\s"';,]+/);
  c = m ? m[0] : c.replace(/^["']|["']$/g, '').replace(/^\.?ROBLOSECURITY[=:]\s*/i, '').replace(/^["']|["']$/g, '').trim();
  return c || null;
})();

const USERS = process.env.ROBLOX_USERS_URL || 'https://users.roblox.com';
let sessionInfo = { activada: !!COOKIE };

// Comprueba si Roblox acepta la cookie (no muestra ni guarda su valor).
async function checkSession() {
  if (!COOKIE) return { activada: false };
  try {
    const r = await rfetch(`${USERS}/v1/users/authenticated`, 'application/json');
    if (!r.ok) return { activada: true, valida: false, estado: r.status };
    const j = await r.json();
    return { activada: true, valida: true, usuario: j.name };
  } catch (e) {
    return { activada: true, valida: null, estado: 'sin conexión' };
  }
}

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TYPES = {
  1: 'Imagen', 2: 'Camiseta (T-Shirt)', 11: 'Camisa', 12: 'Pantalón', 13: 'Calcomanía',
};

// ---------- Utilidades de red ----------

function isRobloxHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'roblox.com' || h.endsWith('.roblox.com');
  } catch { return false; }
}

async function rfetch(url, accept) {
  const headers = { 'User-Agent': UA, Accept: accept || '*/*', 'Accept-Language': 'es,en;q=0.8' };
  if (COOKIE && isRobloxHost(url)) headers.Cookie = `.ROBLOSECURITY=${COOKIE}`;
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new AppError(502, 'upstream', 'No pude conectar con Roblox. Revisa tu internet e intenta de nuevo.');
  }
}

function checkHost(u) {
  if (process.env.ALLOW_ANY_HOST) return;
  let h;
  try { h = new URL(u).hostname; } catch { h = ''; }
  const ok = h.endsWith('.rbxcdn.com') || h === 'roblox.com' || h.endsWith('.roblox.com');
  if (!ok) throw new AppError(502, 'upstream', 'Roblox devolvió una ubicación no esperada.');
}

function mapStatus(code) {
  if (code === 404) return new AppError(404, 'not_found', 'No existe ningún recurso con ese ID.');
  if (code === 401 || code === 403) return new AppError(403, 'private', `acceso denegado (${code})`);
  return new AppError(502, 'upstream', `error de Roblox (${code})`);
}

async function fetchBytes(url) {
  checkHost(url);
  const r = await rfetch(url);
  if (!r.ok) throw mapStatus(r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new AppError(413, 'too_big', 'El archivo es demasiado grande.');
  return buf;
}

// Camino A: pide a Roblox la dirección del archivo (JSON) y lo descarga.
async function viaJson(url) {
  const r = await rfetch(url, 'application/json');
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* sin JSON */ }
  if (!r.ok || (j && j.errors)) {
    const code = (j && j.errors && j.errors[0] && j.errors[0].code) || r.status;
    throw mapStatus(Number(code));
  }
  const loc = j && (j.location || (j.locations && j.locations[0] && j.locations[0].location));
  if (!loc) throw new AppError(404, 'not_found', 'Roblox no devolvió ningún archivo.');
  return fetchBytes(loc);
}

// Camino B: pide el archivo directamente (Roblox responde con una redirección).
async function viaDirect(url) {
  const r = await rfetch(url);
  if (!r.ok) throw mapStatus(r.status);
  checkHost(r.url);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new AppError(413, 'too_big', 'El archivo es demasiado grande.');
  return buf;
}

const STRATEGIES = [
  { name: 'v2', run: (id) => viaJson(`${DELIVERY}/v2/assetId/${id}`) },
  { name: 'v1', run: (id) => viaJson(`${DELIVERY}/v1/assetId/${id}`) },
  { name: 'apis', run: (id) => viaJson(`${APIS}/asset-delivery-api/v1/assetId/${id}`) },
  { name: 'directo', run: (id) => viaDirect(`${DELIVERY}/v1/asset/?id=${id}`) },
];

// Prueba los caminos en orden y se queda con el primero que funcione.
async function fetchAssetBytes(id) {
  const attempts = [];
  let sawPrivate = false;
  let allNotFound = true;
  for (const s of STRATEGIES) {
    try {
      return await s.run(id);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code === 'too_big') throw e;
      attempts.push(`${s.name}: ${e.message}`);
      if (e.code === 'private') sawPrivate = true;
      if (e.code !== 'not_found') allNotFound = false;
    }
  }
  const notFoundCount = attempts.filter((a) => a.includes('No existe ningún recurso')).length;
  if (allNotFound || notFoundCount >= 2) throw new AppError(404, 'not_found', 'No existe ningún recurso con ese ID.');
  const detail = attempts.join(' · ');
  if (sawPrivate) {
    let extra;
    if (!COOKIE) extra = ' Si tu cuenta de Roblox sí tiene acceso, activa tu sesión (mira el README, cookie.txt).';
    else if (sessionInfo.valida === false) extra = ` Roblox rechazó tu cookie (estado ${sessionInfo.estado}): está mal copiada o ya venció. Copia una nueva en cookie.txt.`;
    else extra = ' Tu sesión de Roblox está activada, pero tu cuenta tampoco tiene acceso a este recurso.';
    throw new AppError(403, 'private', `Roblox bloqueó la descarga de este recurso (privado, no disponible o requiere sesión).${extra} Detalle: ${detail}`);
  }
  throw new AppError(502, 'upstream', `Roblox no respondió bien. Detalle: ${detail}`);
}

function sniff(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

// Sigue la cadena: ID de catálogo -> XML de la prenda -> ID de textura -> PNG.
async function resolveImage(id, depth = 0) {
  const buf = await fetchAssetBytes(id);
  const kind = sniff(buf);
  if (kind) return { buf, ...kind, textureId: id };
  if (depth >= MAX_DEPTH) throw new AppError(422, 'no_image', 'Ese ID no contiene una imagen o plantilla.');
  const text = buf.toString('utf8', 0, Math.min(buf.length, 300000));
  const m = text.match(/(?:rbxassetid:\/\/|asset\/?\?id=|assetId=)(\d+)/i);
  if (!m) throw new AppError(422, 'no_image', 'Ese ID no contiene una imagen o plantilla (puede ser un modelo, audio u otro tipo).');
  return resolveImage(m[1], depth + 1);
}

async function getDetails(id) {
  try {
    const r = await rfetch(`${ECONOMY}/v2/assets/${id}/details`, 'application/json');
    if (!r.ok) return {};
    const j = await r.json();
    return { name: j.Name, type: TYPES[j.AssetTypeId] || null };
  } catch { return {}; }
}

// ---------- Caché pequeña en memoria ----------

const cache = new Map();
const CACHE_MAX = 60;

async function resolveAsset(id) {
  if (cache.has(id)) return cache.get(id);
  const [img, details] = await Promise.all([resolveImage(id), getDetails(id)]);
  const item = { id, ...img, name: details.name || null, type: details.type || null };
  cache.set(id, item);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return item;
}

function safeName(s) {
  return String(s || 'plantilla').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'plantilla';
}

// Diagnóstico: qué responde Roblox en cada camino para un ID.
async function diagnose(id) {
  const out = [];
  for (const s of STRATEGIES) {
    try {
      const buf = await s.run(id);
      const kind = sniff(buf);
      out.push({ camino: s.name, ok: true, bytes: buf.length, tipo: kind ? kind.mime : 'xml/otro' });
    } catch (e) {
      out.push({ camino: s.name, ok: false, error: e.message });
    }
  }
  sessionInfo = await checkSession();
  return { id, sesion: sessionInfo, caminos: out };
}

// ---------- Servidor ----------

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403); return res.end('Prohibido');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// Límite de uso por persona (IP) para que nadie sature la página.
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 120); // peticiones por minuto
const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60000).unref();

function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const f = req.headers['x-forwarded-for'];
    if (f) return String(f).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '?';
}

function rateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.reset < now) { h = { count: 0, reset: now + 60000 }; hits.set(ip, h); }
  h.count += 1;
  return h.count > RATE_LIMIT;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });

    if (url.pathname.startsWith('/api/') && rateLimited(req)) {
      throw new AppError(429, 'rate', 'Demasiadas búsquedas seguidas. Espera un minuto e intenta de nuevo.');
    }

    if (url.pathname === '/api/diag') {
      // En el servidor público el diagnóstico está apagado (podría mostrar datos de la cuenta).
      if (process.env.TRUST_PROXY && !process.env.ENABLE_DIAG) throw new AppError(404, 'not_found', 'Ruta no encontrada.');
      const id = url.searchParams.get('id') || '';
      if (!/^\d{1,19}$/.test(id)) throw new AppError(400, 'bad_id', 'El ID debe ser un número.');
      return sendJson(res, 200, await diagnose(id));
    }

    if (url.pathname === '/api/resolve' || url.pathname === '/api/image') {
      const id = url.searchParams.get('id') || '';
      if (!/^\d{1,19}$/.test(id)) throw new AppError(400, 'bad_id', 'El ID debe ser un número.');
      const item = await resolveAsset(id);

      if (url.pathname === '/api/resolve') {
        return sendJson(res, 200, {
          ok: true, id, name: item.name, type: item.type,
          textureId: item.textureId, format: item.ext, bytes: item.buf.length,
        });
      }
      const headers = {
        'Content-Type': item.mime,
        'Content-Length': item.buf.length,
        'Cache-Control': 'public, max-age=3600',
      };
      if (url.searchParams.get('download')) {
        headers['Content-Disposition'] = `attachment; filename="${safeName(item.name)}-${id}.${item.ext}"`;
      }
      res.writeHead(200, headers);
      return res.end(item.buf);
    }

    if (url.pathname.startsWith('/api/')) throw new AppError(404, 'not_found', 'Ruta no encontrada.');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof AppError) return sendJson(res, e.status, { ok: false, code: e.code, error: e.message });
    console.error(e);
    sendJson(res, 500, { ok: false, code: 'internal', error: 'Error interno del servidor.' });
  }
});

server.listen(PORT, () => {
  console.log(`Farestey Template listo en http://localhost:${PORT}`);
  const lan = [];
  const nets = require('os').networkInterfaces();
  Object.keys(nets).forEach((n) => (nets[n] || []).forEach((i) => {
    if (i.family === 'IPv4' && !i.internal) lan.push(i.address);
  }));
  if (lan.length) console.log(`En tu celular (mismo Wi-Fi): ${lan.map((a) => `http://${a}:${PORT}`).join('  o  ')}`);
  if (!COOKIE) {
    console.log('Sesión de Roblox: no activada (opcional, mira el README)');
    return;
  }
  console.log('Sesión de Roblox: cookie cargada, comprobando con Roblox...');
  checkSession().then((s) => {
    sessionInfo = s;
    if (s.valida) console.log(`Sesión de Roblox: VÁLIDA (cuenta: ${s.usuario})`);
    else if (s.valida === false) console.log(`Sesión de Roblox: Roblox RECHAZÓ la cookie (estado ${s.estado}). Copia una nueva en cookie.txt.`);
    else console.log('Sesión de Roblox: no pude comprobarla (sin conexión con Roblox).');
  });
});
