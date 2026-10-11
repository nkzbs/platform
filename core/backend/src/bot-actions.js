'use strict';
// Bot Telegram: le azioni. Ogni scrittura nasce da una PROPOSTA che il bot descrive in chiaro con due bottoni (✅ conferma / ✖ annulla); solo il tocco la esegue.
//  • cosa si fa lo decide un intento validato (shared/ai-bot-intent.js), ma la RIGA a cui ci si riferisce la trova il tenant da sé, tra le righe che l'utente vede
//    (mai un id deciso dal modello);
//  • la proposta vale 15 minuti, una volta sola, solo per la chat e l'utente che l'hanno originata, e al momento dell'esecuzione si ricontrolla lo stato della riga;
//  • l'esecuzione passa dall'API dell'app come quell'utente (lib/internal-api.js): stessi permessi, validazioni, automazioni e registro del browser.
// Azioni previste: segnare pagata / riaprire una voce, smistare una bolletta (un pagamento, rate, già pagata), registrare una spesa nuova, importare un PDF.
// NON previste (di proposito): eliminare, modificare campi liberi, utenti, impostazioni, backup.
const crypto = require('crypto');
const db = require('./db');
const moduleRoles = require('./module-roles');
const moduleAi = require('./module-ai');
const { logAudit } = require('./audit-log');
const { callAs } = require('./lib/internal-api');
const { moduliPerUtente, esc, eur } = require('./bot-ai');

const TTL_MS = 15 * 60 * 1000;
const MAX_CANDIDATI = 6;
const MAX_PDF = 3 * 1024 * 1024;
const shortDate = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
const oggiRoma = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
const tronca = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

// ── proposte in attesa ─────────────────────────────────────────────────────────────────────────────────────────────────
function savePending(chatId, userId, action) {
  db.prepare('DELETE FROM telegram_pending WHERE expires_at < ?').run(Date.now());
  const id = Array.from(crypto.randomBytes(6)).map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  db.prepare('INSERT INTO telegram_pending (id, chat_id, user_id, action, expires_at) VALUES (?, ?, ?, ?, ?)').run(id, String(chatId), userId, JSON.stringify(action), Date.now() + TTL_MS);
  return id;
}
function readPending(id, chatId, userId, { consume }) {
  const row = db.prepare('SELECT * FROM telegram_pending WHERE id = ?').get(String(id));
  if (!row || row.chat_id !== String(chatId) || row.user_id !== userId) return null;
  if (consume) db.prepare('DELETE FROM telegram_pending WHERE id = ?').run(row.id); // una volta sola, valida o scaduta
  return row.expires_at < Date.now() ? null : JSON.parse(row.action);
}
const takePending = (id, chatId, userId) => readPending(id, chatId, userId, { consume: true });
const peekPending = (id, chatId, userId) => readPending(id, chatId, userId, { consume: false });

// ── trovare la voce di cui si parla, tra quelle che l'utente vede ────────────────────────────────────────────────────────
const STOP = new Set(['il', 'lo', 'la', 'le', 'li', 'un', 'una', 'di', 'del', 'della', 'dei', 'delle', 'dello', 'da', 'in', 'per', 'con', 'su', 'ho', 'la', 'ho', 'bolletta', 'voce', 'spesa', 'pagata', 'pagato', 'euro', 'rata']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9., ]/g, ' ');
const tokens = (s) => norm(s).split(/\s+/).map((t) => t.replace(/^[.,]+|[.,]+$/g, '')).filter((t) => t.length >= 2 && !STOP.has(t));

