// Builder 2.0 — motore Validazioni (lint dello schema del modulo selezionato).
// Puramente client-side, sullo stesso principio del ModelCanvas: usa solo dati
// già in memoria (schema.steps del modulo aperto + fieldCache già caricato),
// zero nuove chiamate API. Non valida le formule (expr) — quello lo fa già
// FormulaEditor in tempo reale contro il motore vero lato server; qui si
// controllano solo problemi strutturali dello schema che altrimenti si
// scoprono solo pubblicando e rompendo qualcosa in produzione.
export function computeValidations(schema, fieldCache, allRoles) {
  const errors = []
  const warnings = []
  if (!schema || !schema.steps) return { errors, warnings }
  const steps = schema.steps

  const fields = steps.filter((s) => s.block_type === 'field')
  const relations = steps.filter((s) => s.block_type === 'relation')
  const permissionsBlock = steps.find((s) => s.block_type === 'permissions')
  const automations = steps.filter((s) => s.block_type === 'automation')
  const workflowStates = steps.filter((s) => s.block_type === 'workflow_state')

  const keyCounts = {}
  fields.forEach((f) => { keyCounts[f.key] = (keyCounts[f.key] || 0) + 1 })
  Object.entries(keyCounts).filter(([, c]) => c > 1).forEach(([k]) => {
    errors.push({ msg: 'Il campo "' + k + '" è definito più di una volta.', blockType: 'field' })
  })

  relations.forEach((r) => {
    if (r.target_module && !fieldCache.find((m) => m.slug === r.target_module)) {
      errors.push({ msg: 'La relazione "' + (r.label || r.key) + '" punta al modulo "' + r.target_module + '", che non esiste (più).', blockType: 'relation' })
    }
  })

  automations.forEach((a) => {
    if (a.trigger && a.trigger.evento === 'modifica_campo' && a.trigger.campo && !fields.find((f) => f.key === a.trigger.campo)) {
      errors.push({ msg: 'L\'automazione "' + (a.label || 'senza nome') + '" osserva il campo "' + a.trigger.campo + '", che non esiste (più).', blockType: 'automation' })
    }
    if (a.trigger && a.trigger.evento === 'cambio_stato' && a.trigger.stato && !workflowStates.find((w) => w.key === a.trigger.stato)) {
      warnings.push({ msg: 'L\'automazione "' + (a.label || 'senza nome') + '" osserva lo stato "' + a.trigger.stato + '", che non è (più) definito nel workflow.', blockType: 'automation' })
    }
    if (a.enabled === false) {
      warnings.push({ msg: 'L\'automazione "' + (a.label || 'senza nome') + '" è in pausa — non verrà eseguita finché non la riattivi.', blockType: 'automation' })
    }
    if (!a.azioni || a.azioni.length === 0) {
      warnings.push({ msg: 'L\'automazione "' + (a.label || 'senza nome') + '" non ha nessuna azione configurata — non fa nulla.', blockType: 'automation' })
    }
  })

  if (!permissionsBlock) {
    warnings.push({ msg: 'Nessun blocco Permessi configurato — tutti i ruoli hanno accesso pieno (vedere/creare/modificare/eliminare) a questo modulo.', blockType: 'permissions' })
  } else {
    (permissionsBlock.rules || []).forEach((r) => {
      if (r.view_own_only && !r.owner_field) {
        const roleLabel = (allRoles.find((x) => x.name === r.role) || {}).label || r.role
        warnings.push({ msg: 'Il ruolo "' + roleLabel + '" ha "Solo i propri" attivo senza un campo proprietario — filtrerà solo su chi ha creato il record, non su un\'assegnazione.', blockType: 'permissions' })
      }
    })
  }

  return { errors, warnings }
}
