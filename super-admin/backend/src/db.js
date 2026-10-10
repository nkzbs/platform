const Database = require('better-sqlite3');

// Schema 0.1 di Super Admin: solo ciò che serve a creare/gestire i tenant, alla
// Libreria dei moduli e al Builder. Niente partner, fatturazione, licenze,
// verticali, CRM, supporto commerciale, federazione tra istanze.
// (Il perché di ogni cosa tolta: vedi PLATFORM-INVENTARIO.md.)
const db = new Database(process.env.DB_PATH || '/data/super-admin.db');

// REFERENCES serve solo come documentazione, mai come vincolo enforced: molte
// UPDATE/DELETE nel codice contano su questo. Fissato esplicitamente perché il
// default della libreria non è affidabile tra una build e l'altra.
db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL UNIQUE,
    db_path TEXT NOT NULL,
    status TEXT DEFAULT 'creating',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    domain TEXT,
    categoria TEXT,
    -- Segreti del tenant: generati qui alla creazione e passati come variabili
    -- d'ambiente al container. Senza encryption_key i campi cifrati del tenant
    -- non si leggono più: sono parte dei dati da salvare nei backup.
    encryption_key TEXT,
    jwt_secret TEXT,
    is_sandbox INTEGER DEFAULT 0,
    auto_update_enabled INTEGER DEFAULT 1,
    backup_auto_enabled INTEGER DEFAULT 1,
    backup_auto_frequency_hours INTEGER DEFAULT 24,
    backup_auto_retention INTEGER DEFAULT 7,
    backup_offsite_url TEXT,
    backup_offsite_credentials TEXT,
    provisioning_step TEXT,
    provisioning_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    totp_enabled INTEGER DEFAULT 0,
    totp_secret TEXT,
    totp_backup_codes TEXT,
    last_login_at DATETIME,
    stepup_until DATETIME
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT,
    method TEXT,
    message TEXT,
    stack TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

  -- Libreria dei moduli (nome interno "registry"). Una riga = una versione di un
  -- modulo: ripubblicare lo stesso modulo dello stesso tenant crea la versione +1.
  CREATE TABLE IF NOT EXISTS registry_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'box',
    color TEXT DEFAULT '#2563EB',
    schema_json TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    source_tenant_slug TEXT,
    release_notes TEXT,
    group_name TEXT,
    support_module INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registry_modules_slug ON registry_modules(slug, source_tenant_slug);

  -- Moduli installati di default in ogni nuovo tenant.
  CREATE TABLE IF NOT EXISTS default_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registry_module_id INTEGER NOT NULL REFERENCES registry_modules(id),
    UNIQUE(registry_module_id)
  );

  CREATE TABLE IF NOT EXISTS tenant_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_mb REAL,
    status TEXT DEFAULT 'ok',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    trigger TEXT DEFAULT 'manual',
    offsite_status TEXT,
    offsite_synced_at DATETIME,
    offsite_error TEXT,
    verify_status TEXT,
    verify_checked_at DATETIME,
    verify_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tenant_backups_tenant_slug ON tenant_backups(tenant_slug);

  CREATE TABLE IF NOT EXISTS update_manager (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    queued INTEGER DEFAULT 0,
    queued_at DATETIME,
    queued_by TEXT,
    run_hour INTEGER DEFAULT 3,
    last_run_at DATETIME,
    last_run_results TEXT,
    last_seen_image_id TEXT
  );

  -- Una riga al giorno, scritta solo dallo scheduler o da /analytics/capture-now.
  CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL UNIQUE,
    total_tenants INTEGER NOT NULL,
    total_modules_installed INTEGER NOT NULL,
    currency TEXT DEFAULT 'EUR',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON ai_usage_log(created_at);

  -- Chiave Mistral di un tenant (cifrata). Un tenant senza riga usa la chiave generale di Super Admin.
  CREATE TABLE IF NOT EXISTS tenant_ai_keys (
    tenant_slug TEXT PRIMARY KEY,
    mistral_key TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guide_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_key TEXT NOT NULL,
    useful INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Non esistono "moduli di supporto" (vedi core/backend/src/db.js): la colonna resta solo per i database esistenti e viene sempre azzerata.
db.exec(`
  UPDATE registry_modules SET support_module = 0 WHERE support_module IS NOT NULL AND support_module != 0;
  CREATE TRIGGER IF NOT EXISTS registry_no_support_ins AFTER INSERT ON registry_modules WHEN NEW.support_module IS NOT NULL AND NEW.support_module != 0
    BEGIN UPDATE registry_modules SET support_module = 0 WHERE id = NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS registry_no_support_upd AFTER UPDATE OF support_module ON registry_modules WHEN NEW.support_module IS NOT NULL AND NEW.support_module != 0
    BEGIN UPDATE registry_modules SET support_module = 0 WHERE id = NEW.id; END;
`);
// A chi appartiene ogni chiamata AI (NULL = Super Admin stesso, es. il Super Builder): serve al tetto per tenant.
if (!db.prepare("SELECT 1 FROM pragma_table_info('ai_usage_log') WHERE name = 'tenant_slug'").get()) {
  db.exec('ALTER TABLE ai_usage_log ADD COLUMN tenant_slug TEXT');
}
// Backup settimanale via mail (weekly-backup-mail.js): acceso/spento per tenant, ultimo invio, e la passphrase che cifra l'allegato (cifrata a riposo).
for (const col of ['backup_mail_weekly INTEGER DEFAULT 0', 'backup_mail_last_sent TEXT', 'backup_mail_passphrase TEXT']) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('tenants') WHERE name = ?").get(col.split(' ')[0])) db.exec('ALTER TABLE tenants ADD COLUMN ' + col);
}
db.prepare('INSERT OR IGNORE INTO update_manager (id) VALUES (1)').run();