// stato: 'da_fare' | 'fatto' | 'nuovo' (i tre stati dichiarati dal modulo). Ritorna al massimo 6 voci, le più somiglianti per prime.
function trova(user, cerca, stato) {
  const { rows } = require('./reports');
  const scope = require('./telegram').scopeFor(user);
  const toks = tokens(cerca).filter((t) => !/^\d+([.,]\d+)?$/.test(t));
  const importi = (String(cerca).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.'))).filter((n) => Number.isFinite(n));
  const out = [];
  for (const m of moduliDichiarati(scope)) {
    const S = m.avvisi.states; if (!S[stato]) continue;
    const R = { stato: '_stato', ...m.roles };
    for (const { id, data: d } of rows(m.module_slug, scope)) {
      if (d[R.stato] !== S[stato]) continue;
      const desc = String(d[R.descrizione || 'descrizione'] || '');
      const nd = norm(desc);
      const imp = Number(d[R.importo || 'importo']) || 0;
      let score = toks.filter((t) => nd.includes(t)).length;
      if (importi.some((n) => Math.abs(n - imp) < 0.005)) score += 2;
      if (score === 0) continue;
      if (toks.length > 1 && !importi.length && score < Math.ceil(toks.length / 2)) continue; // frase lunga: almeno metà delle parole devono comparire
      out.push({ slug: m.module_slug, id, descrizione: desc.trim() || '(senza descrizione)', importo: imp, due: String(d[R.scadenza || 'scadenza'] || d[R.data || 'data'] || '').slice(0, 10), label: m.avvisi.label || String(m.name || m.module_slug).toLowerCase(), score });
    }
  }
  return out.sort((a, b) => b.score - a.score || (a.due || '').localeCompare(b.due || '')).slice(0, MAX_CANDIDATI);
}
function moduliDichiarati(scope) { return moduleRoles.list({ use: 'avvisi' }).filter((m) => scope.slugs.has(m.module_slug)); }
const voce = (c) => '<b>' + esc(c.descrizione) + '</b> — ' + eur(c.importo) + (c.due ? ' · ' + shortDate(c.due) : '') + ' (' + esc(c.label) + ')';
const btn = (text, data) => ({ text, callback_data: data });

// ── segnare pagata / riaprire ────────────────────────────────────────────────────────────────────────────────────────────
// Usata sia dai bottoni «Pagata/Annulla» dei report sia dalle frasi. Ritorna { ok, msg, desc }.
function cambiaStato(user, slug, id, azione) {
  const { visibleSlugsFor } = require('./routes/modules');
  if (!visibleSlugsFor(user).includes(slug)) return { ok: false, msg: 'Non hai accesso a questo modulo.' };
  const decl = moduleRoles.get(slug);
  const S = decl && decl.avvisi && decl.avvisi.states;
  if (!S || !S.da_fare || !S.fatto) return { ok: false, msg: 'Questo modulo non ha stati «da pagare» e «pagato».' };
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!row) return { ok: false, msg: 'Voce non trovata (forse è stata eliminata).' };
  const R = { stato: '_stato', ...decl.roles };
  const d = JSON.parse(row.data), stato = d[R.stato], desc = String(d[R.descrizione || 'descrizione'] || 'voce');
  const target = azione === 'pay' ? S.fatto : S.da_fare;
  if (stato === target) return { ok: true, already: true, desc, msg: azione === 'pay' ? 'Era già segnata come pagata.' : 'Era già «da pagare».' };
  if (stato !== (azione === 'pay' ? S.da_fare : S.fatto)) return { ok: false, desc, msg: 'Questa voce non è più «' + String(azione === 'pay' ? S.da_fare : S.fatto).replace(/_/g, ' ') + '».' };
  const out = require('./routes/records').runTransition(user, slug, id, target);
  if (out.status !== 200) return { ok: false, desc, msg: out.status === 422 ? (azione === 'undo' || azione === 'reopen' ? 'Da qui non si può annullare: fallo dall\'app.' : 'Non si può segnare pagata da questo stato.') : (out.body.error || 'Non riuscito.') };
  logAudit(user.username, 'telegram.' + (azione === 'pay' ? 'pay' : 'undo'), slug + '#' + id, { via: 'bot' });
  return { ok: true, desc, msg: azione === 'pay' ? '✅ Segnata pagata: ' + desc : azione === 'undo' ? '↩ Annullato: ' + desc : '↩ Rimessa «da pagare»: ' + desc };
}

