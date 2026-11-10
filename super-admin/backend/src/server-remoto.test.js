'use strict';
// Tenant su un server Linode (lib/server-remoto.js, lib/linode.js, createTenant con host «linode»): creazione, rimedio ai fallimenti, freno alla spesa, backup dal server remoto,
// cancellazione solo con la copia di sicurezza. Linode, SSH, Cloudflare e il tenant sono simulati. Eseguire con: node src/server-remoto.test.js (porta 34871 libera).
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto'), { Readable } = require('stream');
const TEST_PORT = 34871, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'remoto-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rm_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rm_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'rm_enc_' + crypto.randomBytes(8).toString('hex');
process.env.BACKUP_ROOT = path.join(os.tmpdir(), 'remoto-bk-' + crypto.randomBytes(4).toString('hex'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const realFetch = global.fetch;
const linodeChiamate = []; let serviziLinode = [{ id: 1 }]; let prossimoId = 500;
global.fetch = async (url, opts = {}) => {
  const u = String(url), met = opts.method || 'GET';
  const r = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (u.startsWith('https://api.linode.com/v4')) {
    const p = u.replace('https://api.linode.com/v4', ''); linodeChiamate.push({ met, p, corpo: opts.body ? JSON.parse(opts.body) : null });
    if (p.startsWith('/linode/instances?') && met === 'GET') return r(200, { data: serviziLinode });
    if (p === '/linode/instances' && met === 'POST') { const id = prossimoId++; serviziLinode.push({ id }); return r(200, { id, status: 'provisioning', ipv4: ['203.0.113.' + (id % 200)] }); }
    if (/^\/linode\/instances\/\d+$/.test(p) && met === 'DELETE') { serviziLinode = serviziLinode.filter((s) => '/linode/instances/' + s.id !== p); return r(200, {}); }
    if (p.startsWith('/regions/')) return r(200, { label: 'Milan', country: 'it' });
    return r(404, { errors: [{ reason: 'non trovato' }] });
  }
  if (u.startsWith('https://api.cloudflare.com/client/v4')) {
    const p = u.replace('https://api.cloudflare.com/client/v4', '');
    if (met === 'GET' && p.includes('/dns_records')) return r(200, { success: true, result: [] });
    if (met === 'POST' && p.endsWith('/dns_records')) return r(200, { success: true, result: { proxied: true } });
    if (met === 'DELETE') return r(200, { success: true, result: {} });
    return r(200, { success: true, result: {} });
  }
  if (/^https:\/\/[a-z0-9-]+\.platform-test\.it\//.test(u)) return r(200, { ok: true });
  return realFetch(url, opts);
};

async function main() {
  const db = require('./db'); const linode = require('./lib/linode'); const remoto = require('./lib/server-remoto'); const cf = require('./lib/cloudflare'); const th = require('./lib/tenant-host');
  linode.salvaToken('token-linode-di-prova-1234567890');
  cf.salvaToken('token-cf-di-prova-1234567890'); cf.salvaImpostazioni({ zona: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', dominio: 'platform-test.it', ip: '198.51.100.7' });

  // SSH finto: registra i comandi, risponde come un server sano
  const comandi = []; let avviaOk = true, sshPronto = true, fallisciSu = null, dbRemoto = Buffer.from('SQLITE-FINTO-' + 'x'.repeat(200));
  remoto.deps.connect = async (opts) => {
    if (!sshPronto) throw new Error('connessione rifiutata');
    return { fingerprint: 'SHA256:impronta-finta', close() {}, run: async (cmd, o = {}) => {
      comandi.push(cmd);
      if (fallisciSu && cmd.includes(fallisciSu)) return { code: 1, stdout: '', stderr: 'errore simulato' };
      if (cmd.includes('docker load')) { if (o.stdin && o.stdin.resume) await new Promise((res) => { o.stdin.on('end', res); o.stdin.resume(); }); return { code: 0, stdout: 'Loaded image: platform-core:latest\n', stderr: '' }; }
      if (cmd.startsWith("cat > '/srv") && o.stdin && o.stdin.resume) { await new Promise((res) => { o.stdin.on('end', res); o.stdin.resume(); }); return { code: 0, stdout: '', stderr: '' }; }
      if (cmd.startsWith('docker exec -i') && cmd.includes('password_hash')) return { code: 0, stdout: 'ok\n', stderr: '' };
      if (cmd.startsWith('docker exec -i') && cmd.includes('JSON.parse')) return { code: 0, stdout: JSON.stringify({ ok: [{ n: 1 }] }) + '\n', stderr: '' };
      if (cmd.startsWith('docker inspect -f')) return { code: 0, stdout: 'running|2026-11-10T10:00:00Z\n', stderr: '' };
      if (cmd.startsWith('docker stats')) return { code: 0, stdout: '0.5%|120MiB / 961MiB|12.5%|1.2kB / 3.4kB\n', stderr: '' };
      if (cmd.includes('curl -s -m 5')) return { code: 0, stdout: avviaOk ? '200' : '000', stderr: '' };
      if (cmd.startsWith('wc -c')) return { code: 0, stdout: String(dbRemoto.length) + '\n', stderr: '' };
      if (cmd.startsWith("cat '/srv") && o.onStdout) { o.onStdout(dbRemoto); return { code: 0, stdout: '', stderr: '' }; }
      return { code: 0, stdout: '', stderr: '' };
    } };
  };
  remoto.deps.imageStream = async () => Readable.from([Buffer.from('tar-finto')]);
  remoto.deps.attesa = async () => {}; remoto.deps.passoSsh = 0; remoto.deps.passoAvvio = 0;
  remoto.deps.proveHttps = async () => true;

  const tenant = (slug) => ({ slug, name: 'Prova ' + slug, jwt_secret: 'j'.repeat(64), encryption_key: 'e'.repeat(64) });
  const inserisci = (slug) => db.prepare("INSERT INTO tenants (name, slug, port, db_path, status) VALUES (?, ?, ?, ?, 'active')").run('Prova ' + slug, slug, 48000 + Math.floor(Math.random() * 900), '/data/' + slug + '/' + slug + '.db');

  await test('la chiave SSH di Super Admin si crea una volta, la privata è cifrata nel database', async () => {
    const k = remoto.chiave(); ok(k.pubblica.startsWith('ssh-ed25519 '), 'pubblica'); ok(k.privata.includes('OPENSSH PRIVATE KEY'), 'privata');
    ok(!db.prepare("SELECT value FROM cloud_settings WHERE key = 'ssh_privata'").get().value.includes('OPENSSH'), 'cifrata a riposo');
    eq(remoto.chiave().pubblica, k.pubblica, 'stessa chiave la volta dopo');
  });

  await test('crea: server su Linode con la nostra chiave, Docker+Caddy, immagine, segreti, container e Caddy sul dominio; l\'impronta si fissa', async () => {
    inserisci('alfa'); comandi.length = 0; linodeChiamate.length = 0;
    const dnsIp = []; const dicono = [];
    const r = await remoto.crea({ ...tenant('alfa') }, { dominio: 'alfa.platform-test.it', superAdminUrl: 'https://admin.platform-test.it', internalSecret: 'segreto-interno', passwordIniziale: 'pw-iniziale', say: (m) => dicono.push(m), dns: async (ip) => dnsIp.push(ip) });
    const post = linodeChiamate.find((c) => c.met === 'POST'); ok(post.corpo.authorized_keys[0].startsWith('ssh-ed25519'), 'chiave'); eq(post.corpo.region, 'it-mil'); eq(post.corpo.type, 'g6-nanode-1'); eq(post.corpo.backups_enabled, true);
    ok(!JSON.stringify(post.corpo).includes('token-linode'), 'il token non viaggia nel corpo');
    eq(dnsIp, [r.ip], 'DNS verso l\'IP del server');
    const tutti = comandi.join('\n'); ok(/apt-get install -y -qq docker\.io caddy/.test(tutti), 'docker e caddy'); ok(tutti.includes('docker load'), 'immagine'); ok(tutti.includes('--restart unless-stopped'), 'restart'); ok(tutti.includes('127.0.0.1:8080:80'), 'solo locale');
    ok(tutti.includes('systemctl reload caddy'), 'caddy');
    const riga = db.prepare("SELECT host, linode_id, remote_ip, remote_fingerprint FROM tenants WHERE slug = 'alfa'").get();
    eq(riga.host, 'linode'); eq(riga.linode_id, r.linode_id); eq(riga.remote_fingerprint, 'SHA256:impronta-finta');
  });

  await test('se un passo fallisce il server appena creato si cancella (non resta a costare) e l\'errore arriva', async () => {
    inserisci('beta'); fallisciSu = 'docker load'; linodeChiamate.length = 0;
    let errore = null; try { await remoto.crea(tenant('beta'), { dominio: 'beta.platform-test.it', superAdminUrl: 'x', internalSecret: 's' }); } catch (e) { errore = e; }
    fallisciSu = null; ok(errore && /errore simulato/.test(errore.message), 'errore: ' + (errore && errore.message));
    ok(linodeChiamate.some((c) => c.met === 'DELETE'), 'server cancellato');
    eq(db.prepare("SELECT linode_id FROM tenants WHERE slug = 'beta'").get().linode_id, null);
  });

  await test('se il server non si accende in tempo: errore chiaro e server cancellato', async () => {
    inserisci('gamma'); sshPronto = false; linodeChiamate.length = 0; remoto.deps.tentativiSsh = 3;
    let errore = null; try { await remoto.crea(tenant('gamma'), { dominio: 'gamma.platform-test.it', superAdminUrl: 'x', internalSecret: 's' }); } catch (e) { errore = e; }
    sshPronto = true; remoto.deps.tentativiSsh = 40; ok(errore && /non si è acceso/.test(errore.message), errore && errore.message); ok(linodeChiamate.some((c) => c.met === 'DELETE'));
  });

  await test('freno alla spesa: oltre il massimo di server non se ne creano', async () => {
    serviziLinode = Array.from({ length: 5 }, (_, i) => ({ id: 900 + i })); linodeChiamate.length = 0;
    let errore = null; try { await linode.creaServer({ nome: 'plt-delta', chiavi: ['ssh-ed25519 AAAA x'] }); } catch (e) { errore = e; }
    ok(errore && errore.status === 409 && /massimo/.test(errore.message), errore && errore.message); ok(!linodeChiamate.some((c) => c.met === 'POST'), 'nessun server creato');
    serviziLinode = [{ id: 1 }];
  });

  await test('un dominio non valido o mancante si rifiuta prima di spendere', async () => {
    linodeChiamate.length = 0; let e1 = null; try { await remoto.crea(tenant('eps'), { dominio: '', superAdminUrl: 'x', internalSecret: 's' }); } catch (e) { e1 = e; }
    ok(e1 && e1.status === 400); ok(!linodeChiamate.length, 'nessuna chiamata a Linode');
  });

  await test('tenant-host: NAS dentro Docker, Linode dal suo dominio', async () => {
    inserisci('nasone'); db.prepare("UPDATE tenants SET domain = 'alfa.platform-test.it' WHERE slug = 'alfa'").run();
    eq(th.base('nasone'), 'http://platform-nasone:80'); eq(th.base('alfa'), 'https://alfa.platform-test.it');
  });

  await test('backup di un tenant su Linode: scarica una copia consistente, la registra e la dimensione combacia', async () => {
    const { runBackupForTenant } = require('./backup-scheduler');
    const res = await runBackupForTenant('alfa', { trigger: 'manual', actor: 't' });
    ok(res.ok, JSON.stringify(res)); eq(fs.readFileSync(res.file).length, dbRemoto.length);
    ok(comandi.some((c) => c.includes('VACUUM INTO')), 'VACUUM INTO sul server');
    fs.rmSync(path.dirname(res.file), { recursive: true, force: true });
  });

  await test('cancellare un tenant su Linode: prima la copia di sicurezza, poi il server; se la copia fallisce il server RESTA', async () => {
    require('./index.js');
    for (let i = 0; i < 100; i++) { try { const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
    const bcrypt = require('bcryptjs');
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('rm_user', ?, 'admin')").run(bcrypt.hashSync('rm_pw_123456', 10));
    const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rm_user', password: 'rm_pw_123456' }) });
    const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
    sshPronto = false; linodeChiamate.length = 0;
    const no = await realFetch(BASE + '/api/tenants/alfa', { method: 'DELETE', headers: H });
    eq(no.status, 409); ok(/Il server resta/.test((await no.json()).error), 'messaggio');
    ok(!linodeChiamate.some((c) => c.met === 'DELETE'), 'il server NON si cancella senza copia');
    ok(db.prepare("SELECT 1 FROM tenants WHERE slug = 'alfa'").get(), 'il tenant resta registrato');
    sshPronto = true; linodeChiamate.length = 0;
    const si = await realFetch(BASE + '/api/tenants/alfa', { method: 'DELETE', headers: H });
    eq(si.status, 200); ok((await si.json()).safety_backup.ok, 'copia di sicurezza fatta');
    ok(linodeChiamate.some((c) => c.met === 'DELETE'), 'server cancellato dopo la copia');
    ok(!db.prepare("SELECT 1 FROM tenants WHERE slug = 'alfa'").get(), 'tenant tolto');
  });

  await test('creare un tenant con host «linode» dall\'API: dominio e DNS verso il server, host salvato; host sconosciuto rifiutato', async () => {
    const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rm_user', password: 'rm_pw_123456' }) });
    const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
    const strano = await realFetch(BASE + '/api/tenants', { method: 'POST', headers: H, body: JSON.stringify({ name: 'X', slug: 'xx', host: 'marte' }) }); eq(strano.status, 400);
    linodeChiamate.length = 0;
    const r = await realFetch(BASE + '/api/tenants', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Nuovo Linode', slug: 'nuovo', host: 'linode' }) });
    const j = await r.json(); eq(r.status, 200, JSON.stringify(j)); eq(j.host, 'linode'); eq(j.domain, 'nuovo.platform-test.it'); ok(j.linode_id > 0 && j.remote_ip, 'server collegato'); eq(j.status, 'active');
    ok(!('encryption_key' in j) && !('jwt_secret' in j), 'i segreti non escono');
  });

  await test('ripristino: il backup viaggia e si controlla PRIMA di fermare il tenant; il database attuale resta accanto, mai buttato', async () => {
    inserisci('rip1'); const t = db.prepare("SELECT * FROM tenants WHERE slug='rip1'").get();
    const f = path.join(os.tmpdir(), 'bk-' + crypto.randomBytes(3).toString('hex') + '.db'); fs.writeFileSync(f, dbRemoto);
    comandi.length = 0; avviaOk = true;
    await remoto.ripristinaDatabase(Object.assign(t, { remote_ip: '203.0.113.9' }), f);
    const i = (re) => comandi.findIndex((c) => re.test(c));
    ok(i(/^cat > .*_ripristino\.db/) >= 0 && i(/integrity_check/) > i(/^cat > .*_ripristino/), 'carica e poi controlla');
    ok(i(/docker stop/) > i(/integrity_check/), 'ferma solo dopo il controllo');
    ok(/mv '[^']*rip1\.db' '[^']*prima-ripristino/.test(comandi.join('\n')), 'il database attuale resta accanto');
    ok(i(/docker start/) > i(/docker stop/), 'riaccende');
  });

  await test('ripristino: se il tenant non riparte col backup, si rimette il database di prima e si riaccende', async () => {
    inserisci('rip2'); const t = db.prepare("SELECT * FROM tenants WHERE slug='rip2'").get();
    const f = path.join(os.tmpdir(), 'bk-' + crypto.randomBytes(3).toString('hex') + '.db'); fs.writeFileSync(f, dbRemoto);
    comandi.length = 0; avviaOk = false; let msg = '';
    try { await remoto.ripristinaDatabase(Object.assign(t, { remote_ip: '203.0.113.9' }), f); } catch (e) { msg = e.message; }
    avviaOk = true;
    ok(/ho rimesso il database di prima/.test(msg), 'errore chiaro: ' + msg);
    ok(/mv '[^']*prima-ripristino[^']*' '[^']*rip2\.db'/.test(comandi.join('\n')), 'rimesso il vecchio');
    ok(comandi.filter((c) => /docker start/.test(c)).length >= 2, 'riacceso dopo il ritorno');
  });

  await test('ripristino: backup di dimensione sbagliata sul server → niente viene fermato', async () => {
    inserisci('rip3'); const t = db.prepare("SELECT * FROM tenants WHERE slug='rip3'").get();
    const f = path.join(os.tmpdir(), 'bk-' + crypto.randomBytes(3).toString('hex') + '.db'); fs.writeFileSync(f, Buffer.from('piccolo'));
    comandi.length = 0; let msg = '';
    try { await remoto.ripristinaDatabase(Object.assign(t, { remote_ip: '203.0.113.9' }), f); } catch (e) { msg = e.message; }
    ok(/dimensione giusta/.test(msg), msg); ok(!comandi.some((c) => /docker stop/.test(c)), 'il tenant non è stato fermato');
  });

  await test('reset password su Linode: l\'hash viaggia su stdin, la password non compare nei comandi', async () => {
    inserisci('pw1'); const t = Object.assign(db.prepare("SELECT * FROM tenants WHERE slug='pw1'").get(), { remote_ip: '203.0.113.9' });
    comandi.length = 0; await remoto.reimpostaPasswordAdmin(t, '$2a$10$hashdiprova');
    const c = comandi.find((x) => /docker exec -i/.test(x)); ok(c && !c.includes('hashdiprova'), 'hash non nel comando');
  });

  await test('sessioni e statistiche su Linode: la query gira nel container, i valori su stdin e mai nel comando; stato e consumi si leggono dal server', async () => {
    inserisci('sess1'); const t = Object.assign(db.prepare("SELECT * FROM tenants WHERE slug='sess1'").get(), { remote_ip: '203.0.113.9' });
    comandi.length = 0; const r = await remoto.interroga(t, { sql: 'SELECT 1', params: ["x'; DROP TABLE users; --"] });
    ok(Array.isArray(r), 'righe'); const c = comandi.find((x) => /docker exec -i/.test(x)); ok(c && !c.includes('DROP TABLE'), 'il valore non è nel comando');
    const st = await remoto.statoContainer(t); eq(st.running, true); eq(st.mem_usage_mb, 120); eq(st.cpu_percent, 0.5);
  });

  await test('Libreria: i moduli di un tenant su Linode si leggono dal suo server (elenco), un tenant che non c\'è dà 404', async () => {
    inserisci('lib1'); db.prepare("UPDATE tenants SET host='linode', remote_ip='203.0.113.9' WHERE slug='lib1'").run();
    const login = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rm_user', password: 'rm_pw_123456' }) });
    const H = { Authorization: 'Bearer ' + (await login.json()).token };
    comandi.length = 0;
    const r = await realFetch(BASE + '/api/registry/tenants/lib1/modules', { headers: H }); eq(r.status, 200); ok(Array.isArray(await r.json()), 'elenco');
    ok(comandi.some((c) => /docker exec -i/.test(c) && /FROM modules/.test(c) === false), 'la query è girata sul server (valori fuori dal comando)');
    eq((await realFetch(BASE + '/api/registry/tenants/non-esiste/modules', { headers: H })).status, 404);
  });

  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