// Seed del registro moduli — solo se completamente vuoto (prima installazione).
// Mai sovrascrive: se l'operatore ha già pubblicato moduli propri, non tocca nulla.
const registrySeedCount = db.prepare('SELECT COUNT(*) as c FROM registry_modules').get();
if (registrySeedCount.c === 0) {
  const ins = db.prepare(`INSERT INTO registry_modules (name, slug, description, icon, color, schema_json, version, source_tenant_slug) VALUES (?, ?, ?, ?, ?, ?, 1, 'platform')`);
  [
    ['Clienti', 'clienti', 'Anagrafica clienti — nome, email, telefono, azienda, indirizzo.', 'user', '#F59E0B',
      JSON.stringify({ fields: [{ key:'nome', label:'Nome', type:'text', required:true }, { key:'email', label:'Email', type:'email' }, { key:'telefono', label:'Telefono', type:'phone' }, { key:'azienda', label:'Azienda', type:'text' }, { key:'indirizzo', label:'Indirizzo', type:'mappa' }, { key:'note', label:'Note', type:'textarea' }] })],
    ['Ordini', 'ordini', 'Gestione ordini con workflow Nuovo → Confermato → Spedito → Consegnato.', 'box', '#2563EB',
      JSON.stringify({ fields: [{ key:'numero', label:'Numero', type:'text', required:true }, { key:'data', label:'Data', type:'date', required:true }, { key:'totale', label:'Totale', type:'currency' }, { key:'note', label:'Note', type:'textarea' }], workflow: { states: [{ key:'nuovo', label:'Nuovo', color:'#6B7280' }, { key:'confermato', label:'Confermato', color:'#3B82F6' }, { key:'spedito', label:'Spedito', color:'#F59E0B' }, { key:'consegnato', label:'Consegnato', color:'#10B981' }, { key:'annullato', label:'Annullato', color:'#EF4444' }], transitions: [{ from:'nuovo', to:'confermato', label:'Conferma' }, { from:'confermato', to:'spedito', label:'Spedito' }, { from:'spedito', to:'consegnato', label:'Consegnato' }, { from:'nuovo', to:'annullato', label:'Annulla' }, { from:'confermato', to:'annullato', label:'Annulla' }] } })],
    ['Prodotti', 'prodotti', 'Catalogo prodotti e servizi — nome, prezzo, categoria.', 'store', '#10B981',
      JSON.stringify({ fields: [{ key:'nome', label:'Nome', type:'text', required:true }, { key:'codice', label:'Codice / SKU', type:'text' }, { key:'prezzo', label:'Prezzo', type:'currency', required:true }, { key:'categoria', label:'Categoria', type:'select', options:['Prodotto','Servizio','Abbonamento'] }, { key:'descrizione', label:'Descrizione', type:'textarea' }] })],
    ['Progetti', 'progetti', 'Project management con fasi, scadenze e budget.', 'grid', '#7C3AED',
      JSON.stringify({ fields: [{ key:'nome', label:'Nome', type:'text', required:true }, { key:'data_inizio', label:'Data inizio', type:'date' }, { key:'data_fine', label:'Data fine', type:'date' }, { key:'budget', label:'Budget', type:'currency' }, { key:'descrizione', label:'Descrizione', type:'textarea' }], workflow: { states: [{ key:'pianificato', label:'Pianificato', color:'#6B7280' }, { key:'in_corso', label:'In corso', color:'#3B82F6' }, { key:'completato', label:'Completato', color:'#10B981' }, { key:'annullato', label:'Annullato', color:'#EF4444' }], transitions: [{ from:'pianificato', to:'in_corso', label:'Avvia' }, { from:'in_corso', to:'completato', label:'Completa' }, { from:'pianificato', to:'annullato', label:'Annulla' }, { from:'in_corso', to:'annullato', label:'Annulla' }] } })],
    ['Attività', 'attivita', 'Task con priorità, scadenza e workflow Da fare → In corso → Fatto.', 'check-square', '#EC4899',
      JSON.stringify({ fields: [{ key:'titolo', label:'Titolo', type:'text', required:true }, { key:'scadenza', label:'Scadenza', type:'date' }, { key:'priorita', label:'Priorità', type:'select', options:['Bassa','Media','Alta','Critica'] }, { key:'descrizione', label:'Descrizione', type:'textarea' }], workflow: { states: [{ key:'da_fare', label:'Da fare', color:'#6B7280' }, { key:'in_corso', label:'In corso', color:'#3B82F6' }, { key:'fatto', label:'Fatto', color:'#10B981' }], transitions: [{ from:'da_fare', to:'in_corso', label:'Inizia' }, { from:'in_corso', to:'fatto', label:'Completa' }, { from:'in_corso', to:'da_fare', label:'Rimetti in coda' }] } })],
  ].forEach(([name, slug, desc, icon, color, schema]) => ins.run(name, slug, desc, icon, color, schema));
  console.log('Seed: 5 moduli starter aggiunti al registro');
}

