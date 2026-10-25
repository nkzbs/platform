'use strict';
// Poller Drive (drive-poller.js): un file aggiunto da fuori (l'app Drive del telefono,
// non da Platform) diventa un record nel modulo ad archivio — bidirezionale, richiesto
// dall'utente il 25/10/2026 ("così carico i file da app Google drive").
// Eseguire con: node src/drive-poller.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'drive-poller-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'dp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'dp_enc_' + crypto.randomBytes(16).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

// drive-poller.js destruttura le funzioni di google-oauth al momento della chiamata
// (require inline dentro pollDrive), così il finto modulo sotto può essere sostituito
// e cambiato liberamente test per test, senza nessuna vera telefonata a Google.
let driveEnabled = true;
let fakeFiles = []; // ogni file può avere `cartella` (nome sottocartella) o null/assente = radice
let fakeCartelle = []; // nomi delle sottocartelle trovate su Drive (anche vuote)
const sottocartelleCreate = []; // chiamate a ensureDriveSubfolder, per verificare cosa viene creato/usato
const spostamenti = []; // chiamate a driveMoveFile: { driveId, newParentId }
const oauthPath = require.resolve('./routes/google-oauth');
require.cache[oauthPath] = {
  id: oauthPath, filename: oauthPath, loaded: true, exports: {
    isDriveEnabled: () => driveEnabled,
    ensureDriveFolder: async () => 'cartella_finta',
    driveListTree: async () => ({
      files: fakeFiles.map((f) => ({ ...f, cartella: f.cartella || null })),
      // le sottocartelle vere includono sia quelle esplicite (cartelle vuote) sia
      // quelle implicite da un file già taggato con `.cartella` in un test — nella
      // vera driveListTree sono sempre la stessa cosa (le sottocartelle SONO da dove
      // vengono letti i file), qui vanno solo unite per non doverle ripetere ovunque.
      cartelle: [...new Set([...fakeCartelle, ...fakeFiles.map((f) => f.cartella).filter(Boolean)])],
    }),
    ensureDriveSubfolder: async (nome) => { sottocartelleCreate.push(nome); return 'sub_' + nome; },
    driveMoveFile: async (driveId, newParentId) => { spostamenti.push({ driveId, newParentId }); },
  },
};

// drive-poller.js usa callAs (lib/internal-api) per registrare cartelle nuove e
// assegnare "Altro" — qui niente server HTTP reale in ascolto (stesso principio
// "nessuna vera telefonata" del resto del file): il finto callAs applica
// l'equivalente diretto sul database di test, così il resto del giro (organizza
// che legge le opzioni/i dati appena cambiati) si comporta esattamente come con
// le rotte vere.
const db = require('./db');
const internalApiPath = require.resolve('./lib/internal-api');
require.cache[internalApiPath] = {
  id: internalApiPath, filename: internalApiPath, loaded: true, exports: {
    callAs: async (user, method, path, body) => {
      const m1 = path.match(/^\/field-options\/([^/]+)\/([^/]+)$/);
      if (m1 && method === 'POST' && body && body.action === 'add') {
        const [, slug, fieldKey] = m1;
        const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
        const schema = JSON.parse(mod.schema_json);
        const field = schema.steps.find((s) => s.block_type === 'field' && s.key === fieldKey);
        if (field.options.includes(body.value)) return { ok: false, status: 409, data: { error: 'esiste già' } };
        field.options.push(body.value);
        db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(schema), slug);
        return { ok: true, status: 200, data: { ok: true } };
      }
      const m2 = path.match(/^\/records\/([^/]+)\/(\d+)$/);
      if (m2 && method === 'PUT') {
        const [, slug, id] = m2;
        db.prepare('UPDATE records SET data = ? WHERE id = ? AND module_slug = ?').run(JSON.stringify(body), id, slug);
        return { ok: true, status: 200, data: body };
      }
      return { ok: false, status: 404, data: { error: 'rotta finta non prevista: ' + method + ' ' + path } };
    },
  },
};

