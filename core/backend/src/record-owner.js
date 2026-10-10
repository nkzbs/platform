'use strict';
// Proprietario delle righe che non le crea una persona dall'interfaccia (mail Gmail, estratto conto, rate generate da un'automazione).
// Senza proprietario una riga in un modulo con "vede solo i propri" non la vede nessuno tranne l'admin, quindi ogni riga automatica prende:
//   1. il proprietario della riga che l'ha generata (le rate di un piano sono di chi ha creato il piano), altrimenti
//   2. il "proprietario predefinito" scelto in Impostazioni (tenant_settings.default_owner_user_id), altrimenti
//   3. nessuno (come prima).
const db = require('./db');

function defaultOwnerId() {
  try {
    const row = db.prepare('SELECT default_owner_user_id AS id FROM tenant_settings WHERE id = 1').get();
    if (!row || !row.id) return null;
    return db.prepare('SELECT id FROM users WHERE id = ?').get(row.id) ? row.id : null;
  } catch (e) { return null; }
}

function ownerFor(sourceRecordId) {
  try {
    if (sourceRecordId) {
      const r = db.prepare('SELECT user_id FROM records WHERE id = ?').get(sourceRecordId);
      if (r && r.user_id) return r.user_id;
    }
  } catch (e) { /* si ricade sul predefinito */ }
  return defaultOwnerId();
}

module.exports = { defaultOwnerId, ownerFor };
