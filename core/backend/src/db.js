const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || '/data/platform.db';

// Migrazione dati diretta senza backup/restore manuale (2026-08-14): se
// routes/instance-pairing.js ha ricevuto un trasferimento (POST
// /receive-migration) mentre il processo era già in esecuzione, il file
// arrivato è stato scritto ACCANTO al .db live (mai sovrascritto a caldo —
// una connessione SQLite aperta, specie in WAL, non tollera il file
// sostituito sotto di sé) e il processo si è riavviato apposta (supervisord
// ha autorestart=true, vedi core/supervisord.conf). Qui, PRIMA di aprire la
// connessione live, si applica lo scambio — stesso principio di
// bootstrap-instance.sh --restore-db, solo innescato da un riavvio invece
// che dalla creazione del container.
const INCOMING_MIGRATION_PATH = DB_PATH + '.incoming-migration';
if (fs.existsSync(INCOMING_MIGRATION_PATH)) {
  fs.renameSync(INCOMING_MIGRATION_PATH, DB_PATH);
  console.log('Migrazione dati applicata al boot: DB sostituito con il trasferimento in arrivo');
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'user',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT 'box',
    color TEXT DEFAULT '#2563EB',
    active INTEGER DEFAULT 1,
    installed INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    group_name TEXT DEFAULT NULL,
    group_order INTEGER DEFAULT 0,
    schema_json TEXT DEFAULT '{}',
    schema_json_draft TEXT,
    schema_version INTEGER DEFAULT 1,
    published_at DATETIME,
    support_module INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS modules_schema_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER REFERENCES modules(id),
    schema_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    published_by INTEGER REFERENCES users(id),
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT
  );

  -- Customer Overlay (2026-08-15) — una riga per modulo, scritta UNA sola volta
  -- da Super Admin al momento della clonazione da un verticale (vedi
  -- cloneModulesFromTemplate in super-admin/backend), mai più toccata dopo.
  -- Cattura lo schema_json esatto com'era alla nascita di QUESTO tenant — non
  -- "l'ultima versione del verticale" (quella si sposta, questo tenant no).
  -- "Personalizzato" = lo schema_json attuale del modulo è diverso da questa
  -- riga: il tenant ci ha messo mano dopo essere nato, indipendentemente da
  -- come si è evoluto il verticale nel frattempo. Un modulo mai clonato da un
  -- verticale (creato a mano, o un tenant senza modello) non ha una riga qui —
  -- resta semplicemente "non tracciato", mai un falso "personalizzato".
  CREATE TABLE IF NOT EXISTS module_overlay_baseline (
    module_slug TEXT PRIMARY KEY,
    baseline_schema_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    data TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_modules (
    user_id INTEGER REFERENCES users(id),
    module_slug TEXT NOT NULL,
    PRIMARY KEY (user_id, module_slug)
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Traccia i messaggi Gmail già smistati (vedi gmail-poller.js) — evita di ricreare
  -- la stessa spesa "da smistare" ad ogni ciclo del poller per un'email già vista.
  CREATE TABLE IF NOT EXISTS gmail_processed_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Connessioni: SOLO credenziali/stato di collegamento ai servizi esterni, a livello
  -- di tenant (non di modulo). Le automazioni (dentro ogni modulo, vedi schema-v3.js
  -- block_type 'automation') referenziano un integration_id qui presente per sapere
  -- se possono usarlo come azione. Il "connetti" resta simulato (nessun vero OAuth:
  -- richiederebbe credenziali app reali per ogni servizio) ma ora è persistito, non
  -- più stato React perso al reload.
  CREATE TABLE IF NOT EXISTS connections (
    integration_id TEXT PRIMARY KEY,
    connected INTEGER DEFAULT 0,
    connected_at DATETIME
  );

  -- Log esecuzioni automazioni — una riga per ogni volta che un trigger (nuovo record,
  -- cambio stato, modifica campo) fa scattare un'automazione definita nello schema di
  -- un modulo. L'esecuzione dell'azione stessa resta simulata (nessuna chiamata reale
  -- a Slack/FiC/WhatsApp: richiederebbe le credenziali vere del tenant), ma il trigger
  -- match e la valutazione delle condizioni Se/Altrimenti sono reali, non finti.
  CREATE TABLE IF NOT EXISTS automation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    automation_label TEXT,
    trigger_desc TEXT,
    action_desc TEXT,
    esito TEXT DEFAULT 'simulato',
    record_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Widget dashboard — prima vivevano in localStorage (per browser, non per tenant: due
  -- persone sulla stessa istanza vedevano dashboard diverse, e sparivano cambiando
  -- browser). Ora sono dati veri del tenant, condivisi da tutti gli utenti che lo
  -- aprono, coerenti col resto del sistema (schema_json, records, ecc. sono già così).
  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'kpi',
    module_slug TEXT,
    field TEXT,
    aggregation TEXT DEFAULT 'sum',
    label TEXT,
    color TEXT DEFAULT '#2563EB',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Link many-to-many con attributi extra (es. cliente × prodotto con prezzo, sconto).
  -- Chiave logica: source_module + source_id + relation_key + target_id — unica.
  CREATE TABLE IF NOT EXISTS m2m_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_module TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    relation_key TEXT NOT NULL,
    target_module TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_module, source_id, relation_key, target_id)
  );

  -- Storico modifiche record — una riga per ogni create/update/delete/transition.
  -- before_data/after_data sono snapshot JSON del data al momento dell'azione.
  -- Non sostituisce backup: è un log leggibile dall'utente, non una fonte per restore.
  CREATE TABLE IF NOT EXISTS record_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    module_slug TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    before_data TEXT,
    after_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- F10 (PLATFORM-MASTER-ROADMAP.md) — Assessment Engine: le regole sono DATI, mai
  -- codice — un "pacchetto" (GDPR, Security, ...) è solo un insieme di righe con lo
  -- stesso package_slug. LASCIATA INERTE su Finance (2026-09-29): assessment-engine.js
  -- e routes/assessment.js sono stati rimossi per intero (motivo: GDPR non più
  -- necessario su questo tenant, deciso dall'utente pur con 8 finding reali esistenti
  -- al momento della rimozione) — le tabelle restano solo dato storico, mai lette.
  CREATE TABLE IF NOT EXISTS assessment_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_slug TEXT NOT NULL,
    rule_key TEXT NOT NULL,
    categoria TEXT NOT NULL,
    descrizione TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    remediation TEXT,
    config_json TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_slug, rule_key)
  );

  -- Un finding per (rule_id, scope): una nuova scansione aggiorna evidence/severity
  -- e last_seen_at se ancora rilevato, mai duplica la riga. Se non più rilevato e lo
  -- stato era open/acknowledged, passa automaticamente a resolved (il problema è
  -- sparito). Se lo stato era dismissed (operatore: "non applicabile/rischio
  -- accettato"), NON viene mai resettato in automatico dalla scansione.
  CREATE TABLE IF NOT EXISTS assessment_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES assessment_rules(id),
    scope TEXT NOT NULL,
    evidence TEXT,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    owner TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    UNIQUE(rule_id, scope)
  );


  -- Tracciamento ultima esecuzione per le automazioni schedulate (trigger temporale).
  -- La chiave è module_slug + automation_id: ogni coppia ha il proprio timestamp.
  -- Usato dal loop scheduler in index.js per evitare esecuzioni duplicate.
  CREATE TABLE IF NOT EXISTS scheduled_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    automation_id TEXT NOT NULL,
    last_run_at DATETIME NOT NULL,
    UNIQUE(module_slug, automation_id)
  );

  -- Registro strutturato dei delta numerici applicati da increment/decrement
  -- (aggiorna_record, aggiorna_figli, trova_o_crea_e_aggiorna) — a differenza di
  -- automation_logs (testo libero per umani), questa tabella è machine-readable e
  -- permette a storna_riferimento di invertire esattamente ciò che un'automazione
  -- ha applicato in precedenza, senza dover ricalcolare o indovinare il delta.
  -- source_module/source_record_id è il record che ha SCATENATO l'automazione (es.
  -- un pagamento), non quello aggiornato (es. il conto) — storna_riferimento cerca
  -- per source, non per il record aggiornato, dato che un solo record sorgente può
  -- aver generato più delta (es. un pagamento tocca sia il conto Cassa sia Clienti).
  CREATE TABLE IF NOT EXISTS automation_deltas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    campo TEXT NOT NULL,
    delta REAL NOT NULL,
    source_module TEXT NOT NULL,
    source_record_id INTEGER NOT NULL,
    stornato INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Ruoli custom oltre admin/user — name è l'identificatore usato nelle regole
  -- permessi (stringa libera, es. 'venditore'), label è il nome leggibile.
  -- admin e user sono built-in e non compaiono qui: esistono per convenzione.
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#6B7280',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Audit log del singolo tenant: azioni amministrative fatte DENTRO questa istanza
  -- (non quelle sui container/tenant stessi, che vivono nell'audit log del Super
  -- Admin). Copre le azioni strutturali — pubblicazione schema, utenti, connessioni,
  -- moduli, installazioni dal registro — non ogni singolo record creato/modificato:
  -- quello sarebbe rumore, non un audit trail leggibile.
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Eccezioni impreviste nelle route di questo tenant, altrimenti visibili solo nei
  -- log Docker. Super Admin le legge in sola lettura da tutti i tenant insieme (vedi
  -- /monitoring/errors) — stessa tabella/forma in ogni tenant apposta, così la
  -- lettura cross-DB non deve gestire schemi diversi.
  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT,
    method TEXT,
    message TEXT,
    stack TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );


  -- Andamento nel tempo di un pacchetto Assessment (2026-09-04, richiesto dall'utente:
  -- "più profondità nei grafici") — una riga per (pacchetto, giorno), scritta da
  -- POST /assessment/run subito dopo ogni scansione con package_slug esplicito (mai
  -- per una scansione "tutti i pacchetti", che non ha un trend di senso unico).
  -- UNIQUE su (package_slug, snapshot_date): più scansioni nello stesso giorno
  -- aggiornano la stessa riga invece di accumulare rumore infragiornaliero.
  -- Sito Web pubblico (2026-09-04) — motore a blocchi, CORE (non un modulo Store):
  -- qualunque tenant può avere una pagina pubblica di base, il verticale e-commerce
  -- la seed già completa (vedi seed dedicato più sotto nel setup del template), la
  -- personalizzazione avanzata (blocchi extra tipo galleria/html libero) resta gated
  -- da un modulo separato — mai duplicato l'engine per quello, solo un controllo in
  -- più lato route. blocks_json: array ordinato di {type, config} — l'ordine
  -- nell'array È l'ordine di rendering, nessun campo sort_order separato da tenere
  -- allineato a mano.
  CREATE TABLE IF NOT EXISTS site_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    meta_description TEXT,
    blocks_json TEXT NOT NULL DEFAULT '[]',
    published INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Lead del blocco "form" (2026-09-05, piano Sito Web punto 4 — l'utente:
  -- form vero su "prova" di Nico Caffè, non solo testo). Una riga per invio,
  -- dati grezzi in data_json (le chiavi sono quelle dichiarate dall'admin nel
  -- blocco, mai fisse — un modulo generico non può conoscere in anticipo i
  -- campi di ogni tenant). page_slug/block_anchor solo per contesto in
  -- lettura, nessuna foreign key verso site_pages: una pagina cancellata non
  -- deve far sparire i lead già raccolti.
  CREATE TABLE IF NOT EXISTS site_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_slug TEXT NOT NULL,
    block_anchor TEXT,
    data_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'nuovo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  -- email_status (2026-09-05): esito reale del tentativo di invio email per
  -- QUESTO lead ('inviata'/'errore'/'simulato') — mai un valore finto,
  -- l'admin deve poter vedere se l'email è davvero partita. Aggiunta via
  -- ensureColumn sotto (non qui): la tabella esiste già su installazioni
  -- reali create prima di questa colonna.

  CREATE TABLE IF NOT EXISTS assessment_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_slug TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    open_count INTEGER NOT NULL,
    critical_count INTEGER NOT NULL,
    warning_count INTEGER NOT NULL,
    info_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_slug, snapshot_date)
  );