(async () => {
  const { pollDrive } = require('./drive-poller');
  const { parseSchemaNormalized } = require('./schema-v3');

  const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
  const addArchivio = (slug, extraFields = []) => {
    db.prepare('DELETE FROM modules WHERE slug = ?').run(slug);
    const schema = { version: 3, steps: [F('titolo', 'Titolo', 'text'), F('tipo', 'Tipo', 'select', { options: ['Altro', 'Fattura'] }), F('data', 'Data', 'date'), F('file', 'File', 'file'), ...extraFields] };
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, list_view) VALUES (?, ?, 'box', '#000', 1, 1, 50, ?, 'archive')").run(slug, slug, JSON.stringify(schema));
  };
  const records = (slug) => db.prepare('SELECT * FROM records WHERE module_slug = ?').all(slug).map((r) => ({ ...r, data: JSON.parse(r.data) }));

  await test('Drive spento: non fa niente, anche con file nuovi e un archivio pronto', async () => {
    addArchivio('documenti');
    driveEnabled = false;
    fakeFiles = [{ id: 'f1', name: 'bolletta.pdf', mimeType: 'application/pdf', size: '1000', createdTime: '2026-10-20T10:00:00Z' }];
    await pollDrive();
    assertEq(records('documenti').length, 0);
  });

  await test('nessun modulo ad archivio: non fa niente', async () => {
    db.prepare('DELETE FROM modules WHERE slug = ?').run('documenti');
    driveEnabled = true;
    await pollDrive();
    assertEq(db.prepare("SELECT COUNT(*) c FROM uploads").get().c, 0);
  });

  await test('due moduli ad archivio: ambiguo, non si indovina, non fa niente', async () => {
    addArchivio('documenti'); addArchivio('archivio_due');
    await pollDrive();
    assertEq(records('documenti').length, 0);
    db.prepare('DELETE FROM modules WHERE slug = ?').run('archivio_due');
  });

  await test('un file nuovo su Drive diventa un record: titolo dal nome, file collegato, data dalla creazione', async () => {
    addArchivio('documenti');
    fakeFiles = [{ id: 'drive_abc', name: 'Contratto affitto.pdf', mimeType: 'application/pdf', size: '20480', createdTime: '2026-09-15T08:30:00Z' }];
    await pollDrive();
    const rs = records('documenti');
    assertEq(rs.length, 1);
    assertEq(rs[0].data.titolo, 'Contratto affitto');
    assertEq(rs[0].data.data, '2026-09-15');
    assertEq(rs[0].data.file.name, 'Contratto affitto.pdf');
    assertEq(rs[0].data.file.mime_type, 'application/pdf');
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(rs[0].data.file.id);
    assertEq(up.stored_name, 'drive:drive_abc');
    assertEq(up.size, 20480);
  });

  await test('è idempotente: lo stesso file su Drive non viene reimportato una seconda volta', async () => {
    await pollDrive();
    assertEq(records('documenti').length, 1);
  });

  await test('un file che Platform ha già caricato lei stessa (stessa riga uploads) non viene "riscoperto" come nuovo', async () => {
    db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('scontrino.jpg', 'drive:gia_mio', 'image/jpeg', 500)").run();
    fakeFiles = [{ id: 'gia_mio', name: 'scontrino.jpg', mimeType: 'image/jpeg', size: '500', createdTime: '2026-10-01T00:00:00Z' }];
    await pollDrive();
    assertEq(records('documenti').length, 1, 'nessun nuovo record: il file era già un upload conosciuto');
  });

  await test('una sottocartella e un Google Doc nativo si saltano (non sono file scaricabili come byte)', async () => {
    fakeFiles = [
      { id: 'cartella_1', name: 'Vecchie', mimeType: 'application/vnd.google-apps.folder', size: null, createdTime: '2026-10-01T00:00:00Z' },
      { id: 'doc_1', name: 'Appunti', mimeType: 'application/vnd.google-apps.document', size: null, createdTime: '2026-10-01T00:00:00Z' },
    ];
    await pollDrive();
    assertEq(records('documenti').length, 1, 'ancora solo il record di prima, niente di nuovo creato');
    assertEq(db.prepare("SELECT COUNT(*) c FROM uploads WHERE stored_name IN ('drive:cartella_1','drive:doc_1')").get().c, 0);
  });

  await test('un file trovato dentro una sottocartella che è davvero un\'opzione del campo "tipo" prende quella cartella', async () => {
    fakeFiles = [{ id: 'fattura_1', name: 'Luce ottobre.pdf', mimeType: 'application/pdf', size: '3000', createdTime: '2026-10-05T00:00:00Z', cartella: 'Fattura' }];
    await pollDrive();
    const rs = records('documenti').find((r) => r.data.titolo === 'Luce ottobre');
    assertEq(rs.data.tipo, 'Fattura');
  });

  await test('un file dentro una sottocartella con un nome mai visto prima: la cartella si registra da sola come opzione nuova', async () => {
    fakeFiles = [{ id: 'boh_1', name: 'misterioso.pdf', mimeType: 'application/pdf', size: '100', createdTime: '2026-10-06T00:00:00Z', cartella: 'NomeInventato' }];
    await pollDrive();
    const rs = records('documenti').find((r) => r.data.titolo === 'misterioso');
    assertEq(rs.data.tipo, 'NomeInventato', 'la cartella appena registrata va bene anche nello stesso giro');
    const mod = db.prepare("SELECT schema_json FROM modules WHERE slug = 'documenti'").get();
    const opz = JSON.parse(mod.schema_json).steps.find((s) => s.key === 'tipo').options;
    assertEq(opz.includes('NomeInventato'), true, 'resta registrata anche per i prossimi giri');
  });

  await test('una cartella Drive vuota (nessun file dentro) diventa comunque un\'opzione nuova', async () => {
    fakeFiles = [];
    fakeCartelle = ['Chiamata test'];
    await pollDrive();
    const mod = db.prepare("SELECT schema_json FROM modules WHERE slug = 'documenti'").get();
    const opz = JSON.parse(mod.schema_json).steps.find((s) => s.key === 'tipo').options;
    assertEq(opz.includes('Chiamata test'), true);
    fakeCartelle = [];
  });

  await test('un documento con un file già su Drive ma senza cartella finisce in "Altro" (e si sposta lì)', async () => {
    db.exec('DELETE FROM records; DELETE FROM uploads;');
    sottocartelleCreate.length = 0; spostamenti.length = 0;
    const upId = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('vecchio.pdf', 'drive:vecchio_id', 'application/pdf', 100)").run().lastInsertRowid;
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('documenti', NULL, ?)").run(JSON.stringify({ titolo: 'Vecchio', file: { id: upId, name: 'vecchio.pdf' } }));
    fakeFiles = [{ id: 'vecchio_id', name: 'vecchio.pdf', mimeType: 'application/pdf', size: '100', createdTime: '2026-10-01T00:00:00Z', cartella: null }];
    await pollDrive();
    const r = records('documenti').find((x) => x.data.titolo === 'Vecchio');
    assertEq(r.data.tipo, 'Altro');
    assertEq(spostamenti, [{ driveId: 'vecchio_id', newParentId: 'sub_Altro' }]);
  });

  await test('un documento senza cartella il cui file è su disco locale (non Drive) resta intoccato', async () => {
    db.exec('DELETE FROM records; DELETE FROM uploads;');
    sottocartelleCreate.length = 0; spostamenti.length = 0;
    const upId = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('locale.pdf', 'locale_123.pdf', 'application/pdf', 100)").run().lastInsertRowid;
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('documenti', NULL, ?)").run(JSON.stringify({ titolo: 'Locale', file: { id: upId, name: 'locale.pdf' } }));
    fakeFiles = [];
    await pollDrive();
    const r = records('documenti').find((x) => x.data.titolo === 'Locale');
    assertEq(r.data.tipo, undefined, 'niente su Drive da riordinare: non si inventa una cartella per un file locale');
    assertEq(spostamenti, []);
  });

  await test('riordino: un record con cartella "Fattura" ma il cui file Drive è ancora nella radice viene spostato', async () => {
    db.exec('DELETE FROM records; DELETE FROM uploads;');
    sottocartelleCreate.length = 0; spostamenti.length = 0;
    const upId = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('bolletta.pdf', 'drive:bolletta_id', 'application/pdf', 100)").run().lastInsertRowid;
    db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('documenti', NULL, ?)").run(JSON.stringify({ titolo: 'Bolletta', tipo: 'Fattura', file: { id: upId, name: 'bolletta.pdf' } }));
    fakeFiles = [{ id: 'bolletta_id', name: 'bolletta.pdf', mimeType: 'application/pdf', size: '100', createdTime: '2026-10-01T00:00:00Z', cartella: null }];
    await pollDrive();
    assertEq(sottocartelleCreate, ['Fattura']);
    assertEq(spostamenti, [{ driveId: 'bolletta_id', newParentId: 'sub_Fattura' }]);
  });

  await test('riordino: un record già nella sottocartella giusta non viene toccato di nuovo', async () => {
    sottocartelleCreate.length = 0; spostamenti.length = 0;
    fakeFiles = [{ id: 'bolletta_id', name: 'bolletta.pdf', mimeType: 'application/pdf', size: '100', createdTime: '2026-10-01T00:00:00Z', cartella: 'Fattura' }];
    await pollDrive();
    assertEq(spostamenti, [], 'era già nella sottocartella giusta, nessuno spostamento');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
