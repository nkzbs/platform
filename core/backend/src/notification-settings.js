'use strict';
// Destinatari WhatsApp (chi riceve quali notifiche) e regole Gmail (quali mail diventano spese).
// Sono impostazioni del sistema, con tabelle proprie (`whatsapp_recipients`, `gmail_rules`):
// non moduli. Fino al 2026-10-03 erano due moduli con le righe in `records`; migrateLegacy()
// le porta nelle tabelle nuove e toglie moduli e righe vecchie.
const db = require('./db');

const MAX_TAGS = 12;

// ─── Destinatari WhatsApp ────────────────────────────────────────────────────
const toRecipient = (r) => ({ id: r.id, nome: r.nome, numero: r.numero, triggers: parseTags(r.triggers), attivo: !!r.attivo });
function parseTags(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.filter((t) => typeof t === 'string') : []; } catch (e) { return []; } }

function listRecipients() {
  return db.prepare('SELECT * FROM whatsapp_recipients ORDER BY id').all().map(toRecipient);
}

// Destinatari attivi iscritti a un tag (tag vuoto = tutti gli attivi).
function recipientsForTag(tag) {
  return listRecipients().filter((r) => r.attivo && r.numero && (!tag || r.triggers.includes(tag)));
}

function cleanRecipient(body) {
  const nome = String((body && body.nome) || '').trim().slice(0, 80);
  const numero = String((body && body.numero) || '').trim().slice(0, 30);
  if (!nome) return { error: 'Serve il nome.' };
  if (!/^\+?[\d\s().-]{6,}$/.test(numero)) return { error: 'Il numero non sembra valido (es. +39 333 1234567).' };
  const triggers = [...new Set((Array.isArray(body.triggers) ? body.triggers : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, MAX_TAGS);
  return { value: { nome, numero, triggers, attivo: body.attivo === false || body.attivo === 0 ? 0 : 1 } };
}

function createRecipient(body) {
  const c = cleanRecipient(body); if (c.error) return c;
  const v = c.value;
  const id = db.prepare('INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES (?, ?, ?, ?)').run(v.nome, v.numero, JSON.stringify(v.triggers), v.attivo).lastInsertRowid;
  return { recipient: toRecipient(db.prepare('SELECT * FROM whatsapp_recipients WHERE id = ?').get(id)) };
}

function updateRecipient(id, body) {
  if (!db.prepare('SELECT 1 FROM whatsapp_recipients WHERE id = ?').get(id)) return { notFound: true };
  const c = cleanRecipient(body); if (c.error) return c;
  const v = c.value;
  db.prepare('UPDATE whatsapp_recipients SET nome = ?, numero = ?, triggers = ?, attivo = ? WHERE id = ?').run(v.nome, v.numero, JSON.stringify(v.triggers), v.attivo, id);
  return { recipient: toRecipient(db.prepare('SELECT * FROM whatsapp_recipients WHERE id = ?').get(id)) };
}

const deleteRecipient = (id) => db.prepare('DELETE FROM whatsapp_recipients WHERE id = ?').run(id).changes > 0;

// ─── Regole Gmail ────────────────────────────────────────────────────────────
const toRule = (r) => ({ id: r.id, mittente: r.mittente, descrizione: r.descrizione || '', gruppo: r.gruppo, modulo: r.modulo || '', categoria: r.categoria || '', attiva: !!r.attiva });
const listRules = () => db.prepare('SELECT * FROM gmail_rules ORDER BY id').all().map(toRule);
const activeRules = () => listRules().filter((r) => r.attiva && r.mittente);

function cleanRule(body) {
  const mittente = String((body && body.mittente) || '').trim().toLowerCase().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(mittente)) return { error: 'Il mittente deve essere un indirizzo email (es. bollette@a2a.it).' };
  const gruppo = body.gruppo === 'Personale' ? 'Personale' : 'Casa';
  const modulo = /^[a-z0-9_]{1,60}$/.test(String(body.modulo || '')) ? String(body.modulo) : '';
  return { value: { mittente, descrizione: String(body.descrizione || '').trim().slice(0, 80), gruppo, modulo, categoria: String(body.categoria || '').trim().slice(0, 60), attiva: body.attiva === false || body.attiva === 0 ? 0 : 1 } };
}

function createRule(body) {
  const c = cleanRule(body); if (c.error) return c;
  const v = c.value;
  const id = db.prepare('INSERT INTO gmail_rules (mittente, descrizione, gruppo, modulo, categoria, attiva) VALUES (?, ?, ?, ?, ?, ?)').run(v.mittente, v.descrizione, v.gruppo, v.modulo, v.categoria, v.attiva).lastInsertRowid;
  return { rule: toRule(db.prepare('SELECT * FROM gmail_rules WHERE id = ?').get(id)) };
}

function updateRule(id, body) {
  if (!db.prepare('SELECT 1 FROM gmail_rules WHERE id = ?').get(id)) return { notFound: true };
  const c = cleanRule(body); if (c.error) return c;
  const v = c.value;
  db.prepare('UPDATE gmail_rules SET mittente = ?, descrizione = ?, gruppo = ?, modulo = ?, categoria = ?, attiva = ? WHERE id = ?').run(v.mittente, v.descrizione, v.gruppo, v.modulo, v.categoria, v.attiva, id);
  return { rule: toRule(db.prepare('SELECT * FROM gmail_rules WHERE id = ?').get(id)) };
}

const deleteRule = (id) => db.prepare('DELETE FROM gmail_rules WHERE id = ?').run(id).changes > 0;

// ─── Migrazione dai vecchi moduli ────────────────────────────────────────────
// Idempotente: copia le righe rimaste in `records` nelle tabelle nuove e, nella stessa transazione,
// toglie quelle righe, i moduli e i permessi collegati. Una riga illeggibile o senza i campi
// minimi NON viene persa in silenzio: resta dov'è e si segnala (la migrazione non cancella ciò
// che non ha copiato). Ritorna { recipients, rules, left }.
function migrateLegacy() {
  const out = { recipients: 0, rules: 0, left: 0 };
  const tx = db.transaction(() => {
    for (const row of db.prepare("SELECT id, data FROM records WHERE module_slug = 'whatsapp_destinatari'").all()) {
      let d; try { d = JSON.parse(row.data || '{}'); } catch (e) { out.left++; continue; }
      const triggers = Array.isArray(d.triggers) ? d.triggers : [];
      if (!d.nome || !d.numero) { out.left++; continue; }
      db.prepare('INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES (?, ?, ?, ?)').run(String(d.nome), String(d.numero), JSON.stringify(triggers.filter((t) => typeof t === 'string')), d.attivo === false ? 0 : 1);
      db.prepare('DELETE FROM records WHERE id = ?').run(row.id);
      out.recipients++;
    }
    for (const row of db.prepare("SELECT id, data FROM records WHERE module_slug = 'gmail_regole'").all()) {
      let d; try { d = JSON.parse(row.data || '{}'); } catch (e) { out.left++; continue; }
      if (!d.mittente) { out.left++; continue; }
      db.prepare('INSERT INTO gmail_rules (mittente, descrizione, gruppo, categoria, attiva) VALUES (?, ?, ?, ?, ?)').run(String(d.mittente), d.descrizione || '', d.gruppo === 'Personale' ? 'Personale' : 'Casa', d.categoria || '', d.attiva ? 1 : 0);
      db.prepare('DELETE FROM records WHERE id = ?').run(row.id);
      out.rules++;
    }
    // Moduli e permessi si tolgono solo se non è rimasta nessuna riga da salvare.
    if (out.left === 0) {
      for (const slug of ['whatsapp_destinatari', 'gmail_regole']) {
        db.prepare('DELETE FROM user_modules WHERE module_slug = ?').run(slug);
        db.prepare('DELETE FROM modules WHERE slug = ?').run(slug);
      }
    }
  });
  tx();
  if (out.recipients || out.rules) console.log('Migrazione: destinatari WhatsApp (' + out.recipients + ') e regole Gmail (' + out.rules + ') spostati nelle impostazioni' + (out.left === 0 ? ', moduli rimossi' : ''));
  if (out.left) console.warn('Migrazione: ' + out.left + ' righe vecchie non copiate (dati incompleti), lasciate dove sono');
  return out;
}

module.exports = { listRecipients, recipientsForTag, createRecipient, updateRecipient, deleteRecipient, listRules, activeRules, createRule, updateRule, deleteRule, migrateLegacy };