// ── proposte ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ritorna { html, keyboard? }. Mai una scrittura: descrive cosa farebbe e aspetta il tocco.
function proponi(user, intent, chatId) {
  if (intent.azione === 'segna_pagata' || intent.azione === 'riapri') return proponiStato(user, intent, chatId);
  if (intent.azione === 'smista') return proponiSmista(user, intent, chatId);
  if (intent.azione === 'nuova_spesa') return proponiSpesa(user, intent, chatId);
  return { html: 'Non so ancora farlo. Scrivimi /aiuto per vedere cosa posso fare.' };
}

function scelta(chatId, user, azione, titolo, cands, extra) {
  const id = savePending(chatId, user.id, { tipo: 'scelta', azione, extra: extra || {}, candidati: cands.map((c) => ({ slug: c.slug, id: c.id, descrizione: c.descrizione })) });
  const kb = cands.map((c, i) => [btn((azione === 'pay' ? '✅ ' : azione === 'reopen' ? '↩ ' : '📥 ') + tronca(c.descrizione, 24) + ' · ' + eur(c.importo) + (c.due ? ' · ' + shortDate(c.due) : ''), 'pk:' + id + ':' + i)]);
  kb.push([btn('✖ Nessuna', 'no:' + id)]);
  return { html: titolo + '\n\n' + cands.map((c) => '• ' + voce(c)).join('\n'), keyboard: kb };
}

function proponiStato(user, intent, chatId) {
  const pay = intent.azione === 'segna_pagata', azione = pay ? 'pay' : 'reopen';
  const cands = trova(user, intent.cerca, pay ? 'da_fare' : 'fatto');
  if (!cands.length) {
    const altro = trova(user, intent.cerca, pay ? 'fatto' : 'da_fare');
    if (altro.length) return { html: pay ? '«' + esc(altro[0].descrizione) + '» risulta <b>già pagata</b>. Se vuoi rimetterla da pagare scrivimi «riapri ' + esc(altro[0].descrizione) + '».' : '«' + esc(altro[0].descrizione) + '» è già «da pagare».' };
    if (pay) { const nuova = trova(user, intent.cerca, 'nuovo'); if (nuova.length) return { html: '«' + esc(nuova[0].descrizione) + '» è ancora <b>da smistare</b>: prima va smistata (scrivimi «smista ' + esc(nuova[0].descrizione) + '»).' }; }
    return { html: 'Non trovo nessuna voce che somigli a «' + esc(intent.cerca) + '». Prova con /scadute o /pagare per vederle.' };
  }
  if (cands.length > 1) return scelta(chatId, user, azione, pay ? 'Quale vuoi segnare pagata?' : 'Quale vuoi rimettere da pagare?', cands);
  const c = cands[0];
  const id = savePending(chatId, user.id, { tipo: azione, slug: c.slug, id: c.id, descrizione: c.descrizione });
  return { html: (pay ? 'Segno come <b>pagata</b>:' : 'Rimetto <b>da pagare</b>:') + '\n' + voce(c), keyboard: [[btn(pay ? '✅ Sì, pagata' : '↩ Sì, riapri', 'ok:' + id), btn('✖ No', 'no:' + id)]] };
}

