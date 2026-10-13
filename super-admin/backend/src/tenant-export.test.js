'use strict';
// Esportazione di un tenant su un server dell'utente (lib/tenant-export.js, routes/tenant-export.js): destinazioni vietate, opzioni, controlli di sola lettura, la copia con un SSH finto
// (ordine dei comandi, segreti solo nel file riservato, mai nello stato né nell'audit), impronta fissata, pulizia se si rompe a metà, e il token firmato dal tenant. Porta 34861 libera.
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const TEST_PORT = 34861, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'export-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ex_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'ex_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'ex_enc_' + crypto.randomBytes(8).toString('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const rifiuta = async (fn, rx, m) => { try { await fn(); } catch (e) { if (!rx.test(e.message)) throw new Error((m || '') + ': messaggio inatteso: ' + e.message); return; } throw new Error((m || '') + ': doveva fallire'); };
const attendi = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const jwt = require('jsonwebtoken'); const Database = require('better-sqlite3');
  const X = require('./lib/tenant-export');
  const dbFile = path.join(os.tmpdir(), 'export-tenant-' + crypto.randomBytes(4).toString('hex') + '.db');
  const t0 = new Database(dbFile); t0.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, data TEXT)'); t0.prepare('INSERT INTO records (data) VALUES (?)').run('riga'); t0.close();
  const mkTenant = (slug, jwtSecret, file) => { db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, encryption_key, jwt_secret) VALUES (?, ?, ?, ?, 'active', ?, ?)").run('Officina Rossi', slug, 47000 + Math.floor(Math.random() * 900), file, 'ENCKEY_' + slug, jwtSecret); return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug); };
  const officina = mkTenant('officina', 'JWTSEC_officina', dbFile), altro = mkTenant('altro', 'JWTSEC_altro', dbFile);

  // SSH finto: registra i comandi e ciò che gli arriva su stdin; le risposte si impostano per comando.
  let comandi = [], stdins = [], risposte = {}, impronta = 'SHA256:giusta', connessioni = [];
  const leggi = (s) => new Promise((res) => { if (s == null) return res(''); if (typeof s === 'string' || Buffer.isBuffer(s)) return res(String(s)); const a = []; s.on('data', (d) => a.push(d)); s.on('end', () => res(Buffer.concat(a).toString('latin1'))); s.on('error', () => res('')); });
  X.deps.attesa = 1;
  X.deps.resolve = async (h) => (h === 'srv.example.com' ? ['203.0.113.10'] : h === 'interno.example.com' ? ['10.0.0.8'] : [h]);
  X.deps.connect = async (o) => {
    connessioni.push(o);
    if (o.fingerprint && o.fingerprint !== impronta) throw Object.assign(new Error('L\'impronta del server non è quella confermata: mi fermo.'), { code: 'fingerprint' });
    return { fingerprint: impronta, close() {}, run: async (cmd, opt = {}) => {
      comandi.push(cmd); const dati = await leggi(opt.stdin); stdins.push(dati);
      for (const [rx, r] of Object.entries(risposte)) if (new RegExp(rx).test(cmd)) return { code: 0, stdout: '', stderr: '', ...r };
      if (/uname -m/.test(cmd)) return { code: 0, stdout: 'x86_64\n', stderr: '' };
      if (/docker version/.test(cmd)) return { code: 0, stdout: '27.1.1\n', stderr: '' };
      if (/^df /.test(cmd)) return { code: 0, stdout: '/dev/sda1 100000000 1000 50000000 2% /\n', stderr: '' };
      if (/wc -c/.test(cmd)) return { code: 0, stdout: String(fs.statSync(dbFile).size) + '\n', stderr: '' };
      if (/docker load/.test(cmd)) return { code: 0, stdout: 'Loaded image: platform-core:amd64\n', stderr: '' };
      if (/wget -qO-/.test(cmd)) return { code: 0, stdout: '{"status":"ok"}', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    } };
  };
  X.deps.imageStream = async () => Readable.from([Buffer.from('IMMAGINE-FINTA')]);
  X.deps.allegati = (slug) => (slug === 'officina' ? Readable.from([Buffer.from('ALLEGATI-FINTI')]) : null);
  const server = { host: 'srv.example.com', port: 22, username: 'nima', password: 'LA-MIA-PASSWORD-SEGRETA' };
  const opz = { porta_web: 8090, cartella: 'platform-officina' };
  const reset = () => { comandi = []; stdins = []; risposte = {}; connessioni = []; impronta = 'SHA256:giusta'; };

  await test('destinazioni vietate: loopback, link-local (servizi cloud), privati; ammesso un indirizzo pubblico', async () => {
    for (const ip of ['127.0.0.1', '0.0.0.0', '169.254.169.254', '10.1.2.3', '172.20.0.5', '192.168.1.2', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '224.0.0.1', '::ffff:127.0.0.1']) ok(X.vieta(ip), 'doveva vietare ' + ip);
    for (const ip of ['8.8.8.8', '203.0.113.10', '2606:4700::1111']) eq(X.vieta(ip), null, ip);
    process.env.EXPORT_ALLOW_PRIVATE = '1'; eq(X.vieta('192.168.1.2'), null); ok(X.vieta('127.0.0.1')); delete process.env.EXPORT_ALLOW_PRIVATE;
  });
  await test('indirizzo e porta SSH controllati; un nome che punta a un indirizzo privato è vietato', async () => {
    await rifiuta(() => X.controllaDestinazione('', 22), /non valido/); await rifiuta(() => X.controllaDestinazione('a b;rm', 22), /non valido/); await rifiuta(() => X.controllaDestinazione('srv.example.com', 70000), /Porta/);
    await rifiuta(() => X.controllaDestinazione('interno.example.com', 22), /non è ammesso/); await rifiuta(() => X.controllaDestinazione('127.0.0.1', 22), /non è ammesso/);
    eq(await X.controllaDestinazione('srv.example.com', 22), '203.0.113.10');
  });
  await test('opzioni: porta web e cartella validate (niente .. né caratteri da shell)', async () => {
    eq(X.leggiOpzioni(officina, { porta_web: 8090 }), { porta: 8090, cartella: 'platform-officina' });
    for (const o of [{ porta_web: 80 }, { porta_web: 'x' }, { porta_web: 8090, cartella: '../etc' }, { porta_web: 8090, cartella: 'a; rm -rf /' }, { porta_web: 8090, cartella: 'a b' }]) { let e = null; try { X.leggiOpzioni(officina, o); } catch (x) { e = x; } ok(e && e.status === 400, 'doveva rifiutare ' + JSON.stringify(o)); }
  });
  await test('verifica: sola lettura, ritorna l\'impronta e i controlli; tutto a posto → ok', async () => {
    reset(); const v = await X.verifica(officina, server, opz);
    eq(v.fingerprint, 'SHA256:giusta'); eq(v.ok, true); eq(v.controlli.map((c) => c.nome).slice(0, 3), ['Architettura', 'Docker', 'Spazio libero']);
    ok(comandi.every((c) => !/mkdir|cat >|docker run|docker load|rm /.test(c)), 'nessun comando che scrive');
  });
  await test('verifica: architettura diversa, Docker assente, porta occupata, container già esistente, poco spazio → ok false, con il perché', async () => {
    reset(); risposte['uname -m'] = { stdout: 'aarch64\n' }; let v = await X.verifica(officina, server, opz); eq(v.ok, false); ok(/aarch64/.test(v.controlli[0].dettaglio));
    reset(); risposte['docker version'] = { code: 127 }; v = await X.verifica(officina, server, opz); eq(v.controlli[1].ok, false);
    reset(); risposte['ss -ltn'] = { stdout: 'LISTEN 0 128 0.0.0.0:8090\n' }; v = await X.verifica(officina, server, opz); eq(v.controlli.find((c) => /Porta/.test(c.nome)).ok, false);
    reset(); risposte["docker ps -a"] = { stdout: 'platform-officina\n' }; v = await X.verifica(officina, server, opz); eq(v.controlli.find((c) => /container/.test(c.nome)).ok, false);
    reset(); risposte['^df '] = { stdout: '/dev/sda1 100000 1000 500 99% /\n' }; v = await X.verifica(officina, server, opz); eq(v.controlli.find((c) => /Spazio/.test(c.nome)).ok, false);
  });
  await test('la copia: ordine dei comandi, database verificato per dimensione, segreti SOLO nel file riservato, porta e volume giusti', async () => {
    reset(); const { id } = await X.avvia(officina, { ...server }, 'SHA256:giusta', opz);
    const s = await attendi(() => { const x = X.stato(id, 'officina'); return x.fine ? x : null; });
    eq(s.errore, null); eq(s.esito.url, 'http://srv.example.com:8090');
    eq(s.passi.map((p) => p.fase), ['connessione', 'controlli', 'dati', 'allegati', 'segreti', 'immagine', 'avvio', 'prova']);
    const idx = (rx) => comandi.findIndex((c) => rx.test(c));
    ok(idx(/cat > .*officina\.db/) < idx(/tar xzf/) && idx(/tar xzf/) < idx(/cat > .*\/env/) && idx(/cat > .*\/env/) < idx(/docker load/) && idx(/docker load/) < idx(/docker run/), 'ordine sbagliato: ' + comandi.join(' | '));
    ok(/umask 077/.test(comandi[idx(/cat > .*\/env/)]), 'file dei segreti riservato');
    const envTxt = stdins[idx(/cat > .*\/env/)];
    ok(envTxt.includes('JWT_SECRET=JWTSEC_officina') && envTxt.includes('ENCRYPTION_KEY=ENCKEY_officina') && envTxt.includes('SUPER_ADMIN_URL=http://127.0.0.1:9'), 'env incompleto');
    ok(!envTxt.includes(process.env.INTERNAL_API_SECRET), 'il segreto interno di Super Admin non esce');
    const run = comandi[idx(/docker run/)]; ok(/-p 8090:80/.test(run) && /--restart unless-stopped/.test(run) && /--env-file/.test(run) && /:\/data/.test(run) && /platform-core:amd64/.test(run), run);
    ok(stdins[idx(/docker load/)].length > 0, 'l\'immagine è arrivata'); ok(stdins[idx(/tar xzf/)] === 'ALLEGATI-FINTI', 'allegati');
    ok(stdins[idx(/officina\.db/)].startsWith('SQLite format 3'), 'il database è una copia SQLite vera');
  });
  await test('niente segreti di accesso in nessun posto: né nello stato, né nei comandi, né nell\'audit; le credenziali si svuotano a fine lavoro', async () => {
    const tutto = JSON.stringify([...comandi, ...stdins.slice(0, 3)]) + JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    ok(!tutto.includes('LA-MIA-PASSWORD-SEGRETA'), 'la password è finita in un comando o nell\'audit');
    ok(connessioni[0].fingerprint === 'SHA256:giusta', 'impronta fissata nella connessione');
  });
  await test('impronta diversa da quella confermata: non si copia niente', async () => {
    reset(); impronta = 'SHA256:cambiata';
    const { id } = await X.avvia(officina, { ...server }, 'SHA256:giusta', opz); const s = await attendi(() => { const x = X.stato(id, 'officina'); return x.fine ? x : null; });
    ok(/impronta/.test(s.errore), s.errore); eq(comandi.length, 0, 'nessun comando eseguito');
    await rifiuta(() => X.avvia(officina, { ...server }, '', opz), /impronta/, 'senza impronta confermata');
  });
  await test('un controllo non superato ferma tutto prima di scrivere; se si rompe dopo l\'avvio, il container a metà viene tolto', async () => {
    reset(); risposte['uname -m'] = { stdout: 'armv7l\n' };
    let r = await X.avvia(officina, { ...server }, 'SHA256:giusta', opz); let s = await attendi(() => { const x = X.stato(r.id, 'officina'); return x.fine ? x : null; });
    ok(/Controlli non superati/.test(s.errore), s.errore); ok(comandi.every((c) => !/mkdir|cat >/.test(c)), 'non ha scritto niente');
    reset(); risposte['wget -qO-'] = { code: 1, stdout: '' };
    r = await X.avvia(officina, { ...server }, 'SHA256:giusta', opz); s = await attendi(() => { const x = X.stato(r.id, 'officina'); return x.fine ? x : null; }, 15000);
    ok(/non risponde/.test(s.errore) && /ho tolto il container/.test(s.errore), s.errore); ok(comandi.some((c) => /docker rm -f/.test(c)));
  });
  await test('un solo lavoro alla volta per tenant; lo stato è visibile solo al tenant giusto', async () => {
    reset(); risposte['docker load'] = { stdout: 'Loaded image: x:1\n' };
    X.deps.imageStream = async () => { await new Promise((r) => setTimeout(r, 300)); return Readable.from([Buffer.from('x')]); };
    const a = await X.avvia(officina, { ...server }, 'SHA256:giusta', opz);
    await rifiuta(() => X.avvia(officina, { ...server }, 'SHA256:giusta', opz), /già in corso/, 'secondo lavoro');
    eq(X.stato(a.id, 'altro'), null); ok(X.stato(a.id, 'officina'));
    await attendi(() => X.stato(a.id, 'officina').fine);
  });

  console.log('\n--- rotte: il tenant prova chi è col SUO segreto ---');
  const firma = (tenant, extra = {}, secret) => jwt.sign({ slug: tenant.slug, purpose: 'export', ...extra }, secret || tenant.jwt_secret, { expiresIn: 300 });
  const chiama = (slug, p, token, body, method = 'POST') => fetch(BASE + '/api/tenant-export/' + slug + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  await test('senza token, con il segreto interno condiviso, con il token di un altro tenant, con uno scopo diverso o scaduto: 401', async () => {
    eq((await chiama('officina', '/verifica', null, { server })).status, 401);
    eq((await chiama('officina', '/verifica', process.env.INTERNAL_API_SECRET, { server })).status, 401, 'il segreto condiviso non basta');
    eq((await chiama('officina', '/verifica', firma(altro), { server })).status, 401, 'token di un altro tenant');
    eq((await chiama('officina', '/verifica', firma(officina, { purpose: 'builder' }), { server })).status, 401);
    eq((await chiama('officina', '/verifica', firma(officina, { slug: 'altro' }), { server })).status, 401, 'slug diverso nel token');
    eq((await chiama('officina', '/verifica', jwt.sign({ slug: 'officina', purpose: 'export' }, 'a-caso'), { server })).status, 401);
    eq((await chiama('officina', '/verifica', jwt.sign({ slug: 'officina', purpose: 'export' }, officina.jwt_secret, { expiresIn: -10 }), { server })).status, 401, 'scaduto');
    eq((await chiama('inesistente', '/verifica', firma(officina), { server })).status, 401);
  });
  await test('con il token giusto: verifica e avvio funzionano; le credenziali servono; il corpo è ripulito', async () => {
    reset(); X.deps.imageStream = async () => Readable.from([Buffer.from('x')]);
    eq((await chiama('officina', '/verifica', firma(officina), { server: { host: 'srv.example.com', username: '', password: 'x' } })).status, 400, 'senza utente');
    let r = await chiama('officina', '/verifica', firma(officina), { server, opzioni: opz }); eq(r.status, 200); const v = await r.json(); eq([v.ok, v.fingerprint], [true, 'SHA256:giusta']);
    eq((await chiama('officina', '/verifica', firma(officina), { server: { ...server, host: '127.0.0.1' }, opzioni: opz })).status, 400, 'loopback vietato');
    r = await chiama('officina', '/avvia', firma(officina), { server, fingerprint: 'SHA256:giusta', opzioni: opz }); eq(r.status, 202); const { id } = await r.json();
    const s = await attendi(async () => null, 1).catch(() => null) || await (async () => { const t = Date.now(); while (Date.now() - t < 8000) { const x = await (await chiama('officina', '/stato/' + id, firma(officina), null, 'GET')).json(); if (x.fine) return x; await new Promise((q) => setTimeout(q, 30)); } })();
    eq(s.errore, null); ok(!JSON.stringify(s).includes('PASSWORD'), 'nessuna credenziale nello stato');
    eq((await chiama('officina', '/stato/' + id, firma(altro), null, 'GET')).status, 401);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
