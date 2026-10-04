'use strict';
// Mail che sembrano bollette ma arrivano da un mittente senza regola: non si perdono in silenzio. Ogni ciclo di controllo cerca nella posta
// (ultimi 3 giorni, solo intestazioni: mittente, oggetto, data) le mail con parole da bolletta che nessuna regola riconosce, le tiene in una lista
// ("Mail non riconosciute", in Impostazioni → Connessioni → Google, con «Crea regola» e «Ignora») e manda un solo messaggio WhatsApp.
const db = require('./db');

const QUERY = 'in:inbox newer_than:3d -category:promotions -category:social (bolletta OR fattura OR scadenza OR "da pagare" OR "avviso di pagamento" OR "estratto conto")';
let ready = false;
function ensure() {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS gmail_unknown (
    id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, mittente TEXT NOT NULL, oggetto TEXT, ricevuta TEXT,
    stato TEXT NOT NULL DEFAULT 'nuova', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  ready = true;
}

// "Nome Cognome" <a@b.it>  ->  a@b.it (minuscolo)
function parseMittente(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  const email = (m ? m[1] : String(from || '')).trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}
const matchesRule = (email, rules) => rules.some((r) => r.mittente && (email === r.mittente || email.includes(r.mittente)));

// Cerca, registra e (se serve) segnala. `gmailGet(accessToken, path)` è quello del poller. Ritorna le righe nuove (da segnalare).
async function scan(accessToken, gmailGet, rules) {
  ensure();
  const list = await gmailGet(accessToken, '/messages?maxResults=25&q=' + encodeURIComponent(QUERY));
  const fresh = [];
  for (const m of (list.messages || [])) {
    if (db.prepare('SELECT 1 FROM gmail_unknown WHERE message_id = ?').get(m.id) || db.prepare('SELECT 1 FROM gmail_processed_messages WHERE message_id = ?').get(m.id)) continue;
    const full = await gmailGet(accessToken, '/messages/' + m.id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date');
    const h = {}; ((full.payload && full.payload.headers) || []).forEach((x) => { h[x.name.toLowerCase()] = x.value; });
    const email = parseMittente(h.from);
    if (!email || matchesRule(email, rules)) continue;
    // un mittente già messo da parte con «Ignora» non torna a farsi segnalare
    const ignorato = !!db.prepare("SELECT 1 FROM gmail_unknown WHERE mittente = ? AND stato = 'ignorata'").get(email);
    const info = db.prepare('INSERT INTO gmail_unknown (message_id, mittente, oggetto, ricevuta, stato) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, email, String(h.subject || '(senza oggetto)').slice(0, 200), h.date ? new Date(h.date).toISOString() : null, ignorato ? 'ignorata' : 'nuova');
    if (!ignorato) fresh.push({ id: info.lastInsertRowid, mittente: email, oggetto: String(h.subject || '(senza oggetto)').slice(0, 200) });
  }
  return fresh;
}

function messaggio(items) {
  const per = []; const visti = new Set();
  for (const i of items) { if (visti.has(i.mittente)) continue; visti.add(i.mittente); per.push(i); }
  const righe = per.slice(0, 3).map((i) => '• ' + i.mittente + ' — «' + i.oggetto.slice(0, 60) + '»');
  if (per.length > 3) righe.push('… e altri ' + (per.length - 3) + ' mittenti');
  return 'Mail che sembrano bollette ma non hanno una regola:\n' + righe.join('\n') + '\nAggiungi la regola in Impostazioni → Connessioni → Google.';
}

const listNuove = () => { ensure(); return db.prepare("SELECT id, mittente, oggetto, ricevuta FROM gmail_unknown WHERE stato = 'nuova' ORDER BY id DESC LIMIT 50").all(); };
const ignora = (id) => { ensure(); return db.prepare("UPDATE gmail_unknown SET stato = 'ignorata' WHERE id = ? AND stato = 'nuova'").run(id).changes > 0; };
// Quando si crea una regola per un mittente, le sue mail non sono più "non riconosciute"
const risolviMittente = (mittente) => { ensure(); db.prepare("UPDATE gmail_unknown SET stato = 'regola' WHERE stato = 'nuova' AND (mittente = ? OR mittente LIKE ?)").run(mittente, '%' + mittente + '%'); };

module.exports = { scan, messaggio, listNuove, ignora, risolviMittente, parseMittente, matchesRule, QUERY };