function descriviSmista(c, p) {
  if (p.modo === 'rate') return 'in <b>' + p.n_rate + ' rate</b>' + (p.importo || c.importo ? ' da ' + eur(Math.round(((p.importo || c.importo) / p.n_rate) * 100) / 100) : '') + (p.scadenza || c.due ? ', dal ' + shortDate(p.scadenza || c.due) : '');
  if (p.modo === 'pagata') return 'come <b>già pagata</b> (oggi)';
  return 'come <b>un pagamento</b>' + (p.scadenza ? ', scade il ' + shortDate(p.scadenza) : '');
}
function proponiSmista(user, intent, chatId) {
  if (intent.modo === 'rate' && !intent.n_rate) return { html: 'In quante rate? Scrivimi per esempio «smista ' + esc(intent.cerca) + ' in 3 rate».' };
  const cands = trova(user, intent.cerca, 'nuovo');
  if (!cands.length) return { html: 'Non trovo nessuna bolletta da smistare che somigli a «' + esc(intent.cerca) + '». Scrivimi /smistare per vedere quelle in coda.' };
  const p = { modo: intent.modo, n_rate: intent.n_rate, importo: intent.importo, scadenza: intent.scadenza };
  if (cands.length > 1) return scelta(chatId, user, 'smista', 'Quale bolletta vuoi smistare?', cands, p);
  const c = cands[0];
  const id = savePending(chatId, user.id, { tipo: 'smista', slug: c.slug, id: c.id, descrizione: c.descrizione, ...p });
  return { html: 'Smisto ' + descriviSmista(c, p) + ':\n' + voce(c) + (p.importo != null ? '\nImporto corretto a ' + eur(p.importo) : ''), keyboard: [[btn('✅ Conferma', 'ok:' + id), btn('✖ Annulla', 'no:' + id)]] };
}

function costruisciSpesa(m, intent) {
  const decl = m.decl, R = { stato: '_stato', ...decl.roles }, S = decl.avvisi.states, data = intent.data || oggiRoma();
  const d = {};
  d[R.descrizione || 'descrizione'] = intent.descrizione; d[R.importo || 'importo'] = intent.importo; d[R.data || 'data'] = data;
  const pagata = intent.pagata && S.fatto;
  d[R.stato] = pagata ? S.fatto : (S.da_fare || S.nuovo);
  if (pagata && R.data_pagamento) d[R.data_pagamento] = data;
  if (!pagata && R.scadenza) d[R.scadenza] = data;
  if (intent.categoria && R.categoria) d[R.categoria] = intent.categoria;
  return d;
}
function riepilogoSpesa(m, intent, d) {
  const R = { stato: '_stato', ...m.decl.roles };
  return 'Aggiungo in <b>' + esc(m.name) + '</b>:\n• <b>' + esc(intent.descrizione) + '</b> — ' + eur(intent.importo) + '\n• ' + shortDate(d[R.data || 'data']) + ' · ' + (intent.pagata ? '<b>già pagata</b>' : '<b>da pagare</b>' + (R.scadenza ? ' (scade lo stesso giorno)' : '')) + (intent.categoria ? '\n• categoria ' + esc(intent.categoria) : '');
}
function proponiSpesa(user, intent, chatId) {
  const mods = moduliPerUtente(user);
  if (!mods.length) return { html: 'Non hai moduli di spesa a cui possa aggiungere.' };
  const m = (intent.modulo && mods.find((x) => x.slug === intent.modulo)) || (mods.length === 1 ? mods[0] : null);
  if (!m) {
    const id = savePending(chatId, user.id, { tipo: 'scelta_modulo', intent });
    return { html: 'Dove la aggiungo? <b>' + esc(intent.descrizione) + '</b> — ' + eur(intent.importo), keyboard: [mods.map((x, i) => btn(x.name, 'pk:' + id + ':' + i)), [btn('✖ Annulla', 'no:' + id)]] };
  }
  return confermaSpesa(user, intent, m, chatId);
}
function confermaSpesa(user, intent, m, chatId) {
  // la categoria dell'AI vale solo se è del modulo scelto
  const intentOk = { ...intent, categoria: intent.categoria && m.categorie.includes(intent.categoria) ? intent.categoria : null };
  const d = costruisciSpesa(m, intentOk);
  const id = savePending(chatId, user.id, { tipo: 'spesa', slug: m.slug, nome: m.name, data: d, descrizione: intent.descrizione });
  return { html: riepilogoSpesa(m, intentOk, d), keyboard: [[btn('✅ Aggiungi', 'ok:' + id), btn('✖ Annulla', 'no:' + id)]] };
}