`);

// Migrazione idempotente: aggiunge colonne mancanti su tabelle già esistenti.
// Finora ogni nuova colonna (schema_json_draft, schema_version, ecc.) è stata
// aggiunta solo dentro CREATE TABLE IF NOT EXISTS, che non tocca una tabella già
// creata — su un tenant reale non ricreato da zero quella colonna resterebbe
// assente e le query che la usano fallirebbero. Da qui in poi ogni nuova colonna
// va aggiunta anche qui, non solo nel CREATE TABLE sopra.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migrazione: aggiunta colonna ${column} a ${table}`);
  }
}
ensureColumn('modules', 'support_module', 'INTEGER DEFAULT 0');
// Il cerchio "tap-to-pay" (ModulePage/ChecklistWidget) si attiva da solo su
// qualunque workflow con una coppia di stati A<->B — euristica utile per
// pagamenti/debiti ma fuorviante su moduli come Clienti dove una coppia
// bidirezionale (es. Attivo<->Sospeso) è uno stato generico, non un "pagato".
// Default 1 (comportamento invariato ovunque già lo usi), spegnibile da Builder.
ensureColumn('modules', 'quick_toggle', 'INTEGER DEFAULT 1');
ensureColumn('modules', 'group_name', 'TEXT DEFAULT NULL');
ensureColumn('modules', 'group_order', 'INTEGER DEFAULT 0');
// Vista della lista record: 'table' (default) o 'card_grid' — griglia di card colorate
// invece della tabella, per moduli tipo Note (NoteFinancePage.jsx, stile sticky-note),
// dove una riga di tabella non ha senso. Primitiva "vista alternativa" del piano
// "100% Builder" — proprietà a livello modulo (come quick_toggle), non nello schema
// v3 dei campi, perché descrive COME si vede la lista, non la struttura dei dati.
ensureColumn('modules', 'list_view', "TEXT DEFAULT 'table'");
// Se impostato, il nome di un campo type:'file' di questo modulo che riceve
// l'upload batch (un file selezionato = un nuovo record, non un allegato multiplo su
// un record esistente) — copre DocumentiFinancePage.jsx. NULL = disattivato.
ensureColumn('modules', 'batch_upload_field', 'TEXT DEFAULT NULL');
// Se impostato insieme a batch_upload_field, il nome di un campo type:'select' di cui
// chiedere il valore UNA VOLTA prima del batch (es. "Tipo documento": Contratto/Fattura/
// Ricevuta...), applicato a TUTTI i record creati in quel batch — copre la scelta di
// categoria di DocumentiFinancePage.jsx prima dell'upload multiplo. NULL = nessuna scelta,
// i record creati non hanno quel campo valorizzato.
ensureColumn('modules', 'batch_upload_category_field', 'TEXT DEFAULT NULL');
// Sostituisce la vecchia lista ['dashboard', 'utenti'] scritta a mano in
// routes/modules.js per decidere cosa non si può disinstallare/eliminare — ora è
// un flag reale sul modulo, non una stringa slug da tenere sincronizzata a mano nel
// codice. Backfill una tantum: sui tenant già esistenti (dove la colonna non c'era
// ancora) il seed di 'dashboard' risale a prima di questa colonna, quindi va marcato
// esplicitamente qui invece di perdere silenziosamente la protezione al primo avvio
// con la colonna nuova.
ensureColumn('modules', 'is_system', 'INTEGER DEFAULT 0');
db.prepare("UPDATE modules SET is_system = 1 WHERE slug = 'dashboard' AND is_system != 1").run();
// "Richieste Privacy (GDPR)" resa core (2026-09-03, richiesto dall'utente: unita alla
// pagina GDPR, non più un modulo che un tenant potrebbe disinstallare) — stesso
// principio di 'dashboard' sopra: protegge il modulo ovunque sia già installato
// (oggi solo Coffee), no-op sui tenant che non lo hanno ancora. La disponibilità su
// OGNI nuovo tenant passa dal Registro (default_modules, super-admin/backend), non
// da questo file — qui si protegge solo ciò che esiste già.
db.prepare("UPDATE modules SET is_system = 1 WHERE slug = 'richieste_privacy' AND is_system != 1").run();
ensureColumn('connections', 'credentials', 'TEXT DEFAULT NULL');
ensureColumn('dashboard_widgets', 'config', "TEXT DEFAULT '{}'");
// Vuoto/NULL = visibile a tutti (comportamento invariato). Con ruoli elencati, il
// widget compare solo a chi ha uno di quei ruoli — così un ruolo come "Agente" può
// avere un riepilogo dedicato (i propri ordini/clienti) invece della stessa
// dashboard aggregata di tutto il tenant che vede l'Amministratore.
ensureColumn('dashboard_widgets', 'roles', 'TEXT DEFAULT NULL');
// 'dashboard' (default, invariato) o 'report' — stessa tabella/editor, due collezioni
// separate di widget invece di due tabelle identiche. Nata per Report: una pagina a
// widget configurabili come la Dashboard, ma per i pannelli aggregati (riepilogo
// mensile, pivot categoria, andamento settimanale) invece che per i KPI operativi.
ensureColumn('dashboard_widgets', 'page', "TEXT DEFAULT 'dashboard'");
// Come 'roles' sopra, ma per singoli utenti invece che per ruolo — necessario
// perché due persone reali possono condividere lo stesso ruolo "Utente" (es.
// Finance: Nima e Federica) e vale la pena distinguerle: un widget può essere
// pensato per uno solo dei due, non per "chiunque abbia ruolo Utente". Si
// somma a 'roles' (OR tra le due liste), non lo sostituisce — un widget può
// restare visibile per ruolo E in più a un utente specifico fuori da quel ruolo.
ensureColumn('dashboard_widgets', 'user_ids', 'TEXT DEFAULT NULL');
ensureColumn('users', 'vault_pin_hash', 'TEXT DEFAULT NULL');
// Collega un utente Platform a UN record di business (es. l'utente "mario.rossi",
// ruolo Agente, collegato al record #12 del modulo "agenti") — serve a scoping
// "solo i propri" basato su una relazione dello schema (owner_field), non solo su
// chi ha creato il record da UI. Nullable: nessun impatto sugli utenti esistenti.
ensureColumn('users', 'linked_module_slug', 'TEXT DEFAULT NULL');
ensureColumn('users', 'linked_record_id', 'INTEGER DEFAULT NULL');

