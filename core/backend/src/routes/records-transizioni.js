// Cambio di stato di una riga: la funzione (usata anche dal bot Telegram e dai documenti) e la rotta POST /:slug/:id/transition. Stava in routes/records.js.
const express = require('express');
const db = require('../db');
const { requireAuth, requireModuleAccess } = require('./auth');
const { evaluateFormula } = require('../formula');
const { fireTrigger } = require('../automation-engine');
const { decryptFields } = require('../crypto-fields');
const { ruleFor, ownedOrAllowed } = require('../permissions');
const { getModuleSchema, attachComputedFields, logHistory } = require('./records-helpers');

const router = express.Router();

// Cambio di stato di una riga, con TUTTI i controlli dell'app (permessi del ruolo, regole del workflow, validazioni, automazioni).
// Usata dalla rotta qui sotto e dal bot Telegram (telegram.js): così una riga si chiude nello stesso modo da qualunque via.
// Ritorna { status, body } invece di scrivere su `res`.
function runTransition(user, slug, id, to) {
  const err = (status, error) => ({ status, body: { error } });
  const schema = getModuleSchema(slug) || {};
  const existing = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!existing) return err(404, 'Record non trovato');

  const rule = ruleFor(schema, user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, existing, user))) return err(403, 'Non hai i permessi per modificare questo record');

  if (!to) return err(400, 'Campo "to" obbligatorio');

  const workflow = schema.workflow;
  if (!workflow) return err(400, 'Questo modulo non ha un workflow');

  const beforeData = JSON.parse(existing.data);
  const from = beforeData._stato;

  const transition = (workflow.transitions || []).find((t) => t.from === from && t.to === to);
  if (!transition) return err(422, `Transizione non ammessa: ${from} → ${to}`);

  // L'amministratore passa sempre (come nei permessi dei moduli, permissions.js): un passaggio riservato a un ruolo non deve bloccare chi gestisce il tenant.
  if (Array.isArray(transition.roles) && transition.roles.length > 0 && user.role !== 'admin' && !transition.roles.includes(user.role)) return err(403, 'Il tuo ruolo non può eseguire questa transizione');

  // Requisiti dello stato di arrivo (blocco `state_requirements`): se il blocco è «bloccante» e manca qualcosa, il passaggio non avviene e si dice cosa manca.
  // Se non è bloccante sono solo un promemoria nella scheda (shared/requisiti-stato.js, lo stesso calcolo).
  const requisiti = require('../requisiti-stato');
  const bloccoRequisiti = requisiti.bloccoPerStato(schema.state_requirements, to);
  if (bloccoRequisiti && bloccoRequisiti.bloccante) {
    const allegati = db.prepare('SELECT tipo FROM record_attachments WHERE module_slug = ? AND record_id = ?').all(slug, existing.id);
    const manca = requisiti.valutaRequisiti(bloccoRequisiti, beforeData, allegati).filter((v) => !v.ok).map((v) => v.label);
    if (manca.length) {
      const stato = (workflow.states || []).find((x) => x.key === to);
      return { status: 400, body: { error: 'Per passare a «' + ((stato && stato.label) || to) + '» manca: ' + manca.join(', ') + '.', mancano: manca } };
    }
  }

  // Validazione bloccante opzionale sulla transizione (es. "dare == avere" prima di
  // confermare un movimento contabile) — riusa la stessa sandbox di espressioni dei
  // campi computed, ma qui il risultato blocca il salvataggio invece di limitarsi a
  // annotare un valore: è l'unico punto della piattaforma dove un'automazione può
  // impedire un cambiamento di stato invece di reagirci dopo il commit.
  if (transition.validazione && transition.validazione.expr) {
    const context = { currentModule: slug, currentRecordId: existing.id, currentRecordData: beforeData };
    const result = evaluateFormula(transition.validazione.expr, db, context);
    if (!result.valid) return err(400, 'Validazione transizione non valutabile: ' + (result.errors || []).join('; '));
    if (!result.value) return err(400, transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: condizione non soddisfatta`);
  }

  // Variante di validazione per un confronto con un record DIRETTAMENTE collegato
  // (many_to_one) — es. "kg richiesti dal lotto ≤ kg disponibili nella materia prima
  // collegata". La sandbox formula.js non ha un primitivo "leggi un campo del record a
  // cui punto" (solo aggregazioni sui FIGLI, mai sul padre di una relazione), quindi
  // per questo caso specifico si confrontano due valori letti direttamente qui invece
  // di provare a forzarlo nel DSL delle formule.
  if (transition.validazione && transition.validazione.relazione_check) {
    const rc = transition.validazione.relazione_check;
    const relatedId = beforeData[rc.relazione];
    let relatedValue = null;
    if (relatedId && rc.modulo_relazionato && rc.campo_relazionato) {
      try {
        const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(rc.modulo_relazionato, relatedId);
        if (row) relatedValue = parseFloat(JSON.parse(row.data || '{}')[rc.campo_relazionato]) || 0;
      } catch (e) { relatedValue = null; }
    }
    const currentValue = parseFloat(beforeData[rc.campo_corrente]) || 0;
    const ops = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '>': (a, b) => a > b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
    const cmp = ops[rc.op] || ops['<='];
    if (relatedValue === null || !cmp(currentValue, relatedValue)) {
      return err(400, transition.validazione.messaggio || `Transizione ${from} → ${to} bloccata: vincolo con il record collegato non soddisfatto`);
    }
  }

  const newData = require('../data-pagamento').applica(slug, { ...beforeData, _stato: to }, beforeData); // pagata a mano: scrive la data di oggi se manca
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify(newData), id, slug);
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  const decryptedData = decryptFields(JSON.parse(record.data), schema.fields);
  const attached = attachComputedFields({ ...record, data: decryptedData }, schema, slug);

  fireTrigger(slug, 'cambio_stato', attached.data, attached.id, { stato: to });
  logHistory(slug, attached.id, user.username, 'transition', beforeData, attached.data);
  return { status: 200, body: attached };
}

router.post('/:slug/:id/transition', requireAuth, requireModuleAccess, (req, res) => {
  const out = runTransition(req.user, req.params.slug, req.params.id, (req.body || {}).to);
  res.status(out.status).json(out.body);
});

module.exports = router;
module.exports.runTransition = runTransition;