// ── esecuzione dopo il tocco ─────────────────────────────────────────────────────────────────────────────────────────────
// `fileFn(file_id)` scarica un file da Telegram (serve all'importazione). Ritorna { html }.
async function esegui(user, a, { fileFn } = {}) {
  if (a.tipo === 'pay' || a.tipo === 'reopen') { const r = cambiaStato(user, a.slug, a.id, a.tipo); return { html: (r.ok ? '' : '⚠ ') + esc(r.msg) }; }
  if (a.tipo === 'smista') {
    const body = { modo: a.modo };
    if (a.importo != null) body.importo = a.importo; if (a.scadenza) body.scadenza = a.scadenza; if (a.modo === 'rate') body.n_rate = a.n_rate;
    const r = await callAs(user, 'POST', '/smista/' + a.slug + '/' + a.id, body);
    if (!r.ok) return { html: '⚠ ' + esc((r.data && r.data.error) || 'Non sono riuscito a smistarla.') };
    logAudit(user.username, 'telegram.smista', a.slug + '#' + a.id, { modo: a.modo });
    return { html: '✅ ' + esc((r.data && r.data.message) || 'Smistata.') };
  }
  if (a.tipo === 'spesa') {
    const r = await callAs(user, 'POST', '/records/' + a.slug, a.data);
    if (!r.ok) return { html: '⚠ Non sono riuscito ad aggiungerla: ' + esc((r.data && (r.data.error || (r.data.errors || []).join('; '))) || 'errore') };
    logAudit(user.username, 'telegram.nuova_spesa', a.slug + '#' + (r.data && r.data.id), { via: 'bot' });
    return { html: '✅ Aggiunta in <b>' + esc(a.nome) + '</b>: ' + esc(a.descrizione) };
  }
  if (a.tipo === 'import') {
    if (!fileFn) return { html: '⚠ File non disponibile.' };
    const f = await fileFn(a.file_id);
    if (!f.ok) return { html: '⚠ ' + esc(f.error) };
    const r = await callAs(user, 'POST', '/ai/import/' + a.slug + '/crea', { filename: a.filename, base64: f.base64, campi: a.campi });
    if (!r.ok) return { html: '⚠ ' + esc((r.data && r.data.error) || 'Importazione non riuscita.') };
    logAudit(user.username, 'telegram.import', a.slug + '#' + (r.data && r.data.id), { file: a.filename });
    return { html: '✅ ' + esc((r.data && r.data.message) || 'Riga creata.') };
  }
  return { html: '⚠ Azione non riconosciuta.' };
}

// Il tocco su un elemento di una scelta (pk) o su un bottone di conferma (ok): ritorna { html, keyboard? } o { html } finale.
async function tocca(user, chatId, kind, id, indice, ctx) {
  if (kind === 'no') { takePending(id, chatId, user.id); return { html: 'Annullato.' }; }
  const a = kind === 'pk' ? peekPending(id, chatId, user.id) : takePending(id, chatId, user.id);
  if (!a) return { html: 'Questa proposta è scaduta o è già stata usata.', scaduta: true };
  if (kind === 'ok') return esegui(user, a, ctx);
  // pk: scelta di un candidato / di un modulo
  const i = parseInt(indice, 10);
  if (a.tipo === 'scelta_modulo') {
    const mods = moduliPerUtente(user); const m = mods[i];
    takePending(id, chatId, user.id);
    return m ? confermaSpesa(user, a.intent, m, chatId) : { html: 'Scelta non valida.' };
  }
  if (a.tipo === 'scelta' && Number.isInteger(i) && a.candidati[i]) {
    takePending(id, chatId, user.id); // il tocco su una voce È la conferma
    const c = a.candidati[i];
    if (a.azione === 'smista') return esegui(user, { tipo: 'smista', slug: c.slug, id: c.id, descrizione: c.descrizione, ...a.extra }, ctx);
    return esegui(user, { tipo: a.azione, slug: c.slug, id: c.id, descrizione: c.descrizione }, ctx);
  }
  return { html: 'Scelta non valida.' };
}