// Intestazione azienda per i documenti stampabili (bolle, fatture, ricevute) — una
// sola riga per tenant (id fisso 1), analoga alla costante AZIENDA fissa di nico ma
// editabile da UI invece che hardcoded nel codice, dato che ogni tenant è
// un'azienda diversa sulla stessa immagine Docker.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS tenant_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ragione_sociale TEXT DEFAULT NULL,
    indirizzo TEXT DEFAULT NULL,
    piva TEXT DEFAULT NULL,
    logo_url TEXT DEFAULT NULL
  )`);
  db.prepare('INSERT OR IGNORE INTO tenant_settings (id) VALUES (1)').run();
} catch (e) {}

// White-label minimo (2026-08-14): logo_url esisteva già (sopra) ma solo per i
// documenti stampabili, mai letto dall'app stessa — accent_color è nuovo. Zero
// valorizzati di default: un tenant senza personalizzazione resta identico a
// oggi (fallback ai colori/logo di default nel frontend), mai un colore/logo
// a sorpresa scelto per lui.
ensureColumn('tenant_settings', 'accent_color', 'TEXT DEFAULT NULL');
// White-label completo (2026-08-15): un tenant che ha già logo/nome propri può
// nascondere anche il nome "Platform" davanti al proprio (login e sidebar
// mostrano solo il brand del tenant) — opzione generica per chiunque, non
// legata a un tenant specifico. Default 0: nessun cambiamento per chi non
// la attiva esplicitamente dalle Impostazioni.
ensureColumn('tenant_settings', 'hide_platform_name', 'INTEGER DEFAULT 0');
// CMS pagina di accesso (2026-08-15) — richiesto dall'utente esplicitamente
// come NON un modulo ("non sarà un modulo"): stessi 4 campi facoltativi del
// resto del white-label, letti dall'endpoint pubblico /tenant-info (la login
// gira prima di qualunque autenticazione) e resi in Login.jsx solo se
// login_headline è valorizzato — altrimenti resta la card centrata di sempre,
// zero cambiamento per chi non la configura.
ensureColumn('tenant_settings', 'login_headline', 'TEXT DEFAULT NULL');
ensureColumn('tenant_settings', 'login_subheadline', 'TEXT DEFAULT NULL');
ensureColumn('tenant_settings', 'login_body', 'TEXT DEFAULT NULL');
ensureColumn('tenant_settings', 'login_hero_image_url', 'TEXT DEFAULT NULL');

// Sito Web pubblico (2026-09-04, richiesto dall'utente: motore standard per
// qualunque tenant, non solo e-commerce — "lo vorrei standard per tutti") —
// site_enabled di default 0: un tenant non lo vede finché non lo attiva
// esplicitamente dalle Impostazioni, zero sorprese per chi non lo usa mai.
// site_og_image_url: fallback per i tag Open Graph quando una pagina non ha
// una propria immagine — un dato di sito, non di singola pagina.
ensureColumn('tenant_settings', 'site_enabled', 'INTEGER DEFAULT 0');
ensureColumn('tenant_settings', 'site_og_image_url', 'TEXT DEFAULT NULL');
// Email di notifica per il blocco "form" (2026-09-05, richiesto dall'utente:
// "il form di contatto deve mandare una mail") — indirizzo a cui inviare
// l'email quando arriva un lead, letto da routes/site.js insieme alle
// credenziali del connettore 'email_resend' (tabella connections, stesso
// meccanismo già in uso per WhatsApp/Slack/Mailchimp). Colonna di sito, non
// di pagina: un tenant ha un solo indirizzo di notifica per tutti i form.
ensureColumn('tenant_settings', 'lead_notification_email', 'TEXT DEFAULT NULL');
// Theme Builder (2026-09-05, "settimane di riprogettazione" scelto
// dall'utente dopo il piano canvas WYSIWYG) — header/footer condivisi tra
// TUTTE le pagine di un tenant, non più duplicati blocco-per-blocco in
// ogni pagina. Colonna di sito (tenant_settings), non di pagina — stesso
// principio già seguito per accent_color/font_style. NULL = comportamento
// di sempre (header/footer restano blocchi inline in blocks_json, zero
// regressione per chi non adotta questa funzionalità). Il valore è un
// oggetto blocco COMPLETO ({type:'header', config:{...}}), non solo il
// config — riusa identico renderBlockInner/BlockEditor già esistenti per
// i blocchi header/footer, zero rendering/editor nuovo da scrivere.
ensureColumn('tenant_settings', 'site_header_json', 'TEXT DEFAULT NULL');
ensureColumn('tenant_settings', 'site_footer_json', 'TEXT DEFAULT NULL');
// Design-token globali (2026-09-05, "abbiamo Divi?" — fase 1 della lista di
// gap confermata dall'utente) — una manciata di colori nominati riutilizzati
// da qualunque blocco (style_overrides.background/color può contenere
// "var(--sw-primary)" invece di un hex letterale), invece di scegliere lo
// stesso colore a mano su ogni blocco. NULL = nessun token configurato,
// zero output CSS in più per chi non li usa. Oggetto piatto
// {primary,secondary,background,text}, non un array libero — 4 ruoli fissi
// coprono il caso reale, un editor di token arbitrari sarebbe sproporzionato
// per il valore che aggiunge oggi.
ensureColumn('tenant_settings', 'design_tokens_json', 'TEXT DEFAULT NULL');
// Scroll-progress bar (2026-09-05, confronto 1:1 col mockup di riferimento
// nico-caffe-v5.html) — impostazione di Tema (come header/footer/design
// token), non per singola pagina: la barra è un elemento di chrome visibile
// ovunque, coerente con dove vive il resto del "vestito" condiviso del sito.
ensureColumn('tenant_settings', 'scroll_progress', 'INTEGER DEFAULT 0');
ensureColumn('site_leads', 'email_status', 'TEXT DEFAULT NULL');
// Fase 8, confronto 1:1 col mockup di riferimento (2026-09-06) — due
// toggle di Tema separati, stesso schema di scroll_progress: hover_effects
// (spotlight sulle sezioni scure + tilt 3D sulle card prodotto + bottoni
// magnetici, tutti dietro (hover:hover) and (pointer:fine), mai su touch)
// ed eyebrow_swoosh (sottolineatura decorativa disegnata, puro CSS via
// .s-in-view — funziona anche su touch, per questo NON è raggruppata nello
// stesso toggle "hover": nominare un effetto sempre attivo come "hover"
// sarebbe fuorviante per chi lo attiva dal pannello).
ensureColumn('tenant_settings', 'hover_effects', 'INTEGER DEFAULT 0');
ensureColumn('tenant_settings', 'eyebrow_swoosh', 'INTEGER DEFAULT 0');

// Assistente AI (smistamento bollette): spento finché non lo si attiva dalle impostazioni.
ensureColumn('tenant_settings', 'ai_bollette_enabled', 'INTEGER DEFAULT 0');
ensureColumn('tenant_settings', 'ai_report_enabled', 'INTEGER DEFAULT 0');

// Riepilogo del mattino su WhatsApp (un solo messaggio al giorno con scadenze di oggi, di domani e in ritardo).
// Spento finché non lo si accende; l'ora è quella italiana.
ensureColumn('tenant_settings', 'digest_enabled', 'INTEGER DEFAULT 0');
ensureColumn('tenant_settings', 'digest_hour', 'INTEGER DEFAULT 8');
ensureColumn('tenant_settings', 'digest_last_sent', 'TEXT DEFAULT NULL');

// Suggerimenti dell'AI su un record. L'AI PROPONE, mai scrive: un suggerimento resta
// 'pending' finché non lo si accetta (applica i campi al record) o lo si ignora.
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'bolletta',
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_ai_suggestions_record ON ai_suggestions(module_slug, record_id, status);
`);

