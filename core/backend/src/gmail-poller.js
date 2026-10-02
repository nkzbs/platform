'use strict';
// ─── POLLER GMAIL ───────────────────────────────────────────────────────────
// Ogni 15 minuti: per ogni regola attiva in 'gmail_regole' (mittente -> gruppo/
// categoria), cerca email recenti di quel mittente non ancora smistate, crea
// una spesa in stato "da_smistare" (spese_casa o spese_personali a seconda del
// gruppo della regola) con l'allegato dell'email collegato tramite lo stesso
// meccanismo generico di allegati già usato ovunque (tabella uploads +
// record_attachments, vedi lib/upload-storage.js — finisce su Drive invece
// che sul server locale se il modulo extra Drive è attivo, stesso interruttore
// usato dall'upload manuale). L'utente completa/corregge categoria e importo
// aprendo la spesa (tab "Da smistare" in SpeseFinancePage) e usa la
// transizione di workflow per confermarla.
//
// Estrazione euristica di importo e scadenza dal testo (email + PDF allegati
// se presenti) — nessuna AI coinvolta, solo pattern regex. Portato/migliorato
// dal parser reale già in produzione su hearth (backend/src/services/
// gmailParser.js), letto direttamente su richiesta dell'utente invece di
// ripartire da zero: stessa idea, adattata al modello dati generico di questa
// piattaforma (spese_casa/spese_personali invece della tabella 'spese' fissa
// di hearth, allegati generici invece di una tabella allegati_spese dedicata).

const db = require('./db');
const { getValidAccessToken, createCalendarEvent } = require('./routes/google-oauth');
const { saveUploadBuffer } = require('./lib/upload-storage');
const { fireTrigger } = require('./automation-engine');

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function base64UrlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function gmailGet(accessToken, urlPath) {
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me' + urlPath, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Gmail API: ' + (data.error?.message || res.statusText));
  return data;
}

function getActiveRules() {
  return db.prepare("SELECT id, data FROM records WHERE module_slug = 'gmail_regole'").all()
    .map((r) => ({ id: r.id, ...JSON.parse(r.data) }))
    .filter((r) => r.attiva && r.mittente);
}

// Cammina l'albero 'parts' del messaggio Gmail (può essere annidato) raccogliendo
// il testo semplice (anche da HTML, ripulito) e le parti-allegato (quelle con
// un filename valorizzato).
function walkParts(payload, acc) {
  if (!payload) return;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    acc.text += base64UrlDecode(payload.body.data).toString('utf8') + '\n';
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    acc.text += base64UrlDecode(payload.body.data).toString('utf8')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/td>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&euro;/gi, '€') + '\n';
  }
  if (payload.filename && payload.body?.attachmentId) {
    acc.attachments.push({ filename: payload.filename, mimeType: payload.mimeType, attachmentId: payload.body.attachmentId });
  }
  (payload.parts || []).forEach((p) => walkParts(p, acc));
}

// Estrae il testo da un PDF (bollette/fatture spesso hanno importo e date SOLO
// nel PDF allegato, non nel corpo dell'email) — se pdf-parse fallisce (PDF
// scansionato/immagine, non testo estraibile) torna stringa vuota, non lancia:
// l'euristica prosegue comunque sul solo testo dell'email.
async function estraiTestoDaPDF(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    return parsed.text || '';
  } catch (e) {
    return '';
  }
}

// Importo: cerca le frasi italiane più comuni di bollette/fatture ("totale
// fattura", "importo dovuto", ecc.), in ordine di specificità — la prima che
// trova vince. Range di sanità 0,50-50000€ per scartare falsi positivi tipo
// codici fiscali o numeri di pratica che assomigliano a un importo.
function estraiImporto(testo) {
  const patterns = [
    /(?:totale\s+fattura)[:\s]*(?:€\s*)?([\d.,]+)/i,
    /Totale\s+Fattura[^€\d]*([\d]+[.,][\d]{2})/i,
    /TOTALE\s+DA\s+PAGARE\s+Euro\s+([\d]+[.,][\d]{2})/i,
    /totale\s+da\s+pagare\s+Euro\s+([\d]+[.,][\d]{2})/i,
    /(?:totale\s+(?:da\s+pagare|importo|bolletta|dovuto))[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:importo\s+(?:totale|da\s+pagare|dovuto|netto|bolletta|fattura))[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:netto\s+a\s+pagare)[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:totale\s+a\s+pagare)[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:saldo\s+fattura)[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:totale\s+documento)[:\s]*(?:€\s*)?([\d.,]+)/i,
    /(?:totale)[:\s]+(?:€\s*)?([\d.,]+)/i,
    /€\s*([\d]+[.,][\d]{2})\b/,
    /([\d]+[.,][\d]{2})\s*€/,
    /EUR\s*([\d.,]+)/i,
  ];
  for (const p of patterns) {
    const m = testo.match(p);
    if (m?.[1]) {
      const val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(val) && val > 0.5 && val < 50000) return val;
    }
  }
  return null;
}

