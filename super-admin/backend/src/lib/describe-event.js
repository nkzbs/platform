// Traduce una riga grezza di audit_log/error_logs in una frase leggibile — prima
// esisteva solo una mappa parziale (11 azioni su circa 40 reali) dentro AuditPage.jsx
// lato frontend, con fallback sulla action grezza ("tenant.redeploy_all") e i
// dettagli mostrati come "chiave: valore" senza frase. Centralizzata qui lato
// backend (una sola fonte di verità, riusabile anche da un futuro export/notifica)
// e resa esaustiva sulle azioni reali trovate in tutte le chiamate a logAudit() nei
// due backend (core + super-admin).
function describeAudit(row) {
  const { action, target, details } = row;
  const d = details || {};
  const t = target || '';

  const TEMPLATES = {
    'tenant.create': () => `Tenant "${t}" creato`,
    'tenant.start': () => `Tenant "${t}" avviato`,
    'tenant.stop': () => `Tenant "${t}" fermato`,
    'tenant.delete': () => `Tenant "${t}" eliminato`,
    'tenant.restore': () => `Tenant "${t}" ripristinato da backup`,
    'tenant.redeploy': () => `Tenant "${t}" redeployato`,
    'tenant.redeploy_all': () => 'Redeploy lanciato su tutti i tenant',
    'tenant.admin_login_as': () => `Accesso come admin del tenant "${t}"`,
    'tenant.auto_update_toggle': () => `Aggiornamento automatico ${d.enabled ? 'attivato' : 'disattivato'} per "${t}"`,
    'tenant.backup_settings.update': () => `Impostazioni di backup aggiornate per "${t}"`,
    'tenant.credentials.reset': () => `Credenziali admin resettate per "${t}"`,
    'tenant.domain.update': () => `Dominio aggiornato per "${t}"`,
    'tenant.session_revoke': () => `Sessione revocata per "${t}"`,
    'tenant.template.update': () => `Template modificato per "${t}"`,
    'user.create': () => `Utente "${t}" creato`,
    'user.update': () => `Utente "${t}" modificato`,
    'user.rename': () => `Utente "${t}" rinominato in "${d.to}"`,
    'user.change_password': () => `Password cambiata per "${t}"`,
    'user.reset_password': () => `Password resettata da un altro admin per "${t}"`,
    'user.force_disable_2fa': () => `2FA disattivato da un altro admin per "${t}"`,
    'user.deactivate': () => `Utente "${t}" disattivato`,
    'user.disable': () => `Utente "${t}" disabilitato`,
    'user.enable': () => `Utente "${t}" abilitato`,
    'user.delete': () => `Utente "${t}" eliminato`,
    'webauthn.register': () => `Passkey registrata da "${t}"`,
    'webauthn.delete': () => `Passkey rimossa da "${t}"`,
    'auth.webauthn_login': () => `Accesso con passkey: "${t}"`,
    'auth.webauthn_login_failed': () => 'Accesso con passkey fallito',
    'user.modules_update': () => `Accesso ai moduli aggiornato per l'utente "${t}"`,
    'role.create': () => `Ruolo "${t}" creato`,
    'role.delete': () => `Ruolo "${t}" eliminato`,
    'module.create': () => `Modulo "${t}" creato`,
    'module.delete': () => `Modulo "${t}" eliminato`,
    'module.install': () => `Modulo "${t}" installato`,
    'module.uninstall': () => `Modulo "${t}" disinstallato`,
    'module.install_from_registry': () => `Modulo "${t}" installato dal Registro`,
    'module.publish': () => `Modulo "${t}" pubblicato`,
    'record.delete': () => `Record eliminato in "${t}"`,
    'records.bulk_set_field': () => `Modifica massiva su "${t}"`,
    'registry.publish': () => `Modulo "${t}" pubblicato nello Store`,
    'registry.unpublish': () => `Modulo "${t}" rimosso dallo Store`,
    'registry.install': () => `Modulo "${t}" installato da un tenant`,
    'registry.import': () => `Modulo importato nel Registro${t ? ': "' + t + '"' : ''}`,
    'registry.update_metadata': () => `Metadati aggiornati per "${t}"`,
    'registry.default_modules.update': () => `Modulo generico predefinito aggiornato: "${t}"`,
    'registry.keys.generate': () => `Chiavi di licenza generate per "${t}"`,
    'connection.connect': () => `Connessione "${t}" attivata`,
    'connection.disconnect': () => `Connessione "${t}" disattivata`,
    'connection.credentials_saved': () => `Credenziali salvate per la connessione "${t}"`,
    'backup.download': () => `Backup scaricato per "${t}"`,
    'backup.export_json': () => `Export dati JSON per "${t}"`,
    'backup.import_json': () => `Import dati JSON per "${t}"`,
    'super_builder.generate': () => `Bozza modulo generata via AI (Super Builder): "${t}"`,
    'super_builder.deploy': () => `Bozza modulo distribuita nel sandbox: "${t}"`,
    'update_manager.queue': () => 'Aggiornamento immagine messo in coda',
    'update_manager.cancel': () => 'Aggiornamento immagine annullato',
    'update_manager.rollback': () => 'Rollback immagine eseguito',
    'update_manager.image_import': () => 'Immagine importata manualmente',
  };

  if (TEMPLATES[action]) return TEMPLATES[action]();
  // Fallback per azioni non ancora mappate: non deve mai restare un id tecnico
  // grezzo senza spiegazione — meglio una frase generica ma leggibile.
  const humanized = action.replace(/[._]/g, ' ');
  return humanized.charAt(0).toUpperCase() + humanized.slice(1) + (t ? `: "${t}"` : '');
}

function describeError(row) {
  return `Errore non gestito in ${row.method || '?'} ${row.route || '?'}: ${row.message || 'nessun messaggio'}`;
}

// F9 — record_history (core/backend), un evento per ogni creazione/modifica/
// cancellazione/transizione di stato su un record di un modulo qualunque — questo
// sistema non ha "ordini"/"fatture" hardcoded, sono tutti record di moduli, quindi
// "modulo" resta il nome più onesto invece di inventare un'etichetta business finta.
function describeBusinessEvent(row) {
  const ACTION_LABEL = { create: 'creato', update: 'modificato', delete: 'eliminato', transition: 'cambiato di stato' };
  const label = ACTION_LABEL[row.action] || row.action;
  return `Record #${row.record_id} ${label} nel modulo "${row.module_slug}"`;
}

module.exports = { describeAudit, describeError, describeBusinessEvent };
