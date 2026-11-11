'use strict';
// Backup 0.5.2: allegati nel backup, conservazione giornaliera+settimanale+mensile, avviso di backup mancante, backup del disco Linode (simulato).
// Eseguire con: node src/backup-allegati.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-all-'));
process.env.DB_PATH = path.join(tmp, 'sa.db'); process.env.BACKUP_ROOT = path.join(tmp, 'backups');
process.env.ENCRYPTION_KEY = 'k_' + crypto.randomBytes(8).toString('hex'); process.env.JWT_SECRET = 'j_' + crypto.randomBytes(8).toString('hex');
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const Database = require('better-sqlite3');
const db = require('./db');
const sched = require('./backup-scheduler');
const bkAll = require('./lib/backup-allegati');
const { spawnSync } = require('child_process');

async function main() {
  // un tenant sul NAS con un database vero e una cartella allegati vera
  const dati = path.join(tmp, 'data'); fs.mkdirSync(path.join(dati, 'prova', 'uploads', 'prova'), { recursive: true });
  fs.writeFileSync(path.join(dati, 'prova', 'uploads', 'prova', 'bolletta.txt'), 'ciao');
  const dbTenant = path.join(dati, 'prova', 'prova.db'); const d = new Database(dbTenant); d.exec('CREATE TABLE modules (id INTEGER)'); d.close();
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, backup_auto_enabled) VALUES ('Prova', 'prova', 47501, ?, 'active', 1)").run(dbTenant);
  bkAll.deps.cartellaNas = (slug) => path.join(dati, slug, 'uploads');
  const exp = require('./lib/tenant-export');
  const origAllegati = exp.deps.allegati;
  exp.deps.allegati = (slug, tenant) => {
    const dir = path.join(dati, slug, 'uploads'); if (!fs.existsSync(path.join(dir, slug))) return null;
    const { PassThrough } = require('stream'); const out = new PassThrough();
    const p = require('child_process').spawn('tar', ['czf', '-', '-C', dir, slug]); p.stdout.pipe(out); return out;
  };

  await test('un backup salva anche gli allegati in un archivio accanto al database', async () => {
    const r = await sched.runBackupForTenant('prova', { trigger: 'manual' });
    eq(r.ok, true);
    const riga = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = 'prova' ORDER BY id DESC LIMIT 1").get();
    ok(riga.allegati_file && fs.existsSync(riga.allegati_file), 'archivio presente'); ok(riga.allegati_size_mb >= 0);
    const v = await bkAll.verifica(riga.allegati_file); eq(v.ok, true); eq(v.file, 1);
  });
  await test('un tenant senza allegati fa il backup lo stesso, senza archivio e senza errore', async () => {
    fs.rmSync(path.join(dati, 'prova', 'uploads'), { recursive: true });
    const r = await sched.runBackupForTenant('prova', { trigger: 'manual' }); eq(r.ok, true);
    const riga = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = 'prova' ORDER BY id DESC LIMIT 1").get();
    eq(riga.allegati_file, null); eq(riga.allegati_error, null);
  });
  await test('un errore sugli allegati NON fa fallire il backup del database: si registra', async () => {
    exp.deps.allegati = () => { throw new Error('server irraggiungibile'); };
    const r = await sched.runBackupForTenant('prova', { trigger: 'manual' }); eq(r.ok, true);
    const riga = db.prepare("SELECT * FROM tenant_backups WHERE tenant_slug = 'prova' ORDER BY id DESC LIMIT 1").get();
    ok(/irraggiungibile/.test(riga.allegati_error), riga.allegati_error);
  });
  await test('ripristino degli allegati: i file tornano, senza cancellare gli altri', async () => {
    fs.mkdirSync(path.join(dati, 'prova', 'uploads', 'prova'), { recursive: true }); fs.writeFileSync(path.join(dati, 'prova', 'uploads', 'prova', 'altro.txt'), 'resta');
    const tar = path.join(tmp, 'a.tar.gz'); fs.mkdirSync(path.join(tmp, 'src', 'prova'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'src', 'prova', 'bolletta.txt'), 'ciao');
    spawnSync('tar', ['czf', tar, '-C', path.join(tmp, 'src'), 'prova']);
    await bkAll.ripristina({ slug: 'prova', host: 'nas' }, tar);
    eq(fs.readFileSync(path.join(dati, 'prova', 'uploads', 'prova', 'bolletta.txt'), 'utf8'), 'ciao'); ok(fs.existsSync(path.join(dati, 'prova', 'uploads', 'prova', 'altro.txt')), 'l\'altro file resta');
  });
  await test('conservazione: ultimi N giornalieri + una per settimana (4) + una per mese (6); allegati cancellati insieme', async () => {
    db.prepare("DELETE FROM tenant_backups WHERE tenant_slug = 'prova'").run();
    const ins = db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, size_mb, status, trigger, created_at, allegati_file) VALUES ('prova', ?, 1, 'ok', 'auto', ?, ?)");
    const giorno = (n) => new Date(Date.UTC(2026, 10, 11) - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    for (let n = 0; n < 200; n++) { const f = path.join(tmp, 'b' + n + '.db'); fs.writeFileSync(f, 'x'); const a = path.join(tmp, 'b' + n + '.tar.gz'); fs.writeFileSync(a, 'x'); ins.run(f, giorno(n), a); }
    sched.applyRetention('prova', 7);
    const resta = db.prepare("SELECT created_at FROM tenant_backups WHERE tenant_slug = 'prova'").all().length;
    ok(resta >= 7 + 3 && resta <= 7 + 4 + 6, 'rimaste ' + resta);
    ok(!fs.existsSync(path.join(tmp, 'b199.db')) && !fs.existsSync(path.join(tmp, 'b199.tar.gz')), 'vecchio: file e archivio tolti');
    ok(fs.existsSync(path.join(tmp, 'b0.db')) && fs.existsSync(path.join(tmp, 'b6.tar.gz')), 'recenti tenuti');
  });
  await test('backup mancante: avvisa dopo 36 ore, una volta al giorno, non prima', async () => {
    db.prepare("DELETE FROM tenant_backups WHERE tenant_slug = 'prova'").run();
    const ora = Date.now();
    const quando = (h) => new Date(ora - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare("INSERT INTO tenant_backups (tenant_slug, file_path, status, trigger, created_at) VALUES ('prova', 'x', 'ok', 'auto', ?)").run(quando(10));
    eq(await sched.controllaBackupMancanti(ora), []);
    db.prepare("UPDATE tenant_backups SET created_at = ?").run(quando(40));
    eq(await sched.controllaBackupMancanti(ora), ['prova']);
    eq(await sched.controllaBackupMancanti(ora + 3600000), [], 'una volta al giorno');
    eq(await sched.controllaBackupMancanti(ora + 25 * 3600000), ['prova'], 'il giorno dopo di nuovo');
  });

  // ── Linode (simulato) ──
  const linode = require('./lib/linode');
  db.prepare("INSERT OR REPLACE INTO cloud_settings (key, value) VALUES ('linode_token', ?)").run(require('./crypto-secrets').encrypt('token-di-prova-1234567890'));
  const chiamate = []; let stato = 'running', passiRestoring = 0;
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url); if (!u.startsWith('https://api.linode.com/v4')) return realFetch(url, opts);
    const p = u.replace('https://api.linode.com/v4', ''), m = opts.method || 'GET'; chiamate.push(m + ' ' + p + (opts.body ? ' ' + opts.body : ''));
    const r = (s, b) => ({ ok: s < 400, status: s, json: async () => b });
    if (m === 'GET' && p === '/linode/instances/7/backups') return r(200, { automatic: [{ id: 101, type: 'auto', status: 'successful', created: '2026-11-10T03:00:00', finished: '2026-11-10T03:05:00', available: true, disks: [{ label: 'Ubuntu', size: 20000 }] }, { id: 102, type: 'auto', status: 'running', created: '2026-11-11T03:00:00', available: false, disks: [] }], snapshot: { current: null, in_progress: null } });
    if (m === 'GET' && p === '/linode/instances/7') { if (stato === 'restoring' && passiRestoring-- <= 0) stato = 'offline'; return r(200, { status: stato }); }
    if (m === 'POST' && p === '/linode/instances/7/shutdown') { stato = 'offline'; return r(200, {}); }
    if (m === 'POST' && p === '/linode/instances/7/backups/101/restore') { stato = 'restoring'; passiRestoring = 1; return r(200, {}); }
    if (m === 'POST' && p === '/linode/instances/7/boot') { stato = 'running'; return r(200, {}); }
    return r(404, {});
  };
  await test('copie del disco: elenco con stato e «disponibile» solo se riuscita', async () => {
    const e = await linode.elencoBackupDisco(7);
    eq(e.automatici.map((b) => [b.id, b.disponibile]), [[101, true], [102, false]]); eq(e.automatici[0].dischi, [{ nome: 'Ubuntu', mb: 20000 }]);
  });
  await test('ripristino del disco: spegne, ripristina con overwrite, riaccende; non parte su una copia non pronta', async () => {
    chiamate.length = 0; const fasi = [];
    const r = await linode.ripristinaBackupDisco(7, 101, { say: (f) => fasi.push(f), attesa: async () => {} });
    eq(r.ripristinato, 101);
    const ordine = chiamate.filter((c) => c.startsWith('POST')).map((c) => c.split(' ')[1].replace('/linode/instances/7', ''));
    eq(ordine, ['/shutdown', '/backups/101/restore', '/boot']);
    ok(chiamate.some((c) => c.includes('"overwrite":true') && c.includes('"linode_id":7')), 'overwrite su se stesso');
    chiamate.length = 0;
    let err; try { await linode.ripristinaBackupDisco(7, 102, { attesa: async () => {} }); } catch (e) { err = e; }
    eq(err && err.status, 409); ok(!chiamate.some((c) => c.startsWith('POST')), 'nessuna scrittura');
    err = null; try { await linode.ripristinaBackupDisco(7, 999, { attesa: async () => {} }); } catch (e) { err = e; }
    eq(err && err.status, 404);
  });
  global.fetch = realFetch; exp.deps.allegati = origAllegati;
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