// Destinatari WhatsApp e regole Gmail: impostazioni del sistema (prima erano due moduli nascosti,
// con le righe nella tabella `records`; vedi notification-settings.js e docs/DECISIONI.md).
db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    numero TEXT NOT NULL,
    triggers TEXT NOT NULL DEFAULT '[]',
    attivo INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS gmail_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mittente TEXT NOT NULL,
    descrizione TEXT,
    gruppo TEXT NOT NULL DEFAULT 'Casa',
    categoria TEXT,
    attiva INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
ensureColumn('gmail_rules', 'tipo', "TEXT DEFAULT 'bolletta'"); // cosa leggere dalla mail: bolletta (importo e scadenza) o semplice (solo oggetto e allegati)
ensureColumn('gmail_rules', 'modulo', 'TEXT'); // modulo di destinazione scelto sulla regola (vuoto = come prima, dal gruppo)

// Movimenti bancari letti dagli estratti conto (PDF): servono a vedere cosa succede davvero sul conto e a
// completare Finance. Il PDF non si conserva: si legge e si scarta (vedi bank-import.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    iban_last4 TEXT NOT NULL UNIQUE,
    holder TEXT,
    nome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bank_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    date TEXT NOT NULL,
    booked TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    merchant TEXT,
    kind TEXT NOT NULL,
    category_hint TEXT,
    match_module TEXT,
    match_id INTEGER,
    ignored INTEGER NOT NULL DEFAULT 0,
    dedupe_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bank_movements_date ON bank_movements(date);
  CREATE INDEX IF NOT EXISTS idx_bank_movements_key ON bank_movements(account_id, dedupe_key);