function convDataItaliana(s) {
  if (!s) return null;
  const [g, m, a] = s.split('/');
  return a + '-' + m + '-' + g;
}

// Date esplicite tipiche delle bollette italiane ("Data Versamento"/"Data
// Scadenza" con etichetta) — più precise della ricerca generica sotto perché
// non devono indovinare quale tra le date trovate nel testo sia quella giusta.
function estraiDateEtichettate(testo) {
  const versamento = testo.match(/Data\s+Versamento[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  const scadenza = testo.match(/Data\s+Scadenza[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  return {
    dataVersamento: versamento ? convDataItaliana(versamento[1]) : null,
    dataScadenza: scadenza ? convDataItaliana(scadenza[1]) : null,
  };
}

// Fallback generico: qualunque pattern di data italiana nel testo, tiene la
// più lontana nel futuro rispetto a 'rifDate' — è quasi sempre la scadenza,
// non la data di emissione. Usato solo se non si trova un'etichetta esplicita
// sopra. Nessuna garanzia di trovarla: torna null se non c'è nulla di
// plausibile, l'utente la aggiunge a mano in fase di revisione.
function estraiScadenzaGenerica(testo, rifDate) {
  const trovate = [];
  const reNumerica = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
  let m;
  while ((m = reNumerica.exec(testo))) {
    const [, g, mese, anno] = m;
    const d = new Date(Date.UTC(+anno, +mese - 1, +g));
    if (!isNaN(d) && d.getUTCMonth() === +mese - 1) trovate.push(d);
  }
  const reTestuale = new RegExp('\\b(\\d{1,2})\\s+(' + MESI.join('|') + ')\\s+(\\d{4})\\b', 'gi');
  while ((m = reTestuale.exec(testo))) {
    const [, g, meseNome, anno] = m;
    const meseIdx = MESI.indexOf(meseNome.toLowerCase());
    trovate.push(new Date(Date.UTC(+anno, meseIdx, +g)));
  }
  const future = trovate.filter((d) => d.getTime() > rifDate.getTime());
  if (future.length === 0) return null;
  future.sort((a, b) => b.getTime() - a.getTime());
  return future[0].toISOString().slice(0, 10);
}

// Un sollecito/reminder di una bolletta già registrata non deve creare una
// seconda spesa duplicata — solo segnalarlo (per ora nei log, un canale di
// notifica dedicato è un miglioramento futuro, non blocca la correttezza dei
// dati). Riconoscimento sull'oggetto, stesso criterio di hearth.
function eUnSollecito(subject) {
  const s = subject.toLowerCase();
  return s.includes('scadut') || s.includes('sollecit') || s.includes('reminder') || s.includes('promemoria');
}

// Categoria più precisa quando la regola è generica (stesso mittente per più
// servizi, es. un unico fornitore energia che manda sia bollette gas sia
// luce) — raffinata dall'oggetto, la regola resta il default.
function raffinaCategoria(subject, categoriaRegola) {
  const s = subject.toLowerCase();
  if (s.includes('gas')) return 'Gas';
  if (s.includes('elettric') || s.includes('luce')) return 'Elettricità';
  if (s.includes('acqua') || s.includes('idric')) return 'Acqua';
  return categoriaRegola;
}

async function processaMessaggio(accessToken, msgId, rule) {
  const already = db.prepare('SELECT id FROM gmail_processed_messages WHERE message_id = ?').get(msgId);
  if (already) return;

  const full = await gmailGet(accessToken, '/messages/' + msgId + '?format=full');
  const headers = {};
  (full.payload?.headers || []).forEach((h) => { headers[h.name.toLowerCase()] = h.value; });
  const subject = headers.subject || '(senza oggetto)';
  const emailDate = headers.date ? new Date(headers.date) : new Date();

  // Un sollecito non genera una spesa duplicata — solo segnato come processato.
  if (eUnSollecito(subject)) {
    console.log('[gmail-poller] sollecito ignorato (spesa già registrata in precedenza):', subject);
    db.prepare('INSERT INTO gmail_processed_messages (message_id) VALUES (?)').run(msgId);
    return;
  }

  const acc = { text: '', attachments: [] };
  walkParts(full.payload, acc);

  // Scarica ORA i PDF allegati (una sola volta: gli stessi bytes serviranno
  // sia per estrarne il testo qui sotto sia per salvarli come allegato più
  // avanti, senza riscaricarli una seconda volta dall'API Gmail).
  const allegatiScaricati = [];
  for (const att of acc.attachments) {
    try {
      const attData = await gmailGet(accessToken, '/messages/' + msgId + '/attachments/' + att.attachmentId);
      const bytes = base64UrlDecode(attData.data);
      allegatiScaricati.push({ ...att, bytes });
      const isPdf = (att.mimeType || '').includes('pdf') || att.filename.toLowerCase().endsWith('.pdf');
      if (isPdf) acc.text += '\n' + await estraiTestoDaPDF(bytes);
    } catch (e) {
      console.error('[gmail-poller] download allegato fallito per messaggio', msgId, ':', e.message);
    }
  }

  const testoCompleto = subject + '\n' + acc.text;
  const importo = estraiImporto(testoCompleto);
  const dateEtichettate = estraiDateEtichettate(testoCompleto);
  const scadenza = dateEtichettate.dataScadenza || estraiScadenzaGenerica(testoCompleto, emailDate);
  const dataSpesa = dateEtichettate.dataVersamento || emailDate.toISOString().slice(0, 10);

  const moduleSlug = rule.gruppo === 'Casa' ? 'spese_casa' : 'spese_personali';
  const dataRecord = {
    descrizione: rule.descrizione || subject,
    importo: importo || 0,
    data: dataSpesa,
    categoria: raffinaCategoria(subject, rule.categoria || 'Altro'),
    note: 'Importato da Gmail (' + rule.mittente + '): ' + subject + (importo ? '' : ' — importo non rilevato automaticamente, verificare'),
    _stato: 'da_smistare',
    fisso: false,
  };
  if (scadenza) dataRecord.scadenza = scadenza;

  const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(moduleSlug, null, JSON.stringify(dataRecord));
  const recordId = result.lastInsertRowid;
  // Stesso fireTrigger('nuovo_record', ...) che routes/records.js chiama per un
  // record creato dall'utente — senza questo, un'automazione con trigger "Nuovo
  // record" su spese_casa/spese_personali non scattava MAI per le spese importate
  // da Gmail (solo per quelle create a mano), perché questo file scrive
  // direttamente sul DB invece di passare dall'API. Bug reale, non solo mancanza.
  try { fireTrigger(moduleSlug, 'nuovo_record', dataRecord, recordId, {}); } catch (e) { console.error('[gmail-poller] fireTrigger fallito:', e.message); }

  for (const att of allegatiScaricati) {
    try {
      const storedName = await saveUploadBuffer(att.bytes, att.filename, att.mimeType);
      const uploadResult = db.prepare(
        'INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)'
      ).run(att.filename, storedName, att.mimeType || 'application/octet-stream', att.bytes.length, null);
      db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)')
        .run(moduleSlug, recordId, uploadResult.lastInsertRowid, 'gmail');
    } catch (e) {
      console.error('[gmail-poller] allegato non salvato per messaggio', msgId, ':', e.message);
    }
  }

  if (scadenza) {
    try {
      await createCalendarEvent({
        summary: dataRecord.descrizione + (importo ? ' — €' + importo.toFixed(2) : ''),
        description: 'Scadenza rilevata automaticamente da un\'email di ' + rule.mittente + '.\n' + subject,
        date: scadenza,
      });
    } catch (e) {
      console.warn('[gmail-poller] evento calendario non creato:', e.message);
    }
  }

  db.prepare('INSERT INTO gmail_processed_messages (message_id) VALUES (?)').run(msgId);
}

async function pollGmail() {
  const rules = getActiveRules();
  if (rules.length === 0) return;

  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (e) {
    // Google non connesso — nessun errore rumoroso ad ogni ciclo, è uno stato
    // normale finché l'utente non collega l'account dalla pagina Connessioni.
    return;
  }

  for (const rule of rules) {
    try {
      const q = 'from:' + rule.mittente + ' newer_than:30d';
      const list = await gmailGet(accessToken, '/messages?q=' + encodeURIComponent(q));
      for (const m of (list.messages || [])) {
        try {
          await processaMessaggio(accessToken, m.id, rule);
        } catch (e) {
          console.error('[gmail-poller] messaggio', m.id, 'fallito:', e.message);
        }
      }
    } catch (e) {
      console.error('[gmail-poller] regola', rule.mittente, 'fallita:', e.message);
    }
  }
}

function startGmailPoller() {
  setTimeout(pollGmail, 60 * 1000);
  setInterval(pollGmail, 15 * 60 * 1000);
}

module.exports = { startGmailPoller, pollGmail };
