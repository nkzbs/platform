// ─── MOTORE AUTOMAZIONI ─────────────────────────────────────────────────────
// Le automazioni vivono ORA dentro lo schema di ogni modulo (block_type 'automation',
// vedi schema-v3.js), non più come lista globale scollegata — coerente con la
// decisione presa in sessione: "ogni modulo ha la propria integrazione e
// automazione", niente voce di menu a sé.
//
// Onestà sullo stato reale (principio guida del progetto, vedi Platform_0.1 §"honesty
// about what is real vs simulated"): il TRIGGER MATCH e la valutazione dei rami
// Se/Altrimenti sono reali — girano su dati veri del record. L'AZIONE finale (mandare
// davvero un messaggio Slack, creare davvero una fattura su Fatture in Cloud, ecc.)
// resta SIMULATA: richiederebbe le credenziali reali del tenant per ogni servizio, che
// qui non esistono. Ogni esecuzione viene comunque loggata in automation_logs con
// esito 'simulato', mai spacciata per una chiamata reale riuscita.

const db = require('./db');
const { getAutomationSteps, parseSchemaNormalized } = require('./schema-v3');
const { attachComputedFields } = require('./computed-fields');
const reportAi = require('./report-ai');

function getModuleSchema(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return null;
  return parseSchemaNormalized(mod.schema_json);
}

// "<anno>/<contatore a 4 cifre>", riparte da 1 ogni anno — condivisa tra resolveDati
// (per record creati da un'altra automazione, es. una fattura generata da un ordine)
// e l'azione aggiorna_record con id_field '__self__' (per record che numerano se
// stessi alla propria creazione, es. il numero ordine assegnato dall'utente via UI).
// Bug reale corretto: prima contava (COUNT) i record con numero già nell'anno
// corrente e assegnava count+1 — se un ordine veniva cancellato (test, annullo,
// ecc.) il conteggio scendeva e il prossimo numero poteva COLLIDERE con uno già
// esistente (es. 0001/0002/0003 esistono, si cancella 0002 -> il prossimo
// riceve di nuovo 0003). Ora cerca il numero PIÙ ALTO già assegnato (MAX) e parte
// da lì — immune alle cancellazioni.
// offset: numero di partenza opzionale (es. per continuare la numerazione di un
// sistema precedente, tipo "ORD-2026-1049" -> offset 1049 -> il prossimo ordine
// nella piattaforma è 1050) — vedi cfg.numero_annuale_offset sull'azione
// aggiorna_record, editabile in Builder.
function computeNumeroAnnuale(targetModuleSlug, offset) {
  const year = new Date().getUTCFullYear();
  let maxN = parseInt(offset, 10) || 0;
  if (targetModuleSlug) {
    try {
      db.prepare('SELECT data FROM records WHERE module_slug = ?').all(targetModuleSlug).forEach((r) => {
        let numero;
        try { numero = JSON.parse(r.data || '{}').numero; } catch { return; }
        if (typeof numero !== 'string' || !numero.startsWith(year + '/')) return;
        const n = parseInt(numero.slice((year + '/').length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      });
    } catch (e) { /* maxN resta all'offset */ }
  }
  return year + '/' + String(maxN + 1).padStart(4, '0');
}

// Calcola i campi computed/soglia di un record appena creato DA UN'AUTOMAZIONE (non
// dalla route POST /:slug, che lo fa già da sé) e scatena 'nuovo_record' su di esso —
// senza questo, un record creato da un'automazione (es. una fattura generata da un
// ordine) non si comportava come un record vero: le sue proprie automazioni (es.
// "posta il movimento contabile alla creazione") non scattavano mai. Il limite di
// profondità è una rete di sicurezza contro configurazioni cicliche (automazione A
// crea un record che scatena un'automazione che ricrea un record di tipo A, ecc.).
let cascadeDepth = 0;
function fireNuovoRecordCascata(moduleSlug, recordId, rawData) {
  if (cascadeDepth >= 20) {
    console.error('automation-engine: profondità massima di cascata automazioni raggiunta, interrotto per sicurezza');
    return;
  }
  const schema = getModuleSchema(moduleSlug);
  if (!schema) return;
  const attached = attachComputedFields(db, { id: recordId, data: rawData }, schema, moduleSlug);
  cascadeDepth++;
  try {
    fireTrigger(moduleSlug, 'nuovo_record', attached.data, recordId, {});
  } finally {
    cascadeDepth--;
  }
}

// Stesso principio di fireNuovoRecordCascata, ma per un record AGGIORNATO da
// un'automazione (aggiorna_record / aggiorna_figli / trova_o_crea_e_aggiorna) — es. il
// pagato_totale di una fattura che, una volta raggiunge il totale, deve poter scatenare
// un'automazione "modifica_campo" che la segna come pagata. Senza questo, solo le
// modifiche fatte dall'utente via API (PUT /:slug/:id) scatenavano modifica_campo/
// cambio_stato — quelle fatte da un'altra automazione restavano invisibili al motore.
function fireModificaCampoCascata(moduleSlug, recordId, campo, rawData) {
  if (cascadeDepth >= 20) {
    console.error('automation-engine: profondità massima di cascata automazioni raggiunta, interrotto per sicurezza');
    return;
  }
  const schema = getModuleSchema(moduleSlug);
  if (!schema) return;
  const attached = attachComputedFields(db, { id: recordId, data: rawData }, schema, moduleSlug);
  cascadeDepth++;
  try {
    // Stesso trattamento speciale che ha il PUT /:slug/:id per lo stato: cambiare
    // _stato scatena 'cambio_stato', non 'modifica_campo' — altrimenti un'automazione
    // che marca una fattura 'pagata' via aggiorna_record(id_field:'__self__', campo:
    // '_stato') non farebbe scattare le automazioni cambio_stato di quel modulo.
    if (campo === '_stato') {
      fireTrigger(moduleSlug, 'cambio_stato', attached.data, recordId, { stato: rawData._stato });
    } else {
      fireTrigger(moduleSlug, 'modifica_campo', attached.data, recordId, { campo });
    }
  } finally {
    cascadeDepth--;
  }
}

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const payload = JSON.stringify(body);
    const opts = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } };
    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// Destinatari WhatsApp attivi iscritti a un dato tag (tabella whatsapp_recipients,
// notification-settings.js). Mai un errore verso il chiamante: nel dubbio, nessun destinatario.
function getDestinatariPerTag(tag) {
  try { return require('./notification-settings').recipientsForTag(tag); } catch (e) { return []; }
}

function getCredentials(integrationId) {
  const row = db.prepare('SELECT credentials FROM connections WHERE integration_id = ?').get(integrationId);
  if (!row || !row.credentials) return null;
  try { return JSON.parse(row.credentials); } catch { return null; }
}

async function callRealAPI(integrationId, azione, config, recordData) {
  const creds = getCredentials(integrationId);
  if (!creds) return { esito: 'simulato', note: 'nessuna credenziale configurata' };

  const interpolate = (tmpl) => {
    if (!tmpl || typeof tmpl !== 'string') return tmpl;
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => recordData && recordData[k] !== undefined ? String(recordData[k]) : '');
  };

  try {
    if (integrationId === 'slack') {
      const webhookUrl = creds.webhook_url;
      if (!webhookUrl) return { esito: 'errore', note: 'webhook_url mancante' };
      const text = interpolate(config) || (azione + ' — record aggiornato');
      const res = await httpPost(webhookUrl, { text });
      return res.status === 200 ? { esito: 'ok' } : { esito: 'errore', note: 'HTTP ' + res.status };
    }

    if (integrationId === 'whatsapp') {
      const { token, phone_id, to } = creds;
      if (!token || !phone_id || !to) return { esito: 'errore', note: 'token/phone_id/to mancanti' };
      const text = interpolate(config) || azione;
      const res = await httpPost(`https://graph.facebook.com/v18.0/${phone_id}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }, { Authorization: 'Bearer ' + token });
      return res.status === 200 ? { esito: 'ok' } : { esito: 'errore', note: 'HTTP ' + res.status + ': ' + res.body.slice(0, 100) };
    }

    if (integrationId === 'mailchimp') {
      const { api_key, list_id } = creds;
      if (!api_key || !list_id) return { esito: 'errore', note: 'api_key e list_id mancanti nelle credenziali' };
      const dc = api_key.split('-').pop();
      const email = interpolate(config);
      if (!email || !email.includes('@')) return { esito: 'errore', note: 'config deve contenere un indirizzo email valido' };
      const res = await httpPost(
        `https://${dc}.api.mailchimp.com/3.0/lists/${list_id}/members`,
        { email_address: email, status: 'subscribed' },
        { Authorization: 'Basic ' + Buffer.from('anystring:' + api_key).toString('base64') }
      );
      return res.status < 300 ? { esito: 'ok' } : { esito: 'errore', note: 'HTTP ' + res.status + ': ' + res.body.slice(0, 100) };
    }

    if (integrationId === 'stripe') {
      const { secret_key } = creds;
      if (!secret_key) return { esito: 'errore', note: 'secret_key mancante nelle credenziali' };
      const amount = azione === 'Crea payment link' && config ? parseInt(interpolate(config)) || 100 : 100;
      const currency = 'eur';
      const name = interpolate(config) || 'Pagamento';
      const body = new URLSearchParams({ currency, unit_amount: String(amount * 100), 'product_data[name]': name, 'payment_method_types[]': 'card' }).toString();
      const res = await new Promise((resolve, reject) => {
        const url = new URL('https://api.stripe.com/v1/payment_links');
        const payload = body;
        const opts = { hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), Authorization: 'Bearer ' + secret_key } };
        const req = require('https').request(opts, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
        req.on('error', reject); req.write(payload); req.end();
      });
      if (res.status < 300) {
        try { const parsed = JSON.parse(res.body); return { esito: 'ok', note: 'link: ' + (parsed.url || '') }; } catch { return { esito: 'ok' }; }
      }
      return { esito: 'errore', note: 'HTTP ' + res.status + ': ' + res.body.slice(0, 100) };
    }

    if (integrationId === 'fatture_in_cloud') {
      return { esito: 'parziale', note: 'FiC: configura il token Bearer nelle credenziali — OAuth2 non automatizzabile server-side' };
    }

    if (integrationId === 'google') {
      return { esito: 'parziale', note: 'Google: usa un service account JSON nelle credenziali per automazioni server-side' };
    }

    return { esito: 'simulato', note: 'integrazione ' + integrationId + ' non ha un handler reale' };
  } catch (e) {
    return { esito: 'errore', note: e.message };
  }
}

const ACTION_LABELS = {
  fatture_in_cloud: 'Fatture in Cloud',
  whatsapp: 'WhatsApp Business',
  slack: 'Slack',
  google: 'Google Workspace',
  stripe: 'Stripe',
  mailchimp: 'Mailchimp',
};