// 'Report' (2026-08-15): pagina a widget configurabili come la Dashboard (stesso
// motore, collezione widget separata — dashboard_widgets.page='report' in
// core/backend), fino ad ora forzata in ogni tenant dentro un blocco fisso della
// sidebar, mai disinstallabile/riordinabile. Ora è un modulo installabile dallo
// Store come qualunque altro: schema_json vuoto perché la pagina non è CRUD e non
// legge i suoi campi (App.jsx instrada lo slug 'report' su DashboardPage a
// prescindere, esattamente come già fa per 'dashboard'). Inserito una tantum,
// idempotente per slug — non tocca nulla se esiste già (es. dopo un riavvio).
try {
  const reportExists = db.prepare("SELECT id FROM registry_modules WHERE slug = 'report'").get();
  if (!reportExists) {
    db.prepare(`INSERT INTO registry_modules (name, slug, description, icon, color, schema_json, version, source_tenant_slug) VALUES (?, ?, ?, ?, ?, ?, 1, 'platform')`)
      .run('Report', 'report', 'Pagina di riepilogo a widget configurabili (grafici, KPI aggregati, pivot) — stesso motore della Dashboard, per pannelli come andamento mensile o riepilogo per categoria.', 'bar-chart', '#0EA5E9', '{}');
    console.log("Seed: modulo 'report' aggiunto al registro");
  }
} catch (e) {}

module.exports = db;
