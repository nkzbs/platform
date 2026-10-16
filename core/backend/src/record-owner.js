'use strict';
// Proprietario delle righe che non le crea una persona dall'interfaccia (mail, estratto conto, rate generate da un'automazione, importazioni).
// Senza proprietario una riga in un modulo con "vede solo i propri" non la vede nessuno tranne l'admin, quindi ogni riga automatica prende:
//   1. il proprietario della riga che l'ha generata (le rate di un piano sono di chi ha creato il piano), altrimenti
//   2. il proprietario scelto PER QUEL MODULO (Builder → Ruoli del modulo → «Proprietario delle righe automatiche»), altrimenti
//   3. il "proprietario predefinito" del progetto, scelto in Impostazioni (tenant_settings.default_owner_user_id), altrimenti
//   4. nessuno (come prima).
const db = require('./db');

function defaultOwnerId() {
  try {
    const row = db.prepare('SELECT default_owner_user_id AS id FROM tenant_settings WHERE id = 1').get();
    if (!row || !row.id) return null;
    return db.prepare('SELECT id FROM users WHERE id = ?').get(row.id) ? row.id : null;
  } catch (e) { return null; }
}

// Il proprietario scelto per un modulo (se l'utente esiste ancora), o null.
function moduleOwnerId(slug) {
  try {
    const r = slug ? require('./module-roles').get(slug) : null;
    const id = r && r.owner_user_id;
    return id && db.prepare('SELECT id FROM users WHERE id = ?').get(id) ? id : null;
  } catch (e) { return null; }
}

function ownerFor(sourceRecordId, moduleSlug) {
  try {
    if (sourceRecordId) {
      const r = db.prepare('SELECT user_id FROM records WHERE id = ?').get(sourceRecordId);
      if (r && r.user_id) return r.user_id;
    }
  } catch (e) { /* si ricade sul predefinito */ }
  return moduleOwnerId(moduleSlug) || defaultOwnerId();
}

// Se c'è un proprietario predefinito, le righe rimaste senza proprietario (arrivate prima che lo si scegliesse) passano a lui.
// Idempotente; non tocca mai le righe che hanno già un proprietario.
function adoptOrphans() {
  try {
    let n = 0;
    // prima chi ha un proprietario suo (per modulo), poi il resto passa al predefinito del progetto
    for (const m of db.prepare('SELECT module_slug FROM module_roles').all()) {
      const owner = moduleOwnerId(m.module_slug);
      if (owner) n += db.prepare('UPDATE records SET user_id = ? WHERE module_slug = ? AND user_id IS NULL').run(owner, m.module_slug).changes;
    }
    const owner = defaultOwnerId();
    if (owner) n += db.prepare('UPDATE records SET user_id = ? WHERE user_id IS NULL').run(owner).changes;
    if (n) { try { require('./audit-log').logAudit('system', 'record_owner.adopt', 'tutti', { righe: n }); } catch (e) { /* mai bloccare */ } }
    return n;
  } catch (e) { return 0; }
}

module.exports = { defaultOwnerId, moduleOwnerId, ownerFor, adoptOrphans };
