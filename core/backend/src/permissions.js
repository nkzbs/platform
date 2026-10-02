'use strict';

// ─── PERMESSI ────────────────────────────────────────────────────────────────
// Il blocco 'permissions' del modulo (Builder, categoria Permessi) è una matrice
// ruolo × azione: { rules: [{ role, view, view_own_only, owner_field, create, edit, delete }] }.
// Se il modulo non ha nessun blocco permissions configurato, il comportamento resta
// quello di sempre (nessuna restrizione) — non cambia nulla per i moduli esistenti
// finché qualcuno non configura esplicitamente i permessi.
//
// Ruoli: 'admin' + 'user' built-in, più ruoli custom per-tenant (tabella `roles`).
// Se il ruolo di chi chiama non ha una riga esplicita nella matrice, il default è
// "nessun permesso" per sicurezza — TRANNE per 'admin', che resta a piena
// visibilità/azione se non esplicitamente ristretto, per evitare che un admin si
// autoescluda per dimenticanza mentre configura i permessi di altri.
function ruleFor(schema, role) {
  const rules = schema && schema.permissions && schema.permissions.rules;
  if (!Array.isArray(rules) || rules.length === 0) return null; // nessuna configurazione -> nessuna restrizione
  const found = rules.find((r) => r.role === role);
  if (found) return found;
  if (role === 'admin') return { role, view: true, view_own_only: false, create: true, edit: true, delete: true };
  return { role, view: false, view_own_only: false, create: false, edit: false, delete: false };
}

// Un record "proprio" è normalmente quello con user_id === utente corrente (chi lo
// ha creato). Quando la regola specifica un owner_field (es. "agente"), la
// proprietà si sposta su una relazione del record stesso: il record è "proprio" se
// quel campo punta al record collegato all'utente (user.linked_record_id) — serve
// per ruoli tipo "Agente" che devono vedere i dati assegnati a loro (clienti,
// ordini) e non solo quelli che hanno personalmente creato da UI.
function isOwnRecord(rule, record, user) {
  if (rule.owner_field) {
    let data = record && record.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { data = {}; }
    }
    if (!data || user.linked_record_id === undefined || user.linked_record_id === null) return false;
    return String(data[rule.owner_field]) === String(user.linked_record_id);
  }
  return !!(record && record.user_id === user.id);
}

function ownedOrAllowed(rule, record, user) {
  if (!rule) return true;
  if (!rule.view_own_only) return true;
  return isOwnRecord(rule, record, user);
}

function filterViewable(records, rule, user) {
  if (!rule) return records;
  if (!rule.view) return [];
  if (!rule.view_own_only) return records;
  return records.filter((r) => isOwnRecord(rule, r, user));
}

module.exports = { ruleFor, ownedOrAllowed, filterViewable, isOwnRecord };