`);

// Analisi "Come sta andando": impostazioni (JSON, una riga) e spiegazione scritta dall'assistente per
// mese, conservata per non richiamare l'AI a ogni apertura (vedi insights.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS insights_config (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS insight_explanations (
    month TEXT PRIMARY KEY,
    snapshot_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Tema per pagina (2026-09-04, richiesto dall'utente dopo aver mostrato un mockup
// reale — brand scuro/oro con font serif) — a livello di PAGINA, non di tenant: un
// sito può avere sezioni scure alternate a chiare (ogni blocco ha il proprio flag
// `dark` in blocks_json), ma il colore d'accento e il font sono un'identità unica
// per l'intera pagina. Default NULL/'sans' -> zero cambiamento visivo per una
// pagina già esistente che non li imposta mai.
ensureColumn('site_pages', 'accent_color', "TEXT DEFAULT NULL");
ensureColumn('site_pages', 'font_style', "TEXT DEFAULT 'sans'");
// Popup (2026-09-05, "andiamo avanti con Divi" — popup builder semplice, non
// un blocco tra gli altri: un popup vive SOPRA la pagina, a comparsa
// condizionale, non nel flusso verticale di blocks_json). Un oggetto piatto
// con campi fissi (title/body/cta/immagine), non un array di blocchi come
// blocks_json — "semplice" per scelta: un vero mini-composer dentro un
// popup avrebbe richiesto annidare l'intero BlockEditor in un altro
// pannello, sproporzionato per un caso d'uso che nella pratica è quasi
// sempre "un'offerta o un avviso con un bottone". Default NULL -> nessun
// cambiamento per una pagina esistente che non lo configura.
ensureColumn('site_pages', 'popup_json', 'TEXT DEFAULT NULL');

try {
  db.exec(`CREATE TABLE IF NOT EXISTS record_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_slug TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    upload_id INTEGER NOT NULL REFERENCES uploads(id),
    tipo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
} catch (e) {}

try {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    module_slug TEXT,
    record_id INTEGER,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
} catch (e) {}
// Notifiche mirate per ruolo + categoria (2026-08-15): fino ad ora ogni notifica
// era globale, visibile a chiunque — l'automazione "notifica_interna" era l'unica
// fonte, mai pensata per un annuncio rivolto SOLO a un ruolo (es. admin scrive un
// comunicato, deve arrivare agli agenti e basta, non anche a chi lo ha scritto).
// Stesso pattern già in uso su dashboard_widgets.roles (JSON array, [] o assente =
// visibile a tutti, filtro lato server sul ruolo di chi legge) — non un meccanismo
// nuovo, lo stesso esteso a un'altra tabella. `category` è generico (qualunque
// notifica futura può valorizzarlo), non specifico di un tenant.
// FIX 2026-08-15: queste due righe stavano PRIMA della CREATE TABLE qui sopra —
// su un tenant già esistente (dove la tabella c'era già da prima) non si notava
// mai, ma su un tenant NUOVO (database vuoto) mandava il container in crash-loop
// verticale all'avvio ("no such table: notifications"), scoperto testando il
// Customer Overlay creando un tenant di prova.
ensureColumn('notifications', 'roles', "TEXT DEFAULT '[]'");
ensureColumn('notifications', 'category', 'TEXT DEFAULT NULL');