// Riconosce date ISO (YYYY-MM-DD, con eventuale ora/timezone in coda) — es.
// '2026-01-31' vs '2026-08-01'. Va controllato PRIMA della coercizione numerica:
// parseFloat('2026-01-31') restituisce 2026 (si ferma al primo '-'), quindi due date
// dello stesso anno risulterebbero sempre "uguali" numericamente — bug reale che ha
// fatto fallire silenziosamente il primo filtro a data provato in questo motore
// (scansione fatture scadute, Fase 8: 0 record trovati perché ogni confronto '<'
// tra due date del 2026 dava sempre false).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
function compare(a, op, b) {
  const bothDates = typeof a === 'string' && typeof b === 'string' && ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b);
  const na = typeof a === 'number' ? a : parseFloat(a);
  const nb = typeof b === 'number' ? b : parseFloat(b);
  const bothNumeric = !bothDates && !Number.isNaN(na) && !Number.isNaN(nb);
  const x = bothDates ? a : (bothNumeric ? na : a);
  const y = bothDates ? b : (bothNumeric ? nb : b);
  switch (op) {
    case '>': return x > y;
    case '<': return x < y;
    case '>=': return x >= y;
    case '<=': return x <= y;
    case '==': return x === y;
    case '!=': return x !== y;
    default: return false;
  }
}

// Legge un campo di UN record collegato via relazione diretta (many_to_one) del record
// corrente — es. "l'agente di questo ordine" partendo da ordini_righe.ordine. Estratta da
// dentro aggiorna_record (dov'era prima l'unico chiamante, inline) così resolveOperand può
// riusarla — un'unica implementazione, non due copie che potrebbero divergere.
function resolveRelazione(relCampo, moduloRelazionato, campoSorgente, recordData) {
  const relId = recordData && recordData[relCampo];
  if (!relId) return null;
  try {
    const relRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(moduloRelazionato, relId);
    if (relRow) return JSON.parse(relRow.data || '{}')[campoSorgente];
  } catch (e) { /* record collegato non trovato/dato non valido — resta null, non un errore fatale */ }
  return null;
}

// Trova l'id del PRIMO record di un modulo il cui campo vale esattamente `valore` —
// stessa identica logica di ricerca già usata inline da trova_o_crea_e_aggiorna per
// il proprio 'match', estratta qui per essere riusabile anche da trova_relazione_inversa.
function findRecordIdByField(moduloSlug, campo, valore) {
  if (valore == null) return null;
  const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(moduloSlug);
  const match = rows.find((r) => {
    try { return String(JSON.parse(r.data || '{}')[campo]) === String(valore); } catch { return false; }
  });
  return match ? match.id : null;
}

// Risolve il valore di un operando dentro la config di un'azione. Oltre al caso semplice
// (nome di un campo del record corrente, o un letterale), supporta due prefissi componibili:
// - 'relazione:campoRelazione:moduloRelazionato:campoSorgente' — un campo di UN record
//   collegato via relazione diretta (many_to_one) del record corrente.
// - 'trova_relazione_inversa:moduloTarget:campoMatch:operandoInterno' — il percorso
//   OPPOSTO: risolve prima operandoInterno (ricorsivo — può essere a sua volta un
//   'relazione:...', componendo i due), poi cerca in moduloTarget il record il cui
//   campoMatch vale esattamente quel risultato, e restituisce l'ID di quel record. Nato
//   per "trova_o_crea_e_aggiorna" quando il record da aggiornare non è raggiungibile con
//   una relazione diretta ma solo passando per un id intermedio (es. da un ordine, tramite
//   l'agente, risalire AL FURGONE assegnato a quell'agente — furgoni.agente esiste, ma
//   nessuna relazione diretta va da ordini/ordini_righe a furgoni). Senza questo, l'unico
//   modo di risalire da un id a "il record che lo referenzia" sarebbe una nuova azione
//   dedicata per ogni caso — questo invece compone con ciò che già esiste (relazione:,
//   campo:, tutto il resto), un solo meccanismo generico invece di un'eccezione per Nico.
function resolveOperand(operand, recordData) {
  if (operand && typeof operand === 'object' && 'literal' in operand) return operand.literal;
  if (typeof operand !== 'string') return operand;
  if (operand.startsWith('relazione:')) {
    const [, relCampo, moduloRelazionato, campoSorgente] = operand.split(':');
    return resolveRelazione(relCampo, moduloRelazionato, campoSorgente, recordData);
  }
  if (operand.startsWith('trova_relazione_inversa:')) {
    const rest = operand.slice('trova_relazione_inversa:'.length);
    const firstColon = rest.indexOf(':');
    const secondColon = rest.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return null;
    const moduloTarget = rest.slice(0, firstColon);
    const campoMatch = rest.slice(firstColon + 1, secondColon);
    const innerOperand = rest.slice(secondColon + 1);
    const valoreDaCercare = resolveOperand(innerOperand, recordData);
    return findRecordIdByField(moduloTarget, campoMatch, valoreDaCercare);
  }
  if (recordData && operand in recordData) return recordData[operand];
  return operand;
}

