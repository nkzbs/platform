// G2 (PLATFORM-0.6-GAP-ANALYSIS.md) — servizio minimo, privilegiato, unico
// proprietario di /var/run/docker.sock. Ogni endpoint sotto è dietro
// `requireInternalSecret`, stessa identica funzione già copiata in
// super-admin/backend/src/routes/registry.js — nessuna nuova convenzione di
// auth inventata, solo riusata. Raggiungibile SOLO sulla rete Docker interna
// (mai esposto con una porta pubblica in docker-compose.yml), stesso principio
// già vero oggi per le chiamate tenant→Super Admin via x-internal-secret.
const crypto = require('crypto');
const express = require('express');
const docker = require('./docker');

const app = express();
const PORT = process.env.PORT || 4000;

// Stessa regola di shared/internal-secret.js (qui copiata: l'immagine del provisioner
// non include shared/): nessun valore di riserva, confronto a tempo costante.
const EXPECTED_SECRET = Buffer.from(process.env.INTERNAL_API_SECRET || '');
if (EXPECTED_SECRET.length === 0) console.error('docker-provisioner: INTERNAL_API_SECRET non impostato, ogni richiesta sarà rifiutata');
function requireInternalSecret(req, res, next) {
  const given = Buffer.from(req.headers['x-internal-secret'] || '');
  if (EXPECTED_SECRET.length === 0 || given.length !== EXPECTED_SECRET.length || !crypto.timingSafeEqual(given, EXPECTED_SECRET)) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  next();
}

// json() applicato SOLO alle route che ne hanno bisogno, non globalmente — le
// due route a stream (/images/export, /images/import) devono ricevere/inviare
// il body grezzo, un express.json() globale lo consumerebbe prima che arrivi
// al gestore giusto.
const jsonBody = express.json();

function handleError(err, res) {
  console.error('docker-provisioner:', err.message);
  res.status(err.statusCode || 500).json({ error: err.message });
}

app.post('/tenants', requireInternalSecret, jsonBody, async (req, res) => {
  try {
    const { slug, env, port } = req.body || {};
    if (!slug || !Array.isArray(env) || !port) return res.status(400).json({ error: 'slug, env[], port obbligatori' });
    const result = await docker.createTenantContainer(slug, { env, port });
    res.json(result);
  } catch (err) { handleError(err, res); }
});

app.post('/tenants/:slug/stop', requireInternalSecret, async (req, res) => {
  try { await docker.stopTenant(req.params.slug); res.json({ ok: true }); }
  catch (err) { handleError(err, res); }
});

app.post('/tenants/:slug/start', requireInternalSecret, async (req, res) => {
  try { await docker.startTenant(req.params.slug); res.json({ ok: true }); }
  catch (err) { handleError(err, res); }
});

app.delete('/tenants/:slug', requireInternalSecret, async (req, res) => {
  // Sempre {ok:true}, stesso comportamento best-effort di oggi (tenants.js):
  // stop/remove non bloccano mai su un container già assente.
  await docker.removeTenant(req.params.slug);
  res.json({ ok: true });
});

// Stream NDJSON (stesso formato del popup di avanzamento già usato da
// tenants.js per /:slug/redeploy) — un build può durare oltre un minuto.
app.post('/images/build-core', requireInternalSecret, async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => { try { res.write(JSON.stringify(o) + '\n') } catch (e) { /* client chiuso */ } };
  try {
    const result = await docker.buildCoreImage((msg) => send({ msg, at: new Date().toISOString() }));
    send({ done: true, ok: true, commit: result.commit });
  } catch (err) {
    send({ msg: 'Errore: ' + err.message, at: new Date().toISOString() });
    send({ done: true, ok: false, error: err.message });
  }
  res.end();
});

app.post('/tenants/:slug/redeploy', requireInternalSecret, jsonBody, async (req, res) => {
  try {
    const { env, port } = req.body || {};
    if (!Array.isArray(env) || !port) return res.status(400).json({ error: 'env[], port obbligatori' });
    const result = await docker.redeployTenant(req.params.slug, { env, port });
    res.json(result);
  } catch (err) { handleError(err, res); }
});

app.get('/tenants/:slug/inspect', requireInternalSecret, async (req, res) => {
  try { res.json(await docker.inspectTenant(req.params.slug)); }
  catch (err) { handleError(err, res); }
});

app.get('/tenants/:slug/stats', requireInternalSecret, async (req, res) => {
  try { res.json(await docker.statsTenant(req.params.slug)); }
  catch (err) { handleError(err, res); }
});

app.post('/nginx/reload', requireInternalSecret, async (req, res) => {
  try { await docker.reloadNginx(); res.json({ ok: true }); }
  catch (err) { handleError(err, res); }
});

app.get('/images/:ref/inspect', requireInternalSecret, async (req, res) => {
  try { res.json(await docker.inspectImage(req.params.ref)); }
  catch (err) { handleError(err, res); }
});

app.post('/images/tag', requireInternalSecret, jsonBody, async (req, res) => {
  try {
    const { source, tag } = req.body || {};
    if (!source || !tag) return res.status(400).json({ error: 'source, tag obbligatori' });
    await docker.tagImage(source, tag);
    res.json({ ok: true });
  } catch (err) { handleError(err, res); }
});

// Stream grezzo (tar non compresso) — la compressione gzip e il nome del file
// scaricato restano responsabilità di update-manager.js, che è il punto a
// contatto col client finale e già li gestiva prima di questo refactor.
app.get('/images/export', requireInternalSecret, (req, res) => {
  docker.exportImageStream((err, stream) => {
    if (err) return handleError(Object.assign(err, { statusCode: err.statusCode || 404 }), res);
    res.setHeader('Content-Type', 'application/x-tar');
    stream.pipe(res);
  });
});

// Riceve un tar già decompresso come body grezzo della richiesta (update-
// manager.js fa il gunzip prima di inviarlo) — carica nel daemon Docker locale
// e ritorna solo il riferimento caricato: la decisione "a quale tag applicarlo"
// resta esplicita in update-manager.js via una successiva chiamata a
// /images/tag, invariata rispetto a com'era prima di questo refactor.
app.post('/images/import', requireInternalSecret, (req, res) => {
  let outputBuf = '';
  docker.loadImage(req, (err, output) => {
    if (err) return handleError(err, res);
    output.on('data', (chunk) => { outputBuf += chunk.toString(); });
    output.on('error', (e) => handleError(e, res));
    output.on('end', () => {
      let loadedRef = null;
      for (const line of outputBuf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          const m = evt.stream && evt.stream.match(/^Loaded image(?: ID)?: (\S+)/);
          if (m) { loadedRef = m[1]; break; }
        } catch (e) { /* riga non-JSON, spezzata a metà chunk — ignorata */ }
      }
      if (!loadedRef) return res.status(500).json({ error: 'Immagine caricata ma riferimento non riconosciuto nell\'output' });
      res.json({ loaded_ref: loadedRef });
    });
  });
});

app.listen(PORT, () => {
  console.log('docker-provisioner in ascolto sulla porta ' + PORT);
});