// Log accessi: una riga per login, `last_seen_at` aggiornato a ogni richiesta
// autenticata (vedi requireAuth in routes/auth.js) — "durata" è last_seen_at -
// login_at, una stima per approssimazione dato che non esiste un logout esplicito
// (il logout è solo lato client, cancella il token). Letto da Super Admin via
// accesso diretto al file .db del tenant, stesso meccanismo già usato per backup.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME DEFAULT NULL
  )`);
} catch (e) {}
// Migrazione additiva per i tenant creati prima del logout remoto (CREATE TABLE IF
// NOT EXISTS sopra non aggiunge colonne a una tabella già esistente).
ensureColumn('sessions', 'revoked_at', 'DATETIME DEFAULT NULL');
// last_seen_at si aggiorna a OGNI richiesta autenticata (incluso il polling
// automatico della campanella notifiche/log attività) — corretto per "quanto è
// durata la sessione", sbagliato per "l'utente sta usando l'app ORA": una tab
// dimenticata aperta resta indistinguibile da un uso reale. last_active_at si
// aggiorna solo sulle richieste che NON sono polling passivo (vedi requireAuth
// in routes/auth.js) — è questo che Super Admin controlla prima di un redeploy,
// last_seen_at resta invariato per tutto il resto (storico sessioni, durata).
ensureColumn('sessions', 'last_active_at', 'DATETIME');

// 2FA (TOTP) — attivabile dal singolo utente dal proprio pannello (Account), mai
// imposto da un admin su un altro utente. totp_secret resta NULL finché non viene
// confermato con un codice reale (vedi routes/auth.js POST /2fa/confirm) — un
// secret "in sospeso" da /2fa/setup non abilita nulla da solo.
ensureColumn('users', 'totp_secret', 'TEXT');
ensureColumn('users', 'totp_enabled', 'INTEGER DEFAULT 0');
// JSON: array di hash bcrypt, mai il codice in chiaro dopo la generazione iniziale
// (mostrato una sola volta all'attivazione). Ogni codice usato viene rimosso
// dall'array, non solo marcato — un codice di recupero è a singolo uso reale.
ensureColumn('users', 'totp_backup_codes', 'TEXT');

// Legame tra un modulo installato dal Registro e la sua origine — prima non esisteva
// affatto (solo un registry_module_id scritto una tantum nell'audit log, mai riletto),
// quindi un tenant non sapeva mai se una versione più recente fosse stata pubblicata
// dopo. registry_slug/registry_source_tenant_slug servono a ritrovare il modulo nel
// registro (ogni ripubblicazione crea una NUOVA riga con id diverso, quindi
// registry_module_id da solo non basta a trovare la versione più recente).
ensureColumn('modules', 'registry_module_id', 'INTEGER');
ensureColumn('modules', 'registry_source_tenant_slug', 'TEXT');
ensureColumn('modules', 'registry_slug', 'TEXT');
ensureColumn('modules', 'registry_version', 'INTEGER');

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existing) {
  // La password vera arriva da Super Admin al momento della creazione del tenant
  // (INITIAL_ADMIN_PASSWORD). Se la variabile manca (tenant avviato a mano, fuori
  // dal flusso normale) se ne genera una casuale, stampata una sola volta nel log.
  const fromEnv = !!process.env.INITIAL_ADMIN_PASSWORD;
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || require('../../../shared/generate-password.js').generatePassword();
  const hash = bcrypt.hashSync(initialPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, 'Admin', 'admin');
  if (fromEnv) {
    console.log('Utente admin creato (password fornita da Super Admin, non stampata qui).');
  } else {
    console.log('Utente admin creato: admin / ' + initialPassword + '  (mostrata una sola volta, salvala ora)');
  }
}

const moduleCount = db.prepare('SELECT COUNT(*) as c FROM modules').get();
if (moduleCount.c === 0) {
  const mods = [
    { name: 'Dashboard', slug: 'dashboard', icon: 'home', color: '#2563EB', installed: 1, sort_order: 0, is_system: 1 },
    { name: 'Spese', slug: 'spese', icon: 'credit-card', color: '#10B981', installed: 0, sort_order: 1, is_system: 0 },
    { name: 'Contatti', slug: 'contatti', icon: 'user', color: '#F59E0B', installed: 0, sort_order: 2, is_system: 0 },
    { name: 'Documenti', slug: 'documenti', icon: 'file', color: '#6366F1', installed: 0, sort_order: 3, is_system: 0 },
    { name: 'Report', slug: 'report', icon: 'bar-chart', color: '#EC4899', installed: 0, sort_order: 4, is_system: 0 }
  ];
  const stmt = db.prepare('INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const spese = JSON.stringify({ fields: [{ key: 'descrizione', label: 'Descrizione', type: 'text', required: true }, { key: 'importo', label: 'Importo', type: 'currency', required: true }, { key: 'data', label: 'Data', type: 'date', required: true }, { key: 'categoria', label: 'Categoria', type: 'select', options: ['Alimentari', 'Trasporti', 'Utenze', 'Altro'] }] });
  const contatti = JSON.stringify({ fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'text' }, { key: 'telefono', label: 'Telefono', type: 'text' }, { key: 'note', label: 'Note', type: 'textarea' }] });
  const documenti = JSON.stringify({ fields: [{ key: 'titolo', label: 'Titolo', type: 'text', required: true }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Contratto', 'Fattura', 'Altro'] }, { key: 'data', label: 'Data', type: 'date' }] });
  mods.forEach((m) => {
    const schema = m.slug === 'spese' ? spese : m.slug === 'contatti' ? contatti : m.slug === 'documenti' ? documenti : '{}';
    stmt.run(m.name, m.slug, m.icon, m.color, m.installed, m.sort_order, schema, m.is_system);
  });
  console.log('Moduli di default creati');
}

// F10 — un solo pacchetto reale seminato (GDPR), non un placeholder per ognuno dei
// pacchetti citati dalla roadmap (Security/Quality/Operations/ISO): costruire regole
// finte per pacchetti di cui non esiste un contenuto verificabile violerebbe lo
// stesso principio già applicato in F5 ("mai un check finto"). Il meccanismo
// (assessment_rules come dati, engine generico) è comunque pronto per un futuro
// pacchetto reale — basterebbe un altro INSERT, mai una modifica all'engine.
// Euristica dichiarata, non certezza legale: un campo il cui nome/etichetta
// richiama un dato personale ma non è configurato type="encrypted" — stessa tecnica
// (name/label matching) usata da strumenti reali di PII discovery (es. AWS Macie).
db.prepare(`INSERT OR IGNORE INTO assessment_rules (package_slug, rule_key, categoria, descrizione, severity, remediation, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'gdpr', 'pii_field_not_encrypted', 'GDPR — Protezione dati',
  'Un campo il cui nome richiama un dato personale (email, telefono, codice fiscale, indirizzo, IBAN, data di nascita) non è configurato come cifrato',
  'warning',
  'Verifica se il campo contiene davvero un dato personale: se sì, impostalo come cifrato dal Builder (tipo campo "Cifrato"); se il nome è solo simile per caso, ignora questa segnalazione',
  JSON.stringify({
    kind: 'schema_field',
    keywords: ['email', 'telefono', 'cellulare', 'codice_fiscale', 'codicefiscale', 'indirizzo', 'indirizzi', 'iban', 'carta_credito', 'cartadicredito', 'data_nascita', 'datanascita', 'cognome'],
  })
);