// Registra un delta numerico applicato da un'azione increment/decrement, così
// storna_riferimento può invertirlo esattamente in seguito senza ricalcolare nulla.
// Non registriamo i 'set' (non hanno un delta ben definito da invertire).
function logDelta(moduleSlug, recordId, campo, delta, sourceModuleSlug, sourceRecordId) {
  if (!sourceRecordId) return;
  try {
    db.prepare('INSERT INTO automation_deltas (module_slug, record_id, campo, delta, source_module, source_record_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(moduleSlug, recordId, campo, delta, sourceModuleSlug, sourceRecordId);
  } catch (e) { console.error('automation-engine: logDelta fallito:', e.message); }
}

// Data di scadenza pagamento — stesse 8 regole di nicocaffe-standalone
// (routes-fatturazione.js calcolaScadenza): dipende dal tipo_pagamento del cliente,
// sempre relativa a oggi (data di emissione). Non generalizzabile a un token formula
// generico (richiede aritmetica di calendario, non solo aggregazioni), quindi resta
// una funzione JS dedicata invece di provare a esprimerla nella sandbox formula.js.
function calcolaScadenza(oggiISO, tipoPagamento) {
  const base = new Date(oggiISO + 'T00:00:00Z');
  const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
  const lastDayOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  let result;
  switch (tipoPagamento) {
    case 'Ri.Ba.30': result = addDays(base, 30); break;
    case 'Ri.Ba.30FM': result = addDays(lastDayOfMonth(base), 30); break;
    case 'Ri.Ba.60': result = addDays(base, 60); break;
    case 'Ri.Ba.60FM': result = addDays(lastDayOfMonth(base), 60); break;
    default: result = base; // Rimessa diretta, Contanti, Assegno, Bonifico, o non impostato: immediato
  }
  return result.toISOString().slice(0, 10);
}

// Risolve i token nei valori di un oggetto dati per crea_record / crea_record_n_volte /
// crea_record_da_padre. Supporta: 'campo:chiave', '__indice__', '_oggi_', '_ora_',
// 'mese_offset:chiave', più tre token che richiedono un contesto più ampio (opts):
// - 'numero_annuale': "<anno>/<contatore a 4 cifre>", riparte da 1 ogni anno, contando
//   nel modulo di destinazione i record il cui campo 'numero' inizia già con l'anno
//   corrente — a differenza di nico, che usa un contatore globale mai azzerato.
// - '__origine_id__': l'id del record che ha scatenato l'automazione (per collegare
//   il nuovo record al suo padre quando il padre non è il record corrente, es. la
//   riga di un movimento contabile generato da una fattura).
// - 'scadenza_pagamento:campoRelazione': legge il cliente collegato tramite il campo
//   relazione indicato sul record corrente, e calcola la scadenza dal suo tipo_pagamento.
function resolveDati(datiConfig, recordData, indice, opts) {
  const oggi = new Date().toISOString().slice(0, 10);
  const ora = new Date().toISOString().slice(0, 16);
  const o = opts || {};
  const dati = {};
  Object.entries(datiConfig).forEach(([k, v]) => {
    if (typeof v !== 'string') { dati[k] = v; return; }
    if (v === '_oggi_') { dati[k] = oggi; return; }
    if (v === '_ora_') { dati[k] = ora; return; }
    if (v === '__indice__') { dati[k] = indice; return; }
    if (v === '__origine_id__') { dati[k] = o.sourceRecordId; return; }
    if (v === 'anno_corrente') { dati[k] = new Date().getUTCFullYear(); return; }
    if (v === 'mese_corrente') { dati[k] = new Date().getUTCMonth() + 1; return; }
    if (v === 'numero_annuale') {
      dati[k] = computeNumeroAnnuale(o.targetModuleSlug);
      return;
    }
    if (v.startsWith('scadenza_pagamento:')) {
      const relCampo = v.slice('scadenza_pagamento:'.length);
      const clienteId = recordData && recordData[relCampo];
      let tipoPagamento;
      if (clienteId) {
        try {
          const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get('clienti', clienteId);
          if (row) tipoPagamento = JSON.parse(row.data || '{}').tipo_pagamento;
        } catch (e) { /* tipoPagamento resta undefined -> scadenza immediata */ }
      }
      dati[k] = calcolaScadenza(oggi, tipoPagamento);
      return;
    }
    // 'conto:XXXX' — id del record piano_conti col codice indicato. Le automazioni che
    // postano movimenti contabili riferiscono i conti per codice (stabile, leggibile
    // nello schema, coerente con come nico stesso li referenzia in JS), mai per id di
    // riga (che dipende dall'ordine di inserimento e non è noto in fase di configurazione).
    if (v.startsWith('conto:')) {
      const codice = v.slice('conto:'.length);
      try {
        const row = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all('piano_conti')
          .find((r) => { try { return JSON.parse(r.data || '{}').codice === codice; } catch { return false; } });
        dati[k] = row ? row.id : null;
      } catch (e) { dati[k] = null; }
      return;
    }
    if (v.startsWith('campo:')) { dati[k] = recordData && recordData[v.slice(6)]; return; }
    // 'campo_padre:X' — nella clonazione di 'figli' di crea_record_da_padre, recordData
    // è la riga figlia sorgente (es. ordini_acquisto_righe): per leggere un campo del
    // record PADRE che ha scatenato l'automazione (es. il fornitore sull'intestazione
    // ordine_acquisto, assente sulla singola riga) serve questo secondo riferimento.
    if (v.startsWith('campo_padre:')) { dati[k] = o.parentData && o.parentData[v.slice('campo_padre:'.length)]; return; }
    // 'mese_offset:chiave' — aggiunge (indice - 1) mesi alla data del campo indicato
    if (v.startsWith('mese_offset:')) {
      const campoKey = v.slice('mese_offset:'.length);
      const baseDate = recordData && recordData[campoKey];
      if (baseDate && indice != null) {
        try {
          const d = new Date(baseDate);
          d.setUTCMonth(d.getUTCMonth() + (indice - 1));
          dati[k] = d.toISOString().slice(0, 10);
        } catch (e) { dati[k] = baseDate; }
      } else {
        dati[k] = baseDate || null;
      }
      return;
    }
    dati[k] = v;
  });
  return dati;
}

// Invio WhatsApp con esito vero: scrive subito una riga di registro "in invio", poi, a invio
// finito, la aggiorna con l'esito per destinatario (inviato / parziale / FALLITO + motivo).
// Non blocca l'automazione: l'invio gira in coda (vedi whatsapp.js).
function inviaWhatsAppConEsito({ moduleSlug, automationLabel, triggerDesc, recordId, destinatari, testo, apiKey, descBase }) {
  const wa = require('./whatsapp');
  let logId = null;
  try {
    logId = db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(moduleSlug, automationLabel, triggerDesc, descBase, 'in invio', recordId || null).lastInsertRowid;
  } catch (e) { /* il registro non deve fermare l'invio */ }
  wa.sendAll({ destinatari, testo, apiKey }).then((out) => {
    if (logId == null) return;
    db.prepare('UPDATE automation_logs SET esito = ?, action_desc = ? WHERE id = ?').run(out.esito, (descBase + ' — ' + out.dettaglio).slice(0, 400), logId);
  }).catch((e) => {
    console.error('automation-engine: invio WhatsApp fallito:', e.message);
    if (logId != null) db.prepare('UPDATE automation_logs SET esito = ? WHERE id = ?').run('FALLITO', logId);
  });
}

// Esegue (in modo simulato) l'elenco di azioni di un'automazione, seguendo i rami
// Se/Altrimenti quando presenti — annidamento illimitato, questa funzione si richiama
// da sola su ogni ramo then/otherwise. Il limite a un livello che esisteva prima era
// solo nell'editor visivo (vedi App.jsx), non qui: questa funzione era già ricorsiva.
// dryRun/dryLog (in `opts`, default {}) permettono al Builder di "provare" un'automazione
// su un record reale senza scrivere nulla — vedi POST /builder/:slug/automation/dry-run.
// Ogni punto che scrive (record, notifiche, log, WhatsApp reale) è gated da
// `!opts.dryRun`; in dry-run si spinge invece in opts.dryLog la STESSA stringa
// descrittiva che il ramo scriverebbe comunque in automation_logs — nessuna logica di
// descrizione duplicata, quindi nessun rischio che l'anteprima diverga dall'esecuzione
// reale. Le letture (prezzi da listino, destinatari, valori attuali) restano sempre
// reali in entrambi i casi: sono quelle che rendono l'anteprima accurata, e non hanno
// effetti collaterali. fireTrigger e scheduler.js (gli unici due chiamanti reali oggi)
// continuano a chiamare runAzioni senza il 7° parametro — comportamento invariato.
function runAzioni(azioni, recordData, moduleSlug, automationLabel, recordId, logged, opts) {
  const dryRun = !!(opts && opts.dryRun);
  const dryLog = (opts && opts.dryLog) || null;
  (azioni || []).forEach((az) => {
    if (az.kind === 'condition') {
      const a = resolveOperand(az.a, recordData);
      const b = resolveOperand(az.b, recordData);
      const branch = compare(a, az.op, b) ? az.then : az.otherwise;
      runAzioni(branch, recordData, moduleSlug, automationLabel, recordId, logged, opts);
      return;
    }
    // Azione interna (crea_record) — eseguita in modo reale, non simulato
    if (az.target === '__interno__' && az.azione === 'notifica_interna') {
      const interpolate = (tmpl) => {
        if (!tmpl || typeof tmpl !== 'string') return tmpl || '';
        return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => recordData && recordData[k] !== undefined ? String(recordData[k]) : '');
      };
      const msg = interpolate(az.config && typeof az.config === 'string' ? az.config : (az.config && az.config.message) || 'Automazione eseguita');
      // roles/category opzionali: solo se az.config è un oggetto (mai su un config
      // stringa legacy) — [] = visibile a tutti come sempre, invariato per ogni
      // automazione già esistente che non li imposta.
      const cfgObj = (az.config && typeof az.config === 'object') ? az.config : {};
      const notifRoles = Array.isArray(cfgObj.roles) ? cfgObj.roles : [];
      const notifCategory = cfgObj.category ? interpolate(cfgObj.category) : null;
      try {
        if (dryRun) { dryLog.push({ desc: 'notifica_interna: ' + msg.slice(0, 60) }); return; }
        db.prepare('INSERT INTO notifications (message, module_slug, record_id, roles, category) VALUES (?, ?, ?, ?, ?)').run(msg, moduleSlug, recordId || null, JSON.stringify(notifRoles), notifCategory);
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'notifica_interna: ' + msg.slice(0, 60), 'eseguito', recordId || null);
      } catch (e) { console.error('automation-engine: notifica_interna fallita:', e.message); }
      return;
    }

    // invia_notifica: invia un messaggio WhatsApp via CallMeBot a tutti i destinatari
    // (modulo 'whatsapp_destinatari') sottoscritti a cfg.trigger_tag. Azione generica
    // disponibile in QUALSIASI modulo — non hardcoded su spese/rate come in hearth.
    // config: { trigger_tag, messaggio } — messaggio supporta {{campo}} come le altre
    // azioni (stessa regex di notifica_interna/callRealAPI, non una terza copia).
    // Se aggiungi qui una nuova azione "interna" che in realtà chiama un servizio
    // esterno, dichiarala anche in INTERNAL_ACTIONS (core/shared/schema-v3-core.js,
    // campo connector_id) — è l'unico punto da cui il Builder sa di doverla
    // disattivare finché il connettore non è collegato, e da cui getRequiredConnectors
    // rileva automaticamente i moduli che la usano.
    if (az.target === '__interno__' && az.azione === 'invia_notifica') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      const interpolate = (tmpl) => {
        if (!tmpl || typeof tmpl !== 'string') return tmpl || '';
        return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => recordData && recordData[k] !== undefined ? String(recordData[k]) : '');
      };
      const testo = interpolate(cfg.messaggio) || automationLabel;
      // Con il riepilogo del mattino acceso, gli avvisi "scadenza" per singola riga non partono più:
      // arrivano tutti insieme nel riepilogo (un messaggio al giorno invece di uno per riga).
      if (cfg.trigger_tag === require('./daily-digest').TAG && require('./daily-digest').isEnabled()) {
        if (dryRun) { dryLog.push({ desc: 'invia_notifica [' + cfg.trigger_tag + ']: sostituita dal riepilogo del mattino' }); return; }
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'invia_notifica [' + cfg.trigger_tag + ']: ' + testo.slice(0, 60), 'sostituita dal riepilogo', recordId || null);
        return;
      }
      const creds = getCredentials('whatsapp_callmebot');
      if (!creds || !creds.api_key) {
        if (dryRun) { dryLog.push({ desc: 'invia_notifica [' + (cfg.trigger_tag || '') + ']: ' + testo.slice(0, 60) + ' (nessuna credenziale WhatsApp collegata, sarebbe simulato anche in esecuzione reale)' }); return; }
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'invia_notifica [' + (cfg.trigger_tag || '') + ']: ' + testo.slice(0, 60), 'simulato', recordId || null);
        return;
      }
      const destinatari = getDestinatariPerTag(cfg.trigger_tag);
      if (dryRun) { dryLog.push({ desc: 'invia_notifica [' + (cfg.trigger_tag || '') + '] → ' + destinatari.length + ' destinatari (WhatsApp reale NON inviato in anteprima): ' + testo.slice(0, 60) }); return; }
      inviaWhatsAppConEsito({ moduleSlug, automationLabel, triggerDesc: logged.triggerDesc, recordId, destinatari, testo, apiKey: creds.api_key, descBase: 'invia_notifica [' + (cfg.trigger_tag || '') + '] → ' + destinatari.length + ' destinatari: ' + testo.slice(0, 60) });
      return;
    }

    // invia_report_periodico: riepilogo via WhatsApp (CallMeBot) dei record di
    // QUESTO modulo in una finestra temporale — pensata per un'automazione
    // schedulata SENZA modalita 'per_record' (gira una volta sola, non per ogni
    // record: vedi eseguiAutomazioneSchedulata in scheduler.js), non per un
    // trigger su record singolo. Azione generica: funziona su qualunque modulo
    // con un campo importo e un campo data testuale 'YYYY-MM-DD', non hardcoded
    // sulle spese — stesso principio di invia_notifica.
    // config: { periodo: 'settimana'|'mese' (default settimana — ultimi 7 giorni;
    // 'mese' = mese solare precedente, utile per un report che gira il 1° del
    // mese), campo_importo (default 'importo'), campo_data (default 'data'),
    // trigger_tag, titolo, raggruppa_per (opzionale, es. 'categoria' — top 5 per
    // totale nel messaggio, con conteggio delle rimanenti se troncato).
    // Il messaggio include anche l'intervallo di date coperto e il confronto col
    // periodo equivalente immediatamente precedente (stessa lunghezza) — un
    // totale isolato dice poco, sapere se si sta spendendo di più o di meno è
    // l'informazione che rende un report utile invece che un numero e basta.
    // Se non ci sono voci nel periodo, il messaggio NON parte affatto (solo
    // loggato) — un report vuoto ogni settimana è rumore, non informazione,
    // specialmente per chi già trova troppe notifiche via mail/WhatsApp.
    if (az.target === '__interno__' && az.azione === 'invia_report_periodico') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      const campoImporto = cfg.campo_importo || 'importo';
      const campoData = cfg.campo_data || 'data';
      const now = new Date();
      let daStr, aStr, prevDaStr, prevAStr;
      if (cfg.periodo === 'mese') {
        daStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
        aStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
        prevDaStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
        prevAStr = daStr;
      } else {
        daStr = new Date(now.getTime() - 7 * 86400 * 1000).toISOString().slice(0, 10);
        aStr = now.toISOString().slice(0, 10);
        prevDaStr = new Date(now.getTime() - 14 * 86400 * 1000).toISOString().slice(0, 10);
        prevAStr = daStr;
      }
      const formatGg = (s) => { const [, m, d] = s.split('-'); return d + '/' + m; };
      const righe = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(moduleSlug)
        .map((r) => { try { return JSON.parse(r.data || '{}'); } catch { return null; } })
        .filter((d) => d && typeof d[campoData] === 'string');
      const inRange = righe.filter((d) => d[campoData] >= daStr && d[campoData] < aStr);
      const inRangePrec = righe.filter((d) => d[campoData] >= prevDaStr && d[campoData] < prevAStr);
      const totale = inRange.reduce((sum, d) => sum + (parseFloat(d[campoImporto]) || 0), 0);
      const totalePrec = inRangePrec.reduce((sum, d) => sum + (parseFloat(d[campoImporto]) || 0), 0);

      if (inRange.length === 0) {
        if (dryRun) { dryLog.push({ desc: 'invia_report_periodico [' + (cfg.trigger_tag || '') + ']: nessuna voce dal ' + formatGg(daStr) + ' al ' + formatGg(aStr) + ' — messaggio non inviato' }); return; }
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'invia_report_periodico [' + (cfg.trigger_tag || '') + ']: nessuna voce dal ' + formatGg(daStr) + ' al ' + formatGg(aStr) + ' — messaggio non inviato', 'saltato_vuoto', recordId || null);
        return;
      }

      const dataFinaleInclusa = new Date(new Date(aStr).getTime() - 86400 * 1000).toISOString().slice(0, 10);
      let testo = (cfg.titolo || automationLabel)
        + '\n📅 ' + formatGg(daStr) + ' – ' + formatGg(dataFinaleInclusa)
        + '\n' + inRange.length + ' voci, totale €' + totale.toFixed(2);
      if (totalePrec > 0) {
        const deltaPct = Math.round(((totale - totalePrec) / totalePrec) * 100);
        testo += '\n' + (deltaPct >= 0 ? '📈 +' : '📉 ') + deltaPct + '% vs periodo precedente (€' + totalePrec.toFixed(2) + ')';
      }
      if (cfg.raggruppa_per) {
        const perGruppo = {};
        inRange.forEach((d) => {
          const k = d[cfg.raggruppa_per] || 'Altro';
          perGruppo[k] = (perGruppo[k] || 0) + (parseFloat(d[campoImporto]) || 0);
        });
        const ordinati = Object.entries(perGruppo).sort((a, b) => b[1] - a[1]);
        const righeGruppo = ordinati.slice(0, 5).map(([k, v]) => '• ' + k + ': €' + v.toFixed(2));
        if (righeGruppo.length) testo += '\n' + righeGruppo.join('\n');
        if (ordinati.length > 5) testo += '\n+' + (ordinati.length - 5) + ' altre categorie';
      }
      const creds = getCredentials('whatsapp_callmebot');
      if (!creds || !creds.api_key) {
        if (dryRun) { dryLog.push({ desc: 'invia_report_periodico [' + (cfg.trigger_tag || '') + ']: ' + testo.replace(/\n/g, ' | ').slice(0, 100) + ' (nessuna credenziale WhatsApp collegata, sarebbe simulato anche in esecuzione reale)' }); return; }
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'invia_report_periodico [' + (cfg.trigger_tag || '') + ']: ' + testo.replace(/\n/g, ' | ').slice(0, 100), 'simulato', recordId || null);
        return;
      }
      const destinatari = getDestinatariPerTag(cfg.trigger_tag);
      if (dryRun) { dryLog.push({ desc: 'invia_report_periodico [' + (cfg.trigger_tag || '') + '] → ' + destinatari.length + ' destinatari (WhatsApp reale NON inviato in anteprima): ' + testo.replace(/\n/g, ' | ').slice(0, 100) }); return; }
      const invia = (testoFinale) => inviaWhatsAppConEsito({ moduleSlug, automationLabel, triggerDesc: logged.triggerDesc, recordId, destinatari, testo: testoFinale, apiKey: creds.api_key, descBase: 'invia_report_periodico [' + (cfg.trigger_tag || '') + '] → ' + destinatari.length + ' destinatari: ' + testoFinale.replace(/\n/g, ' | ').slice(0, 100) });
      // Report mensile per categoria: con l'assistente acceso si aggiunge una frase di commento.
      // Se l'AI non risponde o sbaglia un numero, il report parte comunque, senza commento.
      if (cfg.periodo === 'mese' && cfg.raggruppa_per && reportAi.isEnabled() && destinatari.length) {
        const nomeMese = new Date(daStr + 'T00:00:00Z').toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        reportAi.explain('commento', {
          titolo: cfg.titolo || automationLabel, periodo: nomeMese, metrica: campoImporto, funzione: 'sum', totale, totale_confronto: totalePrec > 0 ? totalePrec : undefined,
          gruppi: reportAi.gruppiDaRighe(inRange, inRangePrec, cfg.raggruppa_per, campoImporto),
        }).then((c) => invia(c.text ? testo + '\n\n💬 ' + c.text : testo)).catch(() => invia(testo));
      } else {
        invia(testo);
      }
      return;
    }

    // aggiorna_record: aggiorna un campo di un record in un modulo, identificato
    // per ID diretto o per valore di un campo del record corrente.
    // config: { modulo, id_field, campo, operazione: 'set'|'increment'|'decrement', valore }
    // id_field: nome del campo nel record CORRENTE che contiene l'ID del record da
    // aggiornare, oppure '__self__' per puntare al record corrente stesso (es. per
    // marcare una fattura 'pagata' via automazione, senza un campo relazione che
    // punti a se stessi).
    // valore: literal, o nome di campo del record corrente (es 'quantita') — per
    // 'increment'/'decrement' dev'essere numerico; per 'set' può essere qualunque
    // valore (stringa/bool/numero), es. per impostare _stato. Supporta anche
    // 'relazione:campoRelazione:moduloRelazionato:campoSorgente' per leggere un campo
    // di un record collegato via many_to_one (es. copiare l'agente dell'ordine sul
    // pagamento collegato) — la sandbox formula.js non ha un modo di farlo (solo
    // aggregazioni sui figli), quindi qui si fa con una query diretta.
    if (az.target === '__interno__' && az.azione === 'aggiorna_record') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo && cfg.id_field && cfg.campo) {
        const targetId = cfg.id_field === '__self__' ? recordId : (recordData && recordData[cfg.id_field]);
        const rawVal = cfg.valore !== undefined ? cfg.valore : 0;
        let resolvedVal;
        if (rawVal === 'numero_annuale') {
          resolvedVal = computeNumeroAnnuale(cfg.modulo, cfg.numero_annuale_offset);
        } else if (rawVal === '_oggi_') {
          resolvedVal = new Date().toISOString().slice(0, 10);
        } else if (rawVal === '_ora_') {
          resolvedVal = new Date().toISOString().slice(0, 16);
        } else if (typeof rawVal === 'string' && rawVal.startsWith('relazione:')) {
          const [, relCampo, moduloRelazionato, campoSorgente] = rawVal.split(':');
          resolvedVal = resolveRelazione(relCampo, moduloRelazionato, campoSorgente, recordData);
        } else {
          resolvedVal = typeof rawVal === 'string' && recordData && rawVal in recordData ? recordData[rawVal] : rawVal;
        }
        const delta = parseFloat(resolvedVal) || 0;
        if (targetId) {
          try {
            const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(cfg.modulo, targetId);
            if (row) {
              const data = JSON.parse(row.data || '{}');
              const oldValue = data[cfg.campo];
              // rawVal === 'numero_annuale'/'_oggi_'/'_ora_' assegnati sempre così come sono:
              // parseFloat('2026/0001') o parseFloat('2026-08-03') restituirebbero comunque
              // 2026 (JS legge solo il prefisso numerico), quindi vanno esclusi esplicitamente
              // dal ramo aritmetico sotto, non basta il solo isNaN.
              const sempreLetterale = ['numero_annuale', '_oggi_', '_ora_'].includes(rawVal);
              if (cfg.operazione === 'set' && (sempreLetterale || (typeof resolvedVal !== 'number' && isNaN(parseFloat(resolvedVal))))) {
                // Valore non numerico (stringa/bool, es. _stato) — assegnato così com'è,
                // niente aritmetica/arrotondamento.
                data[cfg.campo] = resolvedVal;
              } else {
                const current = parseFloat(data[cfg.campo]) || 0;
                let newVal;
                if (cfg.operazione === 'increment') newVal = current + delta;
                else if (cfg.operazione === 'decrement') newVal = current - delta;
                else newVal = delta;
                data[cfg.campo] = Math.round(newVal * 1000) / 1000;
              }
              const desc = 'aggiorna_record ' + cfg.modulo + '#' + targetId + ' ' + cfg.campo + ' ' + cfg.operazione + ' ' + delta;
              if (dryRun) { dryLog.push({ desc, modulo: cfg.modulo, campo: cfg.campo, da: oldValue, a: data[cfg.campo] }); return; }
              db.prepare('UPDATE records SET data = ? WHERE module_slug = ? AND id = ?').run(JSON.stringify(data), cfg.modulo, targetId);
              if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
                logDelta(cfg.modulo, targetId, cfg.campo, cfg.operazione === 'decrement' ? -delta : delta, moduleSlug, recordId);
              }
              fireModificaCampoCascata(cfg.modulo, targetId, cfg.campo, data);
              db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, desc, 'eseguito', recordId || null);
            }
          } catch (e) { console.error('automation-engine: aggiorna_record fallito:', e.message); }
        }
      }
      return;
    }

    // applica_prezzo_listino: quando si aggiunge una riga prodotto a un documento
    // (es. ordini_righe), cerca il prezzo/sconto PERSONALIZZATO per quel cliente+
    // prodotto nel listino assegnato al cliente — non uno sconto flat sul totale
    // del documento, uno sconto per singolo prodotto (richiesta esplicita: "listino
    // prezzi personalizzato con scontistica su ogni prodotto singolo, non sul
    // totale"). Percorso: record corrente -[campo_padre]-> documento padre (es.
    // ordine) -[campo_cliente]-> cliente -[campo_listino]-> listino -> cerca in
    // modulo_listino_righe la riga con lo stesso listino e lo stesso prodotto di
    // questo record. Se trovata: copia il suo prezzo/sconto su questo record. Se
    // NON trovata (cliente senza listino, o prodotto non presente in quel
    // listino): usa il prezzo di listino generale del prodotto, sconto 0 — non
    // lascia mai il prezzo a zero in silenzio.
    // config: { modulo_padre, campo_padre, campo_cliente, campo_listino,
    // modulo_listino_righe, campo_prodotto, modulo_prodotti, campo_prezzo_base,
    // campo_prezzo_target, campo_sconto_target }. Sovrascrive solo se il campo
    // prezzo target è ancora vuoto — non tocca una riga già prezzata a mano.
    if (az.target === '__interno__' && az.azione === 'applica_prezzo_listino') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      const campoPrezzoTarget = cfg.campo_prezzo_target || 'prezzo_unitario';
      const campoScontoTarget = cfg.campo_sconto_target || 'sconto_percentuale';
      const giaPrezzato = recordData && recordData[campoPrezzoTarget] !== undefined && recordData[campoPrezzoTarget] !== null && recordData[campoPrezzoTarget] !== '';
      if (!giaPrezzato && cfg.modulo_padre && cfg.campo_padre && cfg.campo_prodotto) {
        try {
          const prodottoId = recordData && recordData[cfg.campo_prodotto];
          const padreId = recordData && recordData[cfg.campo_padre];
          let prezzo = null, sconto = 0, fonte = 'nessuna';
          if (padreId) {
            const padreRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(cfg.modulo_padre, padreId);
            const padreData = padreRow ? JSON.parse(padreRow.data || '{}') : null;
            const clienteId = padreData && cfg.campo_cliente ? padreData[cfg.campo_cliente] : null;
            if (clienteId) {
              const clienteRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get('clienti', clienteId);
              const clienteData = clienteRow ? JSON.parse(clienteRow.data || '{}') : null;
              const listinoId = clienteData && cfg.campo_listino ? clienteData[cfg.campo_listino] : null;
              if (listinoId && prodottoId && cfg.modulo_listino_righe) {
                const righe = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(cfg.modulo_listino_righe);
                const riga = righe.map((r) => { try { return JSON.parse(r.data || '{}'); } catch { return null; } })
                  .find((d) => d && String(d.listino) === String(listinoId) && String(d.prodotto) === String(prodottoId) && d.attivo !== false);
                if (riga) { prezzo = riga.prezzo; sconto = riga.sconto_percentuale || 0; fonte = 'listino cliente'; }
              }
            }
          }
          if (prezzo === null && prodottoId && cfg.modulo_prodotti) {
            const prodRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(cfg.modulo_prodotti, prodottoId);
            const prodData = prodRow ? JSON.parse(prodRow.data || '{}') : null;
            if (prodData && cfg.campo_prezzo_base) { prezzo = prodData[cfg.campo_prezzo_base]; fonte = 'prezzo base prodotto'; }
          }
          const desc = 'applica_prezzo_listino: ' + fonte + (prezzo !== null ? ' (€' + prezzo + ', sconto ' + sconto + '%)' : ' — nessun prezzo trovato');
          if (dryRun) { dryLog.push({ desc }); return; }
          if (prezzo !== null && recordId) {
            const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(moduleSlug, recordId);
            if (row) {
              const data = JSON.parse(row.data || '{}');
              data[campoPrezzoTarget] = prezzo;
              data[campoScontoTarget] = sconto;
              db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(data), recordId);
            }
          }
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(moduleSlug, automationLabel, logged.triggerDesc, desc, prezzo !== null ? 'eseguito' : 'errore', recordId || null);
        } catch (e) { console.error('automation-engine: applica_prezzo_listino fallito:', e.message); }
      }
      return;
    }

    // aggiorna_figli: per ogni record figlio (es. ordini_righe) collegato al record
    // corrente, aggiorna un campo di un record correlato (es. decrementa stock prodotto).
    // config: { figlio_modulo, via_relazione, rel_campo, target_modulo, target_campo, operazione, quantita_campo }
    if (az.target === '__interno__' && az.azione === 'aggiorna_figli') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.figlio_modulo && cfg.via_relazione && cfg.rel_campo && cfg.target_modulo && cfg.target_campo) {
        try {
          const figli = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(cfg.figlio_modulo)
            .filter((r) => { try { return JSON.parse(r.data || '{}')[cfg.via_relazione] == recordId; } catch { return false; } });
          const upd = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?');
          const set = db.prepare('UPDATE records SET data = ? WHERE module_slug = ? AND id = ?');
          const righeDryRun = [];
          figli.forEach((f) => {
            const fData = JSON.parse(f.data || '{}');
            const targetId = fData[cfg.rel_campo];
            const qty = parseFloat(fData[cfg.quantita_campo || 'quantita']) || 0;
            if (!targetId) return;
            const tRow = upd.get(cfg.target_modulo, targetId);
            if (!tRow) return;
            const tData = JSON.parse(tRow.data || '{}');
            const cur = parseFloat(tData[cfg.target_campo]) || 0;
            let nv;
            if (cfg.operazione === 'decrement') nv = cur - qty;
            else if (cfg.operazione === 'increment') nv = cur + qty;
            else nv = qty;
            tData[cfg.target_campo] = Math.round(nv * 1000) / 1000;
            if (dryRun) { righeDryRun.push(cfg.target_modulo + '#' + targetId + ' ' + cfg.target_campo + ': ' + cur + ' → ' + tData[cfg.target_campo]); return; }
            set.run(JSON.stringify(tData), cfg.target_modulo, targetId);
            if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
              logDelta(cfg.target_modulo, targetId, cfg.target_campo, cfg.operazione === 'decrement' ? -qty : qty, moduleSlug, recordId);
            }
            fireModificaCampoCascata(cfg.target_modulo, targetId, cfg.target_campo, tData);
          });
          if (dryRun) { dryLog.push({ desc: 'aggiorna_figli ' + cfg.figlio_modulo + ' → ' + cfg.target_modulo + '.' + cfg.target_campo + ' ' + cfg.operazione + (righeDryRun.length ? ': ' + righeDryRun.join('; ') : ' — nessun figlio collegato') }); return; }
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'aggiorna_figli ' + cfg.figlio_modulo + ' → ' + cfg.target_modulo + '.' + cfg.target_campo + ' ' + cfg.operazione, 'eseguito', recordId || null);
        } catch (e) { console.error('automation-engine: aggiorna_figli fallito:', e.message); }
      }
      return;
    }

    // aggiorna_figli_via_router: come aggiorna_figli, ma prima cerca un record
    // "router" collegato lateralmente (stesso valore in un campo condiviso, non una
    // relazione diretta) — se lo trova, instrada l'aggiornamento verso un modulo
    // alternativo (trova-o-crea, come trova_o_crea_e_aggiorna) invece del target
    // di fallback. Serve per "decrementa lo stock del furgone dell'agente se ne ha
    // uno assegnato, altrimenti il magazzino centrale" — un caso che aggiorna_figli
    // da solo non può esprimere (nessuna relazione diretta ordine→furgone, solo un
    // agente in comune) e che la sandbox formula.js non può leggere (nessun modo di
    // ottenere "il campo di un record trovato per corrispondenza", solo per relazione
    // diretta o aggregazione sui figli).
    // config: { figlio_modulo, via_relazione, rel_campo, quantita_campo,
    //   router_campo_corrente, router_modulo, router_campo_match,
    //   modulo_alternativo, router_campo_riferimento, campo_alternativo_match, target_campo_alternativo,
    //   target_modulo, target_campo, operazione }
    if (az.target === '__interno__' && az.azione === 'aggiorna_figli_via_router') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.figlio_modulo && cfg.via_relazione && cfg.rel_campo && cfg.router_campo_corrente && cfg.router_modulo && cfg.router_campo_match
          && cfg.modulo_alternativo && cfg.router_campo_riferimento && cfg.campo_alternativo_match && cfg.target_campo_alternativo
          && cfg.target_modulo && cfg.target_campo) {
        try {
          const routerValore = recordData && recordData[cfg.router_campo_corrente];
          let routerRecord = null;
          if (routerValore) {
            routerRecord = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(cfg.router_modulo)
              .find((r) => { try { return JSON.parse(r.data || '{}')[cfg.router_campo_match] == routerValore; } catch { return false; } }) || null;
          }

          const figli = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(cfg.figlio_modulo)
            .filter((r) => { try { return JSON.parse(r.data || '{}')[cfg.via_relazione] == recordId; } catch { return false; } });

          const righeDryRun = [];
          figli.forEach((f) => {
            const fData = JSON.parse(f.data || '{}');
            const relId = fData[cfg.rel_campo];
            const qty = parseFloat(fData[cfg.quantita_campo || 'quantita']) || 0;
            if (!relId) return;
            const applyDelta = (cur) => cfg.operazione === 'decrement' ? cur - qty : cfg.operazione === 'increment' ? cur + qty : qty;

            if (routerRecord) {
              const matchValues = { [cfg.router_campo_riferimento]: routerRecord.id, [cfg.campo_alternativo_match]: relId };
              const candidates = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(cfg.modulo_alternativo);
              const match = candidates.find((r) => {
                try { const d = JSON.parse(r.data || '{}'); return Object.entries(matchValues).every(([k, v]) => String(d[k]) === String(v)); } catch { return false; }
              });
              let targetId, tData;
              if (match) {
                const data = JSON.parse(match.data || '{}');
                const cur = parseFloat(data[cfg.target_campo_alternativo]) || 0;
                data[cfg.target_campo_alternativo] = Math.round(applyDelta(cur) * 1000) / 1000;
                if (dryRun) { righeDryRun.push(cfg.modulo_alternativo + '#' + match.id + ' ' + cfg.target_campo_alternativo + ': ' + cur + ' → ' + data[cfg.target_campo_alternativo]); return; }
                db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(data), match.id);
                targetId = match.id; tData = data;
              } else {
                const data = { ...matchValues, [cfg.target_campo_alternativo]: Math.round(applyDelta(0) * 1000) / 1000 };
                if (dryRun) { righeDryRun.push('nuovo record in ' + cfg.modulo_alternativo + ' con ' + cfg.target_campo_alternativo + ': ' + data[cfg.target_campo_alternativo]); return; }
                const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo_alternativo, null, JSON.stringify(data));
                targetId = result.lastInsertRowid; tData = data;
                fireNuovoRecordCascata(cfg.modulo_alternativo, targetId, data);
              }
              if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
                logDelta(cfg.modulo_alternativo, targetId, cfg.target_campo_alternativo, cfg.operazione === 'decrement' ? -qty : qty, moduleSlug, recordId);
              }
              fireModificaCampoCascata(cfg.modulo_alternativo, targetId, cfg.target_campo_alternativo, tData);
            } else {
              const tRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(cfg.target_modulo, relId);
              if (!tRow) return;
              const tData = JSON.parse(tRow.data || '{}');
              const cur = parseFloat(tData[cfg.target_campo]) || 0;
              tData[cfg.target_campo] = Math.round(applyDelta(cur) * 1000) / 1000;
              if (dryRun) { righeDryRun.push(cfg.target_modulo + '#' + relId + ' ' + cfg.target_campo + ': ' + cur + ' → ' + tData[cfg.target_campo]); return; }
              db.prepare('UPDATE records SET data = ? WHERE module_slug = ? AND id = ?').run(JSON.stringify(tData), cfg.target_modulo, relId);
              if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
                logDelta(cfg.target_modulo, relId, cfg.target_campo, cfg.operazione === 'decrement' ? -qty : qty, moduleSlug, recordId);
              }
              fireModificaCampoCascata(cfg.target_modulo, relId, cfg.target_campo, tData);
            }
          });

          const descRouter = 'aggiorna_figli_via_router ' + (routerRecord ? 'via ' + cfg.router_modulo + '#' + routerRecord.id + ' → ' + cfg.modulo_alternativo : 'fallback → ' + cfg.target_modulo + '.' + cfg.target_campo);
          if (dryRun) { dryLog.push({ desc: descRouter + (righeDryRun.length ? ': ' + righeDryRun.join('; ') : ' — nessun figlio collegato') }); return; }
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(
            moduleSlug, automationLabel, logged.triggerDesc, descRouter, 'eseguito', recordId || null);
        } catch (e) { console.error('automation-engine: aggiorna_figli_via_router fallito:', e.message); }
      }
      return;
    }

    // libera_altri_con_stesso_valore: per ogni ALTRO record dello stesso modulo che ha
    // lo stesso valore del record corrente in un campo, azzera un (altro) campo su
    // quei record. Serve per vincoli "assegnazione esclusiva" senza un vero UNIQUE a
    // livello di record — es. "un agente ha un solo furgone": quando un furgone viene
    // assegnato a un agente, libera qualunque ALTRO furgone che quell'agente aveva già
    // (stesso comportamento "ruba assegnazione" di nico su PUT /furgoni/:id/agente).
    // config: { modulo, campo_confronto, campo_da_liberare, valore_liberato? }
    if (az.target === '__interno__' && az.azione === 'libera_altri_con_stesso_valore') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo && cfg.campo_confronto && cfg.campo_da_liberare) {
        try {
          const valoreCorrente = recordData && recordData[cfg.campo_confronto];
          if (valoreCorrente !== undefined && valoreCorrente !== null && valoreCorrente !== '') {
            const altri = db.prepare('SELECT id, data FROM records WHERE module_slug = ? AND id != ?').all(cfg.modulo, recordId)
              .filter((r) => { try { return JSON.parse(r.data || '{}')[cfg.campo_confronto] == valoreCorrente; } catch { return false; } });
            if (dryRun) {
              if (altri.length > 0) dryLog.push({ desc: 'libera_altri_con_stesso_valore: ' + altri.length + ' record in ' + cfg.modulo + ' liberati (id: ' + altri.map((r) => r.id).join(', ') + ')' });
              return;
            }
            const upd = db.prepare('UPDATE records SET data = ? WHERE id = ?');
            altri.forEach((r) => {
              const d = JSON.parse(r.data || '{}');
              d[cfg.campo_da_liberare] = cfg.valore_liberato !== undefined ? cfg.valore_liberato : null;
              upd.run(JSON.stringify(d), r.id);
              fireModificaCampoCascata(cfg.modulo, r.id, cfg.campo_da_liberare, d);
            });
            if (altri.length > 0) {
              db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(
                moduleSlug, automationLabel, logged.triggerDesc, 'libera_altri_con_stesso_valore: ' + altri.length + ' record in ' + cfg.modulo + ' liberati', 'eseguito', recordId || null);
            }
          }
        } catch (e) { console.error('automation-engine: libera_altri_con_stesso_valore fallito:', e.message); }
      }
      return;
    }

    // trova_o_crea_e_aggiorna: come aggiorna_record, ma se non esiste ancora nessun
    // record che soddisfi 'match' lo crea al volo prima di applicare l'incremento.
    // Serve per contatori per-combinazione che non esistono finché non servono la
    // prima volta (es. giacenza di un prodotto in un furgone specifico: la riga
    // furgone×prodotto non esiste finché quel furgone non riceve quel prodotto).
    // config: { modulo, match: { campoTarget: campoRecordCorrente, ... }, campo, operazione, valore }
    if (az.target === '__interno__' && az.azione === 'trova_o_crea_e_aggiorna') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo && cfg.match && cfg.campo) {
        try {
          const matchValues = {};
          Object.entries(cfg.match).forEach(([targetField, sourceField]) => {
            matchValues[targetField] = resolveOperand(sourceField, recordData);
          });
          // Un valore di match non risolto (es. 'trova_relazione_inversa' che non trova
          // nulla — un ordine il cui agente non ha ancora un furgone assegnato) non deve
          // MAI produrre un nuovo record con quel campo a null: sarebbe una riga fantasma,
          // indistinguibile da un vero match futuro con lo stesso valore mancante. Meglio
          // saltare l'azione e lasciare traccia nel log, che scrivere un dato sbagliato.
          const matchIncompleto = Object.entries(matchValues).find(([, v]) => v == null);
          if (matchIncompleto) {
            const desc = 'trova_o_crea_e_aggiorna saltato: "' + matchIncompleto[0] + '" non risolto per ' + cfg.modulo;
            if (dryRun) { dryLog.push({ desc }); return; }
            db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(
              moduleSlug, automationLabel, logged.triggerDesc, desc, 'saltato_match_incompleto', recordId || null);
            return;
          }
          const rawVal = cfg.valore !== undefined ? cfg.valore : 0;
          const delta = typeof rawVal === 'string' && recordData && rawVal in recordData
            ? parseFloat(recordData[rawVal]) || 0
            : parseFloat(rawVal) || 0;

          const candidates = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(cfg.modulo);
          const match = candidates.find((r) => {
            try {
              const d = JSON.parse(r.data || '{}');
              return Object.entries(matchValues).every(([k, v]) => String(d[k]) === String(v));
            } catch { return false; }
          });

          let targetId;
          if (match) {
            const data = JSON.parse(match.data || '{}');
            const current = parseFloat(data[cfg.campo]) || 0;
            let newVal;
            if (cfg.operazione === 'increment') newVal = current + delta;
            else if (cfg.operazione === 'decrement') newVal = current - delta;
            else newVal = delta;
            data[cfg.campo] = Math.round(newVal * 1000) / 1000;
            if (dryRun) { dryLog.push({ desc: 'trova_o_crea_e_aggiorna ' + cfg.modulo + '#' + match.id + ' ' + cfg.campo + ' ' + cfg.operazione + ' ' + delta + ' (' + current + ' → ' + data[cfg.campo] + ')' }); return; }
            db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(data), match.id);
            targetId = match.id;
            if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
              logDelta(cfg.modulo, targetId, cfg.campo, cfg.operazione === 'decrement' ? -delta : delta, moduleSlug, recordId);
            }
            fireModificaCampoCascata(cfg.modulo, targetId, cfg.campo, data);
          } else {
            const data = { ...matchValues, [cfg.campo]: Math.round((cfg.operazione === 'decrement' ? -delta : delta) * 1000) / 1000 };
            if (dryRun) { dryLog.push({ desc: 'trova_o_crea_e_aggiorna: nessun record esistente in ' + cfg.modulo + ' — ne creerebbe uno nuovo con ' + cfg.campo + ' = ' + data[cfg.campo] }); return; }
            const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo, null, JSON.stringify(data));
            targetId = result.lastInsertRowid;
            if (cfg.operazione === 'increment' || cfg.operazione === 'decrement') {
              logDelta(cfg.modulo, targetId, cfg.campo, cfg.operazione === 'decrement' ? -delta : delta, moduleSlug, recordId);
            }
            fireNuovoRecordCascata(cfg.modulo, targetId, data);
          }
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'trova_o_crea_e_aggiorna ' + cfg.modulo + '#' + targetId + ' ' + cfg.campo + ' ' + cfg.operazione + ' ' + delta, 'eseguito', recordId || null);
        } catch (e) { console.error('automation-engine: trova_o_crea_e_aggiorna fallito:', e.message); }
      }
      return;
    }

    // aggrega_in_record: seleziona i record di modulo_sorgente che soddisfano filtro,
    // crea UN nuovo record in modulo_destinazione con mappatura (letterali, 'campo:X'
    // dal record corrente, 'somma:campo'/'conteggio' sul set filtrato), poi marca ogni
    // record sorgente incluso scrivendo campo_marcatura = id del nuovo record — per
    // renderlo non ri-aggregabile in futuro. Generalizza sia "genera distinta di
    // versamento" sia "registra provvigione": in entrambi i casi si tratta di
    // aggregare un batch filtrato in un nuovo record e marcare il batch come processato.
    // config: { modulo_sorgente, filtro: [{campo, op, valore}], modulo_destinazione, mappatura, campo_marcatura? }
    // campo_marcatura è opzionale: assente quando il batch va incluso di nuovo al
    // round successivo (es. ammortamenti mensili, che ri-includono le stesse
    // attrezzature ogni mese — l'idempotenza lì è già garantita dallo scheduler
    // "una volta al mese", non da un flag sui record sorgente).
    if (az.target === '__interno__' && az.azione === 'aggrega_in_record') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo_sorgente && cfg.modulo_destinazione) {
        try {
          const resolveFiltroValore = (v) => {
            if (typeof v === 'string' && v.startsWith('campo:')) return recordData && recordData[v.slice(6)];
            return v;
          };
          // valore null/undefined nel filtro è un caso speciale: "campo vuoto" (==) o
          // "campo valorizzato" (!=) — non un confronto letterale contro null, che con
          // compare() darebbe sempre false anche per record con quel campo mai impostato.
          const matchesFiltro = (d, f) => {
            const valore = resolveFiltroValore(f.valore);
            if (valore === null || valore === undefined) {
              const vuoto = d[f.campo] === undefined || d[f.campo] === null || d[f.campo] === '';
              return f.op === '!=' ? !vuoto : vuoto;
            }
            return compare(d[f.campo], f.op, valore);
          };
          const tutti = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(cfg.modulo_sorgente);
          const matched = tutti.filter((r) => {
            let d;
            try { d = JSON.parse(r.data || '{}'); } catch { return false; }
            return (cfg.filtro || []).every((f) => matchesFiltro(d, f));
          });

          if (matched.length === 0) {
            if (dryRun) { dryLog.push({ desc: 'aggrega_in_record ' + cfg.modulo_sorgente + ' → ' + cfg.modulo_destinazione + ': nessun record da aggregare' }); return; }
            db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'aggrega_in_record ' + cfg.modulo_sorgente + ' → ' + cfg.modulo_destinazione + ': nessun record da aggregare', 'eseguito', recordId || null);
            return;
          }

          // I campi computed (es. "costo/vita_utile_anni" per riga) non sono mai nella
          // colonna grezza — vanno ricalcolati per ogni riga sorgente, altrimenti
          // 'somma:campo_computed' darebbe sempre 0 (stesso motivo di
          // fireNuovoRecordCascata/registra_provvigione altrove in questo file). Tenute
          // separate dai dati grezzi (matchedRaw) usati per la marcatura, per non
          // scrivere mai un valore computed nella colonna grezza del record sorgente.
          const matchedRaw = matched.map((r) => { try { return JSON.parse(r.data || '{}'); } catch { return {}; } });
          const sorgenteSchema = getModuleSchema(cfg.modulo_sorgente);
          const matchedData = matchedRaw.map((d, i) => sorgenteSchema ? attachComputedFields(db, { id: matched[i].id, data: { ...d } }, sorgenteSchema, cfg.modulo_sorgente).data : d);
          const resolveMappaturaVal = (v) => {
            if (typeof v !== 'string') return v;
            if (v === '_oggi_') return new Date().toISOString().slice(0, 10);
            if (v === '_ora_') return new Date().toISOString().slice(0, 16);
            if (v.startsWith('campo:')) return recordData && recordData[v.slice(6)];
            if (v === 'conteggio') return matchedData.length;
            if (v.startsWith('somma:')) {
              const campo = v.slice(6);
              return Math.round(matchedData.reduce((s, d) => s + (parseFloat(d[campo]) || 0), 0) * 1000) / 1000;
            }
            return v;
          };
          const nuovoDati = {};
          Object.entries(cfg.mappatura || {}).forEach(([k, v]) => { nuovoDati[k] = resolveMappaturaVal(v); });

          if (dryRun) {
            dryLog.push({ desc: 'aggrega_in_record ' + cfg.modulo_sorgente + ' (' + matched.length + ' record: id ' + matched.map((r) => r.id).join(', ') + ') → nuovo record in ' + cfg.modulo_destinazione + ' con ' + JSON.stringify(nuovoDati) + (cfg.campo_marcatura ? ' — e marcherebbe i record sorgente' : '') });
            return;
          }
          const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo_destinazione, null, JSON.stringify(nuovoDati));
          const nuovoId = result.lastInsertRowid;
          fireNuovoRecordCascata(cfg.modulo_destinazione, nuovoId, nuovoDati);

          if (cfg.campo_marcatura) {
            const upd = db.prepare('UPDATE records SET data = ? WHERE id = ?');
            matched.forEach((r, i) => {
              const d = matchedRaw[i];
              d[cfg.campo_marcatura] = cfg.valore_marcatura !== undefined ? cfg.valore_marcatura : nuovoId;
              upd.run(JSON.stringify(d), r.id);
            });
          }

          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'aggrega_in_record ' + cfg.modulo_sorgente + ' (' + matched.length + ' record) → ' + cfg.modulo_destinazione + '#' + nuovoId, 'eseguito', recordId || null);
        } catch (e) { console.error('automation-engine: aggrega_in_record fallito:', e.message); }
      }
      return;
    }

    // storna_riferimento: inverte tutti i delta numerici (automation_deltas) generati
    // in precedenza da automazioni scatenate dal record CORRENTE (es. un pagamento che
    // viene stornato: inverte l'incasso in Cassa e il decremento del credito Clienti),
    // senza bisogno di ricalcolare nulla — legge esattamente i delta registrati.
    if (az.target === '__interno__' && az.azione === 'storna_riferimento') {
      try {
        const deltas = db.prepare('SELECT * FROM automation_deltas WHERE source_module = ? AND source_record_id = ? AND stornato = 0').all(moduleSlug, recordId);
        if (dryRun) {
          const getRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?');
          const righeDryRun = deltas.map((delta) => {
            const row = getRow.get(delta.module_slug, delta.record_id);
            if (!row) return delta.module_slug + '#' + delta.record_id + ' (record non trovato)';
            const data = JSON.parse(row.data || '{}');
            const current = parseFloat(data[delta.campo]) || 0;
            return delta.module_slug + '#' + delta.record_id + ' ' + delta.campo + ': ' + current + ' → ' + (Math.round((current - delta.delta) * 1000) / 1000);
          });
          dryLog.push({ desc: 'storna_riferimento: ' + deltas.length + ' delta da invertire' + (righeDryRun.length ? ' (' + righeDryRun.join('; ') + ')' : '') });
          return;
        }
        const getRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?');
        const setRow = db.prepare('UPDATE records SET data = ? WHERE module_slug = ? AND id = ?');
        const markStornato = db.prepare('UPDATE automation_deltas SET stornato = 1 WHERE id = ?');
        deltas.forEach((delta) => {
          const row = getRow.get(delta.module_slug, delta.record_id);
          if (!row) { markStornato.run(delta.id); return; }
          const data = JSON.parse(row.data || '{}');
          const current = parseFloat(data[delta.campo]) || 0;
          data[delta.campo] = Math.round((current - delta.delta) * 1000) / 1000;
          setRow.run(JSON.stringify(data), delta.module_slug, delta.record_id);
          markStornato.run(delta.id);
          fireModificaCampoCascata(delta.module_slug, delta.record_id, delta.campo, data);
        });
        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'storna_riferimento: ' + deltas.length + ' delta invertiti', 'eseguito', recordId || null);
      } catch (e) { console.error('automation-engine: storna_riferimento fallito:', e.message); }
      return;
    }

    // crea_record_da_padre: clona il record corrente in un nuovo record di un altro
    // modulo (con mappatura campi), poi per ogni gruppo di 'figli' clona ogni riga
    // figlia collegata al record corrente in un nuovo record del modulo figlio di
    // destinazione, collegato al nuovo padre. Serve per "genera fattura da ordine"
    // (copia ordini_righe → fatture_righe) e casi analoghi di duplicazione con figli.
    // 'figli_fissi' è la variante non-loop: esattamente un record per voce elencata,
    // con mappatura risolta contro il record PADRE (non contro una riga sorgente) —
    // serve per scritture a righe fisse note in anticipo (es. il movimento contabile
    // dare/avere generato da una fattura: sempre "Clienti / Ricavi / IVA", non un
    // numero variabile di righe clonate da un altro modulo).
    // config: { modulo_destinazione, mappatura_campi,
    //   figli: [{ modulo_sorgente_figli, via_relazione, modulo_destinazione_figli, mappatura_campi_figli, relazione_nuovo_padre? }],
    //   figli_fissi: [{ modulo_destinazione_figli, mappatura_campi_figli, relazione_nuovo_padre? }] }
    // 'modulo_destinazione' è opzionale: se assente non si crea nessun padre (utile
    // quando serve solo clonare righe di un ordine in un altro modulo senza una nuova
    // testata, es. righe ordine d'acquisto → lotti di magazzino verde) — in quel caso
    // 'relazione_nuovo_padre' su ogni figlio è a sua volta opzionale (niente padre da
    // collegare) e recordId (il record che ha scatenato l'automazione) resta comunque
    // disponibile per chi lo vuole referenziare esplicitamente.
    if (az.target === '__interno__' && az.azione === 'crea_record_da_padre') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo_destinazione || (cfg.figli && cfg.figli.length) || (cfg.figli_fissi && cfg.figli_fissi.length)) {
        try {
          let nuovoPadreId = null;
          let datiPadre = null;
          if (cfg.modulo_destinazione) {
            datiPadre = resolveDati(cfg.mappatura_campi || {}, recordData, null, { targetModuleSlug: cfg.modulo_destinazione, sourceRecordId: recordId });
            if (dryRun) { nuovoPadreId = '(nuovo)'; }
            else {
              const resultPadre = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo_destinazione, null, JSON.stringify(datiPadre));
              nuovoPadreId = resultPadre.lastInsertRowid;
            }
          }

          let figliCreati = 0;
          (cfg.figli || []).forEach((figlioCfg) => {
            if (!figlioCfg.modulo_sorgente_figli || !figlioCfg.via_relazione || !figlioCfg.modulo_destinazione_figli) return;
            const figliSorgente = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(figlioCfg.modulo_sorgente_figli)
              .map((r) => { try { return JSON.parse(r.data || '{}'); } catch { return null; } })
              .filter((d) => d && String(d[figlioCfg.via_relazione]) === String(recordId));
            figliSorgente.forEach((figlioData) => {
              const datiFiglio = resolveDati(figlioCfg.mappatura_campi_figli || {}, figlioData, null, { targetModuleSlug: figlioCfg.modulo_destinazione_figli, sourceRecordId: recordId, parentData: recordData });
              if (figlioCfg.relazione_nuovo_padre && nuovoPadreId) datiFiglio[figlioCfg.relazione_nuovo_padre] = nuovoPadreId;
              if (dryRun) { figliCreati++; return; }
              const resultFiglio = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(figlioCfg.modulo_destinazione_figli, null, JSON.stringify(datiFiglio));
              fireNuovoRecordCascata(figlioCfg.modulo_destinazione_figli, resultFiglio.lastInsertRowid, datiFiglio);
              figliCreati++;
            });
          });

          (cfg.figli_fissi || []).forEach((figlioCfg) => {
            if (!figlioCfg.modulo_destinazione_figli) return;
            const datiFiglio = resolveDati(figlioCfg.mappatura_campi_figli || {}, recordData, null, { targetModuleSlug: figlioCfg.modulo_destinazione_figli, sourceRecordId: recordId });
            if (figlioCfg.relazione_nuovo_padre && nuovoPadreId) datiFiglio[figlioCfg.relazione_nuovo_padre] = nuovoPadreId;
            if (dryRun) { figliCreati++; return; }
            const resultFiglio = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(figlioCfg.modulo_destinazione_figli, null, JSON.stringify(datiFiglio));
            fireNuovoRecordCascata(figlioCfg.modulo_destinazione_figli, resultFiglio.lastInsertRowid, datiFiglio);
            figliCreati++;
          });

          const descPadre = 'crea_record_da_padre → ' + (cfg.modulo_destinazione ? cfg.modulo_destinazione + '#' + nuovoPadreId : '(nessun padre)') + ' (' + figliCreati + ' figli clonati)';
          if (dryRun) { dryLog.push({ desc: descPadre }); return; }
          // Il padre scatena 'nuovo_record' solo DOPO che tutti i figli sono stati
          // creati — così i suoi campi computed che aggregano i figli (es.
          // sum_children su fatture_righe) vedono già i dati completi, non zero.
          if (cfg.modulo_destinazione) fireNuovoRecordCascata(cfg.modulo_destinazione, nuovoPadreId, datiPadre);

          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, descPadre, 'eseguito', recordId || null);
        } catch (e) { console.error('automation-engine: crea_record_da_padre fallito:', e.message); }
      }
      return;
    }

    // registra_provvigione: calcola e posta la provvigione di un agente a scaglioni
    // progressivi sul fatturato, sulle fatture non ancora processate. A differenza
    // delle altre azioni, questa è deliberatamente non generica — il calcolo (scaglioni
    // JSON, fatturato lifetime per scegliere lo scaglione ma importo solo sul batch non
    // ancora registrato, bonus target) è una regola di business specifica, non un
    // pattern riusabile altrove. config: {} — agisce sul campo 'agente' del record
    // corrente (pensato per un record "richiesta provvigione" con solo quel campo).
    if (az.target === '__interno__' && az.azione === 'registra_provvigione') {
      try {
        const agenteId = recordData && recordData.agente;
        if (!agenteId) throw new Error('campo agente mancante sul record che scatena registra_provvigione');
        const agenteRow = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get('agenti', agenteId);
        if (!agenteRow) throw new Error('agente #' + agenteId + ' non trovato');
        const agente = JSON.parse(agenteRow.data || '{}');

        // imponibile_calcolato è un campo computed: mai persistito nel record grezzo,
        // va ricalcolato per ognuno (stesso motivo per cui fireNuovoRecordCascata
        // esiste — un valore aggregato letto direttamente dalla colonna 'data' sarebbe
        // sempre 0/assente).
        const fattureSchema = getModuleSchema('fatture');
        const tutteFatture = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all('fatture')
          .map((r) => { try { return { id: r.id, data: JSON.parse(r.data || '{}') }; } catch { return null; } })
          .filter((r) => r && r.data.agente == agenteId)
          .map((r) => attachComputedFields(db, r, fattureSchema, 'fatture'));
        const fatturatoLifetime = tutteFatture.reduce((s, r) => s + (parseFloat(r.data.imponibile_calcolato) || 0), 0);
        const batch = tutteFatture.filter((r) => !r.data.provvigione_registrata);

        if (batch.length === 0) {
          if (dryRun) { dryLog.push({ desc: 'registra_provvigione: nessuna fattura da processare per agente #' + agenteId }); return; }
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'registra_provvigione: nessuna fattura da processare per agente #' + agenteId, 'eseguito', recordId || null);
          return;
        }

        let scaglioni = [];
        try { scaglioni = JSON.parse(agente.scaglioni_provvigione || '[]'); } catch { scaglioni = []; }
        scaglioni = Array.isArray(scaglioni) ? [...scaglioni].sort((a, b) => (b.soglia || 0) - (a.soglia || 0)) : [];
        // Se l'agente non ha scaglioni progressivi configurati (o nessuno scaglione è
        // applicabile), la percentuale base dell'agente è il fallback — non 0. Senza
        // questo, ogni agente creato senza scaglioni maturerebbe provvigione zero
        // nonostante abbia una provvigione_base impostata.
        const scaglione = scaglioni.find((s) => fatturatoLifetime >= (s.soglia || 0)) || scaglioni[scaglioni.length - 1] || { perc: agente.provvigione_base };
        const perc = parseFloat(scaglione.perc) || 0;

        const imponibileBatch = batch.reduce((s, r) => s + (parseFloat(r.data.imponibile_calcolato) || 0), 0);
        const base = Math.round(imponibileBatch * perc / 100 * 100) / 100;
        const target = parseFloat(agente.target_fatturato) || 0;
        const bonusTarget = parseFloat(agente.bonus_target) || 0;
        // Corretto rispetto a nico: il bonus target viene calcolato E POSTATO (in nico
        // viene calcolato da calcoloProvvigione ma il chiamante lo scarta, un bug —
        // vedi inventario Fase iniziale).
        const targetRaggiunto = target > 0 && fatturatoLifetime >= target;
        const bonus = targetRaggiunto ? bonusTarget : 0;
        const importoTotale = Math.round((base + bonus) * 100) / 100;

        const descProvvigione = 'registra_provvigione agente #' + agenteId + ': ' + importoTotale + ' € (' + batch.length + ' fatture, scaglione ' + perc + '%' + (bonus ? ' + bonus target' : '') + ')';
        if (dryRun) { dryLog.push({ desc: descProvvigione + (importoTotale > 0 ? ' — creerebbe un movimento contabile e marcherebbe ' + batch.length + ' fatture come registrate' : '') }); return; }

        if (importoTotale > 0) {
          const contoCosto = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all('piano_conti')
            .find((r) => { try { return JSON.parse(r.data || '{}').codice === '5200'; } catch { return false; } });
          const contoDebito = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all('piano_conti')
            .find((r) => { try { return JSON.parse(r.data || '{}').codice === '2600'; } catch { return false; } });
          const year = new Date().getUTCFullYear();
          const countMov = db.prepare('SELECT data FROM records WHERE module_slug = ?').all('movimenti')
            .filter((r) => { try { return String(JSON.parse(r.data || '{}').numero || '').startsWith(year + '/'); } catch { return false; } }).length;
          const movDati = { data: new Date().toISOString().slice(0, 10), numero: year + '/' + String(countMov + 1).padStart(4, '0'), descrizione: 'Provvigione agente', _stato: 'confermato' };
          const movResult = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('movimenti', null, JSON.stringify(movDati));
          const movId = movResult.lastInsertRowid;
          if (contoCosto) {
            const r1 = { conto: contoCosto.id, dare: importoTotale, avere: 0, movimento: movId };
            const ins1 = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('movimenti_righe', null, JSON.stringify(r1));
            fireNuovoRecordCascata('movimenti_righe', ins1.lastInsertRowid, r1);
          }
          if (contoDebito) {
            const r2 = { conto: contoDebito.id, avere: importoTotale, dare: 0, movimento: movId };
            const ins2 = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run('movimenti_righe', null, JSON.stringify(r2));
            fireNuovoRecordCascata('movimenti_righe', ins2.lastInsertRowid, r2);
          }
          fireNuovoRecordCascata('movimenti', movId, movDati);
        }

        const setFattura = db.prepare('UPDATE records SET data = ? WHERE id = ?');
        batch.forEach((r) => {
          const d = { ...r.data, provvigione_registrata: true };
          setFattura.run(JSON.stringify(d), r.id);
        });

        db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, descProvvigione, 'eseguito', recordId || null);
      } catch (e) { console.error('automation-engine: registra_provvigione fallito:', e.message); }
      return;
    }

    if (az.target === '__interno__' && az.azione === 'crea_record') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo) {
        const dati = resolveDati(cfg.dati || {}, recordData, null, { targetModuleSlug: cfg.modulo, sourceRecordId: recordId });
        try {
          if (dryRun) { dryLog.push({ desc: 'crea_record in ' + cfg.modulo + ' con ' + JSON.stringify(dati) }); return; }
          const resultNuovo = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo, null, JSON.stringify(dati));
          fireNuovoRecordCascata(cfg.modulo, resultNuovo.lastInsertRowid, dati);
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'crea_record in ' + cfg.modulo, 'eseguito', recordId || null);
        } catch (e) {
          console.error('automation-engine: crea_record fallito:', e.message);
        }
      }
      return;
    }
    if (az.target === '__interno__' && az.azione === 'crea_record_n_volte') {
      const cfg = az.config && typeof az.config === 'object' ? az.config : {};
      if (cfg.modulo) {
        const n = cfg.n_field
          ? (parseInt(recordData && recordData[cfg.n_field]) || 0)
          : (parseInt(cfg.n) || 0);
        if (dryRun) { dryLog.push({ desc: 'crea_record_n_volte (' + n + ') in ' + cfg.modulo }); return; }
        for (let i = 1; i <= n && i <= 500; i++) {
          const dati = resolveDati(cfg.dati || {}, recordData, i, { targetModuleSlug: cfg.modulo, sourceRecordId: recordId });
          try {
            const resultN = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(cfg.modulo, null, JSON.stringify(dati));
            fireNuovoRecordCascata(cfg.modulo, resultN.lastInsertRowid, dati);
          } catch (e) {
            console.error('automation-engine: crea_record_n_volte iterazione ' + i + ' fallita:', e.message);
          }
        }
        try {
          db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)').run(moduleSlug, automationLabel, logged.triggerDesc, 'crea_record_n_volte (' + n + ') in ' + cfg.modulo, 'eseguito', recordId || null);
        } catch (e) {}
      }
      return;
    }
    const actionLabel = (ACTION_LABELS[az.target] || az.target) + ' — ' + (az.azione || '');
    // Tenta chiamata reale se credenziali disponibili, altrimenti simula
    const creds = getCredentials(az.target);
    const esito = creds ? 'chiamata_reale' : 'simulato';
    const descEsterna = actionLabel + (az.config && typeof az.config === 'string' ? ' (' + az.config + ')' : '');
    if (dryRun) {
      dryLog.push({ desc: descEsterna + (creds ? ' (chiamata esterna reale NON eseguita in anteprima)' : ' (nessuna credenziale collegata, sarebbe simulata anche in esecuzione reale)') });
      return;
    }
    try {
      db.prepare('INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(moduleSlug, automationLabel, logged.triggerDesc, descEsterna, esito, recordId || null);
      if (creds) {
        // Chiamata asincrona — non blocca il flusso sync del trigger
        callRealAPI(az.target, az.azione, az.config, recordData).then((result) => {
          db.prepare('UPDATE automation_logs SET esito = ? WHERE module_slug = ? AND record_id = ? ORDER BY created_at DESC LIMIT 1').run(result.esito, moduleSlug, recordId || null);
        }).catch(() => {});
      }
    } catch (e) {
      console.error('automation-engine: log fallito (record salvato comunque):', e.message);
    }
  });
}

