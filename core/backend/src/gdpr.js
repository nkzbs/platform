'use strict';
// Gestione GDPR dentro Platform (pannello Impostazioni → Privacy e GDPR): registro dei trattamenti (art. 30), fornitori e accordi di trattamento
// (art. 28), registro delle violazioni dei dati (art. 33, con il conto alla rovescia delle 72 ore), checklist di conformità e ricerca di una persona
// con esportazione dei suoi dati (art. 15 e 20). Nessun nome di progetto: le bozze di partenza sono dati in seeds/gdpr-modelli.json.
// Le liste sono aiuti per il titolare, non un parere legale: le bozze vanno confermate da chi risponde del trattamento.
const db = require('./db');
const modelli = require('./seeds/gdpr-modelli.json');

db.exec(`
  CREATE TABLE IF NOT EXISTS gdpr_trattamenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, finalita TEXT DEFAULT '', interessati TEXT DEFAULT '', categorie_dati TEXT DEFAULT '',
    base_giuridica TEXT DEFAULT '', destinatari TEXT DEFAULT '', extra_ue TEXT DEFAULT '', conservazione TEXT DEFAULT '', misure TEXT DEFAULT '',
    da_verificare INTEGER DEFAULT 0, creato_il DATETIME DEFAULT CURRENT_TIMESTAMP, aggiornato_il DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS gdpr_fornitori (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chiave TEXT, nome TEXT NOT NULL, servizio TEXT DEFAULT '', dati TEXT DEFAULT '', paese TEXT DEFAULT '',
    dpa_stato TEXT DEFAULT 'da_firmare', dpa_data TEXT DEFAULT '', note TEXT DEFAULT '', creato_il DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS gdpr_violazioni (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scoperta_il TEXT NOT NULL, descrizione TEXT NOT NULL, dati_coinvolti TEXT DEFAULT '', interessati_n INTEGER DEFAULT 0,
    rischio TEXT DEFAULT 'basso', misure TEXT DEFAULT '', notificata_garante_il TEXT DEFAULT '', comunicata_interessati_il TEXT DEFAULT '',
    stato TEXT DEFAULT 'aperta', creato_il DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const CAMPI = {
  trattamenti: ['nome', 'finalita', 'interessati', 'categorie_dati', 'base_giuridica', 'destinatari', 'extra_ue', 'conservazione', 'misure', 'da_verificare'],
  fornitori: ['nome', 'servizio', 'dati', 'paese', 'dpa_stato', 'dpa_data', 'note'],
  violazioni: ['scoperta_il', 'descrizione', 'dati_coinvolti', 'interessati_n', 'rischio', 'misure', 'notificata_garante_il', 'comunicata_interessati_il', 'stato'],
};
const TABELLE = { trattamenti: 'gdpr_trattamenti', fornitori: 'gdpr_fornitori', violazioni: 'gdpr_violazioni' };
const DPA_STATI = ['da_firmare', 'firmato', 'non_serve'];
const RISCHI = ['basso', 'medio', 'alto'];

function pulisci(tipo, corpo) {
  const out = {};
  for (const c of CAMPI[tipo]) if (corpo && corpo[c] !== undefined) out[c] = typeof corpo[c] === 'number' ? corpo[c] : String(corpo[c] == null ? '' : corpo[c]).slice(0, 4000);
  if (out.da_verificare !== undefined) out.da_verificare = out.da_verificare && out.da_verificare !== '0' ? 1 : 0;
  if (out.interessati_n !== undefined) out.interessati_n = Math.max(0, parseInt(out.interessati_n, 10) || 0);
  if (out.dpa_stato !== undefined && !DPA_STATI.includes(out.dpa_stato)) out.dpa_stato = 'da_firmare';
  if (out.rischio !== undefined && !RISCHI.includes(out.rischio)) out.rischio = 'basso';
  if (out.stato !== undefined && !['aperta', 'chiusa'].includes(out.stato)) out.stato = 'aperta';
  return out;
}

const elenco = (tipo) => db.prepare('SELECT * FROM ' + TABELLE[tipo] + ' ORDER BY id DESC').all();
function crea(tipo, corpo) {
  const d = pulisci(tipo, corpo);
  const obbligatorio = tipo === 'violazioni' ? ['scoperta_il', 'descrizione'] : ['nome'];
  for (const c of obbligatorio) if (!String(d[c] || '').trim()) { const e = new Error('Manca «' + c.replace('_', ' ') + '»'); e.status = 400; throw e; }
  const chiavi = Object.keys(d);
  return db.prepare('INSERT INTO ' + TABELLE[tipo] + ' (' + chiavi.join(', ') + ') VALUES (' + chiavi.map(() => '?').join(', ') + ')').run(...chiavi.map((k) => d[k])).lastInsertRowid;
}
function aggiorna(tipo, id, corpo) {
  const d = pulisci(tipo, corpo), chiavi = Object.keys(d);
  if (!chiavi.length) return 0;
  const extra = tipo === 'trattamenti' ? ', aggiornato_il = CURRENT_TIMESTAMP' : '';
  return db.prepare('UPDATE ' + TABELLE[tipo] + ' SET ' + chiavi.map((k) => k + ' = ?').join(', ') + extra + ' WHERE id = ?').run(...chiavi.map((k) => d[k]), id).changes;
}
const togli = (tipo, id) => db.prepare('DELETE FROM ' + TABELLE[tipo] + ' WHERE id = ?').run(id).changes;

// «Precompila»: aggiunge le bozze che mancano (stesso nome = già presente, non si duplica) e i fornitori dedotti dalle connessioni attive.
function precompila() {
  let trattamenti = 0, fornitori = 0;
  const haT = db.prepare('SELECT 1 FROM gdpr_trattamenti WHERE nome = ?');
  for (const t of modelli.trattamenti) if (!haT.get(t.nome)) { crea('trattamenti', { ...t, da_verificare: 1 }); trattamenti++; }
  let aiAcceso = false;
  try { const r = db.prepare('SELECT ai_enabled FROM tenant_settings WHERE id = 1').get(); aiAcceso = !!(r && r.ai_enabled); } catch (e) { /* tenant senza la colonna */ }
  const attive = new Set();
  try { for (const c of db.prepare('SELECT integration_id FROM connections WHERE connected = 1').all()) attive.add(c.integration_id); } catch (e) { /* tabella assente */ }
  const haF = db.prepare('SELECT 1 FROM gdpr_fornitori WHERE chiave = ?');
  for (const [chiave, f] of Object.entries(modelli.fornitori)) {
    const serve = f.sempre || (f.solo_se_ai ? aiAcceso : attive.has(chiave));
    if (!serve || haF.get(chiave)) continue;
    db.prepare('INSERT INTO gdpr_fornitori (chiave, nome, servizio, dati, paese) VALUES (?, ?, ?, ?, ?)').run(chiave, f.nome, f.servizio, f.dati, f.paese);
    fornitori++;
  }
  return { trattamenti, fornitori };
}

// Ore che restano per notificare una violazione al Garante (72 ore dalla scoperta). Negativo = scaduto.
function oreResidue(scopertaIl, adesso = Date.now()) {
  const t = Date.parse(scopertaIl);
  return Number.isFinite(t) ? Math.round((t + 72 * 3600 * 1000 - adesso) / 36e5) : null;
}

// La checklist: cosa è a posto, cosa richiede attenzione, cosa manca. `vai` è la scheda del pannello dove sistemarlo.
function stato(adesso = Date.now()) {
  const voci = [];
  const nT = db.prepare('SELECT COUNT(*) n FROM gdpr_trattamenti').get().n, nTv = db.prepare('SELECT COUNT(*) n FROM gdpr_trattamenti WHERE da_verificare = 1').get().n;
  voci.push(nT === 0 ? { chiave: 'registro', stato: 'manca', testo: 'Il registro dei trattamenti (art. 30) è vuoto.', vai: 'trattamenti' }
    : nTv > 0 ? { chiave: 'registro', stato: 'attenzione', testo: nTv + ' trattament' + (nTv === 1 ? 'o è' : 'i sono') + ' ancora una bozza da verificare.', vai: 'trattamenti' }
    : { chiave: 'registro', stato: 'ok', testo: 'Registro dei trattamenti compilato (' + nT + ').', vai: 'trattamenti' });
  const nF = db.prepare('SELECT COUNT(*) n FROM gdpr_fornitori').get().n, senza = db.prepare("SELECT COUNT(*) n FROM gdpr_fornitori WHERE dpa_stato = 'da_firmare'").get().n;
  voci.push(nF === 0 ? { chiave: 'fornitori', stato: 'manca', testo: 'Nessun fornitore registrato: usa «Precompila» per partire da quelli che usi.', vai: 'fornitori' }
    : senza > 0 ? { chiave: 'fornitori', stato: 'attenzione', testo: senza + ' fornitor' + (senza === 1 ? 'e senza' : 'i senza') + ' accordo di trattamento firmato (art. 28).', vai: 'fornitori' }
    : { chiave: 'fornitori', stato: 'ok', testo: 'Accordi di trattamento a posto per tutti i fornitori.', vai: 'fornitori' });
  const aperte = db.prepare("SELECT * FROM gdpr_violazioni WHERE stato = 'aperta'").all();
  const scadute = aperte.filter((v) => !v.notificata_garante_il && v.rischio !== 'basso' && (oreResidue(v.scoperta_il, adesso) ?? 1) < 0);
  const inScadenza = aperte.filter((v) => !v.notificata_garante_il && v.rischio !== 'basso' && !scadute.includes(v));
  voci.push(scadute.length ? { chiave: 'violazioni', stato: 'manca', testo: scadute.length + ' violazion' + (scadute.length === 1 ? 'e' : 'i') + ' a rischio non notificat' + (scadute.length === 1 ? 'a' : 'e') + ' al Garante: le 72 ore sono passate.', vai: 'violazioni' }
    : inScadenza.length ? { chiave: 'violazioni', stato: 'attenzione', testo: inScadenza.length + ' violazion' + (inScadenza.length === 1 ? 'e' : 'i') + ' aperta da notificare entro le 72 ore.', vai: 'violazioni' }
    : { chiave: 'violazioni', stato: 'ok', testo: aperte.length ? aperte.length + ' violazioni aperte, nessuna da notificare.' : 'Nessuna violazione aperta.', vai: 'violazioni' });
  const admin = db.prepare("SELECT id, totp_enabled FROM users WHERE active = 1 AND role = 'admin'").all();
  let conPasskey = new Set();
  try { conPasskey = new Set(db.prepare('SELECT DISTINCT user_id FROM webauthn_credentials').all().map((r) => r.user_id)); } catch (e) { /* senza passkey */ }
  const senza2fa = admin.filter((u) => !u.totp_enabled && !conPasskey.has(u.id)).length;
  voci.push(senza2fa ? { chiave: 'accessi', stato: 'attenzione', testo: senza2fa + ' amministrator' + (senza2fa === 1 ? 'e' : 'i') + ' senza verifica in due passaggi (2FA o passkey).', vai: null }
    : { chiave: 'accessi', stato: 'ok', testo: 'Tutti gli amministratori hanno la verifica in due passaggi.', vai: null });
  return voci;
}

// Cerca una persona nei record (nome, mail, telefono, codice fiscale…): per ogni scheda trovata, modulo e un'etichetta. Solo ricerca testuale: un controllo
// umano resta necessario (omonimie, dati in allegati o in campi che non contengono quel testo).
function cercaPersona(q, limite = 300) {
  const testo = String(q || '').trim();
  if (testo.length < 4) { const e = new Error('Scrivi almeno 4 caratteri (nome e cognome, mail, telefono o codice fiscale).'); e.status = 400; throw e; }
  const like = '%' + testo.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  const righe = db.prepare("SELECT r.id, r.module_slug, r.data, m.name FROM records r LEFT JOIN modules m ON m.slug = r.module_slug WHERE r.data LIKE ? ESCAPE '\\' ORDER BY r.module_slug, r.id LIMIT ?").all(like, limite);
  return righe.map((r) => {
    let dati = {}; try { dati = JSON.parse(r.data || '{}'); } catch (e) { /* record illeggibile */ }
    const etichetta = dati.nome || dati.titolo || dati.descrizione || Object.values(dati).find((v) => typeof v === 'string' && v.trim() && v.length < 80) || '#' + r.id;
    return { id: r.id, modulo: r.module_slug, nome_modulo: r.name || r.module_slug, etichetta: String(etichetta), dati };
  });
}

module.exports = { elenco, crea, aggiorna, togli, precompila, stato, cercaPersona, oreResidue, CAMPI };