// Pacchetto 'usage' (2026-09-03, richiesto dall'utente — "il sistema osserva l'uso e
// consiglia di migliorare il processo X usando un modulo Y o modificando il modulo Z")
// — due regole reali su dati reali (mai un suggerimento a sensazione), stesso principio
// "regole come dati, mai codice" di GDPR sopra. Gli stessi Finding raggiungono le
// Recommendation di un'analisi collegata a questo tenant tramite il meccanismo GIÀ
// esistente (generateRecommendationsFromFindings in super-admin/backend legge TUTTI i
// Finding aperti via GET /assessment/internal/findings sotto, senza filtro per
// pacchetto) — nessun collegamento nuovo da costruire, solo nuove regole.
db.prepare(`INSERT OR IGNORE INTO assessment_rules (package_slug, rule_key, categoria, descrizione, severity, remediation, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'usage', 'campo_testo_strutturato', 'Uso — Campi da strutturare',
  'Un campo di testo libero viene usato in modo ripetuto e strutturato ("etichetta: valore") in molti record — segnale che quei dati meriterebbero un campo dedicato',
  'info',
  'Valuta se aggiungere un campo strutturato dedicato dal Builder al posto del testo libero, così quei dati diventano filtrabili/riportabili invece di solo leggibili',
  JSON.stringify({ kind: 'record_value_pattern', min_matches: 5 })
);
db.prepare(`INSERT OR IGNORE INTO assessment_rules (package_slug, rule_key, categoria, descrizione, severity, remediation, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'usage', 'workflow_bloccato', 'Uso — Processi bloccati',
  'Diversi record sono fermi da tempo in uno stato non finale di un workflow — segnale di un collo di bottiglia nel processo collegato a quel modulo',
  'info',
  'Verifica il processo collegato a questo modulo: valuta un promemoria/automazione su quello stato, o se manca un passaggio (es. un modulo di approvazione/notifica) che lo sblocchi',
  JSON.stringify({ kind: 'workflow_stuck', min_days: 14, min_records: 3 })
);

// Regola GDPR #2 (2026-09-04, richiesto dall'utente: "più regole/controlli coperti")
// — un modulo con almeno un campo che richiama un dato personale (stessa lista
// keyword di pii_field_not_encrypted sopra) ma NESSUN campo che richiami un
// consenso/privacy è un rischio reale distinto dalla cifratura: raccogliere un dato
// personale senza una base giuridica tracciata nello schema stesso (Art. 6/7 GDPR).
// Euristica dichiarata (name/label matching), non verifica legale — stesso principio
// di pii_field_not_encrypted.
db.prepare(`INSERT OR IGNORE INTO assessment_rules (package_slug, rule_key, categoria, descrizione, severity, remediation, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'gdpr', 'consenso_mancante', 'GDPR — Base giuridica',
  'Il modulo raccoglie un dato personale ma non ha alcun campo che tracci un consenso/base giuridica',
  'warning',
  'Valuta se serve un campo "Consenso privacy" (booleano, con data) dal Builder — raccogliere un dato personale senza tracciarne la base giuridica è un rischio GDPR reale, non solo di forma',
  JSON.stringify({
    kind: 'schema_field_missing_pair',
    trigger_keywords: ['email', 'telefono', 'cellulare', 'codice_fiscale', 'codicefiscale', 'indirizzo', 'indirizzi', 'iban', 'carta_credito', 'cartadicredito', 'data_nascita', 'datanascita'],
    required_keywords: ['consenso', 'consensi', 'privacy', 'gdpr', 'opt_in', 'optin'],
  })
);

// Backfill idempotente (2026-09-28, precisione GDPR): le due regole sopra usano
// INSERT OR IGNORE, quindi su un DB già seminato in precedenza le forme plurali
// ("indirizzi"/"consensi") appena aggiunte non arriverebbero mai alle righe
// esistenti — stesso idioma già in uso più sopra (UPDATE incondizionato a ogni
// boot, non una migrazione versionata) per backfillare colonne/valori su righe
// seminate prima di un cambiamento.
db.prepare(`UPDATE assessment_rules SET config_json = ? WHERE package_slug = 'gdpr' AND rule_key = 'pii_field_not_encrypted'`).run(
  JSON.stringify({
    kind: 'schema_field',
    keywords: ['email', 'telefono', 'cellulare', 'codice_fiscale', 'codicefiscale', 'indirizzo', 'indirizzi', 'iban', 'carta_credito', 'cartadicredito', 'data_nascita', 'datanascita', 'cognome'],
  })
);
db.prepare(`UPDATE assessment_rules SET config_json = ? WHERE package_slug = 'gdpr' AND rule_key = 'consenso_mancante'`).run(
  JSON.stringify({
    kind: 'schema_field_missing_pair',
    trigger_keywords: ['email', 'telefono', 'cellulare', 'codice_fiscale', 'codicefiscale', 'indirizzo', 'indirizzi', 'iban', 'carta_credito', 'cartadicredito', 'data_nascita', 'datanascita'],
    required_keywords: ['consenso', 'consensi', 'privacy', 'gdpr', 'opt_in', 'optin'],
  })
);

// Regola Uso #3 (2026-09-04, stesso motivo sopra) — un campo dello schema mai (o quasi
// mai) valorizzato nei record reali è un segnale concreto che il form è più complesso
// del necessario: non un giudizio, una soglia numerica esplicita sulla % di record
// dove il campo è vuoto/nullo, sopra un numero minimo di record (evita falsi positivi
// su moduli appena creati con pochi dati).
db.prepare(`INSERT OR IGNORE INTO assessment_rules (package_slug, rule_key, categoria, descrizione, severity, remediation, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'usage', 'campo_mai_valorizzato', 'Uso — Campi da semplificare',
  'Un campo del modulo risulta vuoto in quasi tutti i record — segnale che potrebbe essere superfluo nel form',
  'info',
  'Valuta se nascondere o rimuovere questo campo dal Builder: se nessuno lo compila, probabilmente complica il form senza portare valore',
  JSON.stringify({ kind: 'record_field_empty_ratio', min_records: 10, empty_ratio_threshold: 0.95 })
);

// API Gateway, secondo pezzo (il primo era il rate limiting) — chiavi per
// consumatori ESTERNI (non il frontend di questo tenant, che continua a
// usare una sessione JWT normale). key_prefix è la parte non segreta (primi
// 12 caratteri della chiave, mostrata anche dopo la creazione per
// riconoscerla in un elenco) usata come indice per la lookup — key_hash
// (bcrypt, sulla chiave INTERA) è l'unico modo per verificarla, mai
// recuperabile in chiaro dopo la creazione, stesso principio di ogni altro
// segreto mostrato una volta sola in questo codebase.
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    revoked_at DATETIME
  );
`);

// Event & Notifier di piattaforma (2026-08-14) — LASCIATE INERTI su Finance
// (2026-09-29): 0 webhook mai configurati, `platform_events` mai letto da
// nessuna route/pagina (solo scritto, nessun consumatore reale). event-bus.js,
// routes/webhooks.js e l'aggancio in automation-engine.js fireTrigger() sono
// stati rimossi per intero — stesso principio "lasciare inerte" già usato per
// le tabelle Partner/licenza. Le tabelle restano solo per non rompere una
// lettura diretta del DB già fatta altrove.
db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["*"]',
    secret_encrypted TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at DATETIME,
    last_status TEXT
  );

  -- Log leggero di OGNI evento emesso (indipendentemente da quanti/se webhook
  -- lo ricevono) — utile per debug ("perché il mio webhook non ha ricevuto
  -- nulla?") e come base minima per un futuro layer di analytics sugli eventi
  -- reali della piattaforma, senza dover ricostruire la cronologia da altre
  -- tabelle. Rotazione implicita: nessuna, stessa scelta già fatta per
  -- audit_log/error_logs in questo codebase (mai cancellati automaticamente).
  CREATE TABLE IF NOT EXISTS platform_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    module_slug TEXT,
    record_id INTEGER,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cronologia/autosave del Sito Web (2026-09-05, "andiamo avanti con Divi" —
  -- Elementor/Divi hanno entrambi una cronologia delle revisioni, qui non
  -- c'era nessun modo di tornare indietro dopo un salvataggio sbagliato).
  -- Uno snapshot di TUTTO blocks_json ad ogni PATCH che lo modifica davvero
  -- (routes/site.js), non un diff — più semplice e a prova di bug di merge,
  -- costo di spazio accettabile perché il numero di revisioni per pagina è
  -- limitato in applicazione (site.js tiene solo le ultime 20, non qui via
  -- trigger SQL: la cancellazione delle vecchie è parte della stessa logica
  -- che decide se salvare una nuova revisione, più facile da testare in JS
  -- che in SQL). Nessuna foreign key verso site_pages: una revisione resta
  -- leggibile anche se la pagina viene cancellata e ricreata con lo stesso
  -- slug (id diverso) — scelta doc, non un dimenticanza.
  CREATE TABLE IF NOT EXISTS site_page_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL,
    blocks_json TEXT NOT NULL,
    title TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_site_page_revisions_page_id ON site_page_revisions(page_id, created_at);
`);