const TRIGGER_LABELS = {
  nuovo_record: 'Nuovo record',
  cambio_stato: 'Cambio stato',
  modifica_campo: 'Modifica campo',
};

// event = 'nuovo_record' | 'cambio_stato' | 'modifica_campo'
// details = { stato } per cambio_stato, { campo } per modifica_campo
//
// Chiamata da records.js DOPO che il record è già stato salvato — qualunque errore
// qui dentro viene contenuto (mai propagato) perché il salvataggio del record, non
// l'automazione, è l'operazione che l'utente ha davvero chiesto.
function fireTrigger(moduleSlug, event, recordData, recordId, details) {
  try {
    let schemaRow;
    try {
      schemaRow = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(moduleSlug);
    } catch (e) { return; }
    if (!schemaRow) return;

    const automations = getAutomationSteps(schemaRow.schema_json);
    automations.forEach((auto) => {
      if (auto.enabled === false) return;
      if (!auto.trigger || auto.trigger.evento !== event) return;
      if (event === 'cambio_stato' && auto.trigger.stato && auto.trigger.stato !== (details && details.stato)) return;
      if (event === 'modifica_campo' && auto.trigger.campo && auto.trigger.campo !== (details && details.campo)) return;

      let triggerDesc = TRIGGER_LABELS[event] || event;
      if (event === 'cambio_stato' && details && details.stato) triggerDesc += ' → ' + details.stato;
      if (event === 'modifica_campo' && details && details.campo) triggerDesc += ' su ' + details.campo;

      runAzioni(auto.azioni, recordData, moduleSlug, auto.label || 'Automazione', recordId, { triggerDesc });
    });
  } catch (e) {
    console.error('automation-engine: fireTrigger fallito (record salvato comunque):', e.message);
  }
}

module.exports = { fireTrigger, runAzioni, compare };