// ── importare un PDF mandato in chat ────────────────────────────────────────────────────────────────────────────────────
function moduliImport(user) { return moduliPerUtente(user).filter((m) => moduleAi.can(m.slug, 'import')); }
async function proponiImport(user, chatId, doc, fileFn, slug) {
  const f = await fileFn(doc.file_id);
  if (!f.ok) return { html: '⚠ ' + esc(f.error) };
  const nome = String(doc.file_name || 'documento.pdf');
  const r = await callAs(user, 'POST', '/ai/import/' + slug + '/proposta', { filename: nome, base64: f.base64 });
  if (!r.ok) return { html: '⚠ ' + esc((r.data && r.data.error) || 'Non riesco a leggere il PDF.') };
  const p = r.data.proposta || {};
  const campi = { descrizione: p.fornitore || nome.replace(/\.pdf$/i, ''), importo: p.importo != null ? Number(p.importo) : 0, scadenza: p.scadenza || undefined, categoria: p.categoria || undefined };
  const m = moduliPerUtente(user).find((x) => x.slug === slug);
  const id = savePending(chatId, user.id, { tipo: 'import', slug, file_id: doc.file_id, filename: nome, campi });
  return {
    html: '✨ Ho letto il PDF <b>' + esc(nome) + '</b>:\n• ' + esc(campi.descrizione) + '\n• importo ' + (campi.importo ? eur(campi.importo) : '<b>da verificare</b>') + (campi.scadenza ? '\n• scade il ' + shortDate(campi.scadenza) : '') + (campi.categoria ? '\n• categoria ' + esc(campi.categoria) : '') + (p.confidenza ? '\n• sicurezza: ' + esc(p.confidenza) : '')
      + '\n\nLo aggiungo in <b>' + esc(m ? m.name : slug) + '</b> come «da smistare», con il PDF allegato. Controlla i dati sul documento.',
    keyboard: [[btn('✅ Aggiungi', 'ok:' + id), btn('✖ Annulla', 'no:' + id)]],
  };
}
async function importaDocumento(user, chatId, doc, fileFn) {
  if (!doc) return { html: 'Per ora leggo solo i <b>PDF</b> (bollette e fatture). Mandami il file come PDF.' };
  const nome = String(doc.file_name || '');
  if (!(doc.mime_type === 'application/pdf' || /\.pdf$/i.test(nome))) return { html: 'Per ora leggo solo i <b>PDF</b>.' };
  if (doc.file_size && doc.file_size > MAX_PDF) return { html: 'Il PDF è troppo grande (massimo 3 MB).' };
  if (!moduleAi.masterOn()) return { html: 'L\'AI non è accesa (Impostazioni → AI): non posso leggere il PDF.' };
  const mods = moduliImport(user);
  if (!mods.length) return { html: 'L\'importazione da PDF non è accesa su nessuno dei tuoi moduli (Builder → Potenziamenti AI → Importare).' };
  if (mods.length === 1) return proponiImport(user, chatId, doc, fileFn, mods[0].slug);
  const id = savePending(chatId, user.id, { tipo: 'import_modulo', doc: { file_id: doc.file_id, file_name: nome }, slugs: mods.map((m) => m.slug) });
  return { html: 'Dove lo importo?', keyboard: [mods.map((m, i) => btn(m.name, 'im:' + id + ':' + i)), [btn('✖ Annulla', 'no:' + id)]] };
}
async function scegliModuloImport(user, chatId, id, indice, fileFn) {
  const a = takePending(id, chatId, user.id);
  if (!a || a.tipo !== 'import_modulo') return { html: 'Questa proposta è scaduta o è già stata usata.' };
  const slug = a.slugs[parseInt(indice, 10)];
  if (!slug) return { html: 'Scelta non valida.' };
  return proponiImport(user, chatId, a.doc, fileFn, slug);
}

module.exports = { proponi, tocca, esegui, cambiaStato, importaDocumento, scegliModuloImport, trova, tokens, savePending, takePending, peekPending, MAX_PDF };