// ─── G10 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22): indici sulle colonne di
// filtro davvero usate nelle query più frequenti (audit fatto leggendo le
// route reali, non a tabellone) — module_slug su records è di gran lunga la
// più calda: ogni pagina modulo filtra per questa colonna.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_records_module_slug ON records(module_slug);
  CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
  CREATE INDEX IF NOT EXISTS idx_record_history_record_id ON record_history(record_id);
  CREATE INDEX IF NOT EXISTS idx_record_history_module_slug ON record_history(module_slug);
  CREATE INDEX IF NOT EXISTS idx_automation_deltas_source ON automation_deltas(source_module, source_record_id);
  CREATE INDEX IF NOT EXISTS idx_automation_logs_module_slug ON automation_logs(module_slug);
  CREATE INDEX IF NOT EXISTS idx_m2m_links_source ON m2m_links(source_module, source_id);
  CREATE INDEX IF NOT EXISTS idx_m2m_links_target ON m2m_links(target_module, target_id);
  CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_module_slug ON dashboard_widgets(module_slug);
  CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON uploads(uploaded_by);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
`);
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_record_attachments_record_id ON record_attachments(record_id);
    CREATE INDEX IF NOT EXISTS idx_record_attachments_module_slug ON record_attachments(module_slug);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  `);
} catch (e) {} // tabelle in try/catch sopra: stessa cautela, potrebbero non esistere su un .db molto vecchio

// ─── G12 (PLATFORM-0.6-GAP-ANALYSIS.md) — indice di ricerca dedicato, sostituisce
// il full-scan + JSON.parse + .includes() di routes/search.js. Tokenizer
// 'trigram' (non il default unicode61) perché il comportamento da preservare è
// un vero substring match parola-per-parola (query "psour" NON deve trovare
// "espresso" solo perché condivide token), esattamente equivalente a
// .includes() — unicode61 tokenizza per parole intere/prefissi, trigram indicizza
// ogni 3 caratteri e trova sottostringhe ovunque, verificato dal vivo prima di
// scegliere. Trigger invece di agganciare i ~25 punti sparsi che scrivono su
// records (records.js, automation-engine.js, gmail-poller.js) — un solo punto,
// zero rischio di dimenticarne uno, il motore di automazioni (codice delicato)
// resta del tutto non toccato. searchtext replica ESATTAMENTE il filtro già
// usato in search.js (Object.values(data), esclusi object/array/null) tramite
// json_each — solo i valori di primo livello, mai ricorsivo, stessa semantica
// di oggi. json_each/FTS5-trigram richiedono SQLite recente (verificato: 3.53
// via better-sqlite3^13, presente da quando G3 ha alzato la versione) — l'intero
// blocco è in try/catch: se il build di SQLite non li supporta, records_fts
// semplicemente non esiste e routes/search.js torna al full-scan di sempre
// (nessuna riga persa, solo niente accelerazione).
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(searchtext, tokenize='trigram');

    CREATE TRIGGER IF NOT EXISTS records_fts_ai AFTER INSERT ON records BEGIN
      INSERT INTO records_fts(rowid, searchtext)
      SELECT new.id, (SELECT group_concat(value, ' ') FROM json_each(new.data) WHERE json_each.type NOT IN ('object', 'array', 'null'));
    END;
    CREATE TRIGGER IF NOT EXISTS records_fts_au AFTER UPDATE ON records BEGIN
      DELETE FROM records_fts WHERE rowid = old.id;
      INSERT INTO records_fts(rowid, searchtext)
      SELECT new.id, (SELECT group_concat(value, ' ') FROM json_each(new.data) WHERE json_each.type NOT IN ('object', 'array', 'null'));
    END;
    CREATE TRIGGER IF NOT EXISTS records_fts_ad AFTER DELETE ON records BEGIN
      DELETE FROM records_fts WHERE rowid = old.id;
    END;
  `);
  // Backfill una tantum: solo se l'indice è vuoto ma records ha già righe (db
  // esistente pre-G12) — su un .db nuovo entrambe le conte sono zero, i
  // trigger sopra bastano da soli da questo momento in poi.
  const ftsCount = db.prepare('SELECT COUNT(*) c FROM records_fts').get().c;
  const recordsCount = db.prepare('SELECT COUNT(*) c FROM records').get().c;
  if (ftsCount === 0 && recordsCount > 0) {
    db.exec(`
      INSERT INTO records_fts(rowid, searchtext)
      SELECT id, (SELECT group_concat(value, ' ') FROM json_each(data) WHERE json_each.type NOT IN ('object', 'array', 'null'))
      FROM records;
    `);
    console.log('records_fts: backfill completato (' + recordsCount + ' record indicizzati)');
  }
} catch (e) {
  console.warn('records_fts non disponibile (FTS5/trigram non supportato da questo build di SQLite) — routes/search.js userà il full-scan:', e.message);
}

module.exports = db;
