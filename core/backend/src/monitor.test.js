'use strict';
// Monitoraggio mensile su WhatsApp (monitor.js): un messaggio per widget "Come sta andando" con la casella accesa, il giorno 2 alle 9 (ora italiana).
// Eseguire con: node src/monitor.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'monitor-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'mon_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mon_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mon-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'monitor';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

(async () => {
  const db = require('./db');
  const roles = require('./module-roles');
  const monitor = require('./monitor');
  const wa = require('./whatsapp');
  require('./features').set('whatsapp', true);
  for (const [slug, n] of [['entrate', 'Entrate'], ['spese_personali', 'Spese personali'], ['spese_casa', 'Spese casa']]) db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 60, '{}')").run(n, slug);
  roles.seedIfEmpty();
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'k' }));
  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '3331111111', ?, 1)").run(JSON.stringify(['report']));
  const sent = [];
  wa.sendAll = async ({ testo, kind }) => { sent.push({ testo, kind }); return { esito: 'inviato', dettaglio: 'Nima ✓' }; };
  const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify(d));
  rec('entrate', { descrizione: 'Stipendio', data: '2026-09-27', importo: 2000, categoria: 'Stipendio', gruppo: 'Personale' });
  rec('spese_personali', { descrizione: 'Spesa', data: '2026-09-10', importo: 500, categoria: 'Alimentari', _stato: 'pagato' });
  rec('spese_casa', { descrizione: 'Affitto', data: '2026-09-27', importo: 550, categoria: 'Affitto/Mutuo', _stato: 'da_pagare', fisso: true });
  rec('spese_casa', { descrizione: 'Luce', data: '2026-09-07', importo: 64, categoria: 'Elettricità', _stato: 'pagato' });
  const widget = (label, cfg) => db.prepare("INSERT INTO dashboard_widgets (type, label, config) VALUES ('come_sta_andando', ?, ?)").run(label, JSON.stringify(cfg)).lastInsertRowid;
  const wp = widget('Come sta andando — Personale', { monitor: true, spese_modules: ['spese_personali'] });
  const wc = widget('Come sta andando — Casa', { monitor: true, spese_modules: ['spese_casa'], solo_spese: true });
  widget('Senza monitoraggio', { spese_modules: ['spese_personali'] });
  const GIORNO2 = new Date('2026-10-02T07:00:00Z'); // 09:00 a Roma

  await test('fuori dal giorno 2 alle 9 non parte niente', async () => {
    for (const d of ['2026-10-01T07:00:00Z', '2026-10-03T07:00:00Z', '2026-10-02T09:00:00Z']) { const r = await monitor.tick(new Date(d)); assertEq(r.skipped, 'non è il momento'); }
    assertEq(sent.length, 0);
  });
  await test('il giorno 2 alle 9: un messaggio per widget con il monitoraggio acceso, del mese concluso', async () => {
    const r = await monitor.tick(GIORNO2);
    assertEq(r.month, '2026-09'); assertEq(sent.length, 2);
    assertEq(sent.map((s) => s.kind), ['monitoraggio', 'monitoraggio']);
  });
  await test('il messaggio personale: titolo, mese, entrate, spese, saldo', () => {
    const t = sent[0].testo;
    assertTrue(t.startsWith('*Come sta andando — Personale* (settembre 2026)') && t.includes('Entrate 2.000 €') && t.includes('Spese 500 €') && t.includes('Saldo 1.500 €'), t);
  });
  await test('il messaggio di casa (sole spese): niente entrate, ma pagate e da pagare', () => {
    const t = sent[1].testo;
    assertTrue(t.includes('Casa') && t.includes('Spese 614,00 €') && t.includes('pagate 64,00 €') && t.includes('da pagare 550,00 €') && !t.includes('Entrate') && !t.includes('Saldo'), t);
  });
  await test('lo stesso mese non si manda due volte', async () => {
    await monitor.tick(GIORNO2); assertEq(sent.length, 2);
  });
  await test('il mese dopo parte di nuovo', async () => {
    rec('spese_personali', { descrizione: 'Spesa', data: '2026-10-10', importo: 100, categoria: 'Alimentari', _stato: 'pagato' });
    rec('entrate', { descrizione: 'Stipendio', data: '2026-10-27', importo: 2000, categoria: 'Stipendio', gruppo: 'Personale' });
    const r = await monitor.tick(new Date('2026-11-02T08:00:00Z')); assertEq(r.month, '2026-10'); assertEq(sent.length, 4);
  });
  await test('con l\'AI accesa ma che non risponde, il messaggio parte lo stesso, coi soli numeri', async () => {
    require('./module-ai').setMaster(true);
    const before = sent.length;
    const r = await monitor.sendFor({ id: wp, label: 'Come sta andando — Personale', config: JSON.stringify({ monitor: true, spese_modules: ['spese_personali'] }) }, '2026-09');
    assertEq(sent.length, before + 1); assertTrue(!/\n\n/.test(sent[sent.length - 1].testo), 'nessun commento');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
