'use strict';
// Richieste di firma (vedi lib/richieste-firma.js):
//   GET    /api/firma/:slug/:id/richieste            (admin)  le richieste di quel record con lo stato
//   POST   /api/firma/:slug/:id/richieste            (admin)  { documenti?: [chiavi], link_base } → prepara i documenti (testo congelato) e manda l'email col link
//   POST   /api/firma/richieste/:rid/sollecita       (admin)  rimanda l'email di sollecito
//   DELETE /api/firma/richieste/:rid                 (admin)  annulla una richiesta in attesa
//   GET    /api/public-firma/:token                  (pubblica) cosa c'è da firmare (solo nome dell'agenzia, documenti e consensi)
//   GET    /api/public-firma/:token/pdf/:key         (pubblica) il PDF di un documento
//   POST   /api/public-firma/:token/codice           (pubblica) { consensi, autenticazione: 'email'|'sms' } → firma con codice (eSignature), un PDF con tutti i documenti
//   POST   /api/public-firma/:token/controlla        (pubblica) ricontrolla la firma con codice: se completa, chiude
//   POST   /api/public-firma/:token                  (pubblica, multipart) file firmati `file_<chiave>` e `consensi` (JSON {chiave:{campo:true}})
// Il destinatario lo ricava SEMPRE il server dal record (mai dalla richiesta).
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireAdmin, requireModuleAccess } = require('./auth');
const { logAudit } = require('../audit-log');
const firma = require('../lib/richieste-firma');

// Se nessun documento dice a chi va (`recipient`), si usa il campo email del record: quello chiamato «email», altrimenti il primo campo di tipo email compilato.
function indirizzoDelRecord(schema, record) {
  let dati = {}; try { dati = JSON.parse(record.data); } catch (e) { return null; }
  const campi = (schema.fields || []).filter((f) => f.type === 'email' && typeof dati[f.key] === 'string' && dati[f.key].trim());
  const f = campi.find((x) => x.key === 'email') || campi[0];
  return f ? dati[f.key].trim() : null;
}
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
const admin = express.Router();

// I documenti «da firmare» del modulo: le azioni documento con delivery 'firma'.
admin.get('/:slug/:id/richieste', requireAuth, requireAdmin, requireModuleAccess, (req, res) => res.json(firma.elenco(req.params.slug, Number(req.params.id))));

admin.post('/:slug/:id/richieste', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  try {
    const records = require('./records'), { renderModello, risolviDestinatario } = require('../lib/modello-documento');
    const { slug, id } = req.params;
    const tutte = ((records.getModuleSchema(slug) || {}).document_actions || []).filter((a) => a.delivery === 'firma' && !a.archiviato);
    const scelte = Array.isArray(req.body && req.body.documenti) && req.body.documenti.length ? tutte.filter((a) => req.body.documenti.includes(a.key)) : tutte;
    if (!scelte.length) return res.status(400).json({ error: 'Questo modulo non ha documenti da far firmare.' });
    const firmatari = []; const documenti = [];
    for (const a of scelte) {
      const ctx = records.contestoDocumentoDa(slug, id, a.key, req.user);
      if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
      // Chi firma: l'elenco `recipients` del documento (proprietario e comproprietari, cedente e cessionario…), altrimenti il `recipient`, altrimenti il campo email del record.
      // Nome e telefono si cercano accanto all'email: «proprietario.email» → «proprietario.nome» e «proprietario.telefono»; «email» → «nome» e «telefono».
      const percorsi = Array.isArray(a.recipients) && a.recipients.length ? a.recipients : (a.recipient ? [a.recipient] : []);
      for (const pc of percorsi) {
        const email = risolviDestinatario(pc, ctx.get); if (!email) continue;
        const prefisso = pc.includes('.') ? pc.slice(0, pc.lastIndexOf('.') + 1) : '';
        const nome = risolviDestinatario(prefisso + 'nome', ctx.get), tel = risolviDestinatario(prefisso + 'telefono', ctx.get);
        firmatari.push({ email, nome, telefono: tel });
      }
      if (!percorsi.length) { const e = indirizzoDelRecord(ctx.schema, ctx.record); if (e) firmatari.push({ email: e, nome: risolviDestinatario('nome', ctx.get), telefono: risolviDestinatario('telefono', ctx.get) }); }
      documenti.push({ key: a.key, label: a.label || a.key, corpo: renderModello(a.body, ctx.get), consensi: (a.consents || []).map((c) => ({ field: c.field, label: c.label })) });
    }
    const out = await firma.inviaGruppo({ slug, id: Number(id), documenti, firmatari, utente: req.user.username, linkBase: String((req.body && req.body.link_base) || '').replace(/\/+$/, ''), canali: Array.isArray(req.body && req.body.canali) ? req.body.canali : [] });
    logAudit(req.user.username, 'firma.richiesta', slug + '#' + id, { documenti: documenti.map((d) => d.key), email: out.inviati.map((x) => x.destinatario) });
    // Come per l'invio per email: lo stato «documenti inviati» (`on_send_state`) scatta alla partenza, se il flusso lo ammette da dove il record si trova.
    const stato = scelte.map((a) => a.on_send_state).find(Boolean);
    const statoAggiornato = stato ? records.runTransition(req.user, slug, id, stato).status === 200 : false;
    res.json({ ok: true, ...out, id: out.inviati[0].id, destinatario: out.inviati.map((x) => x.destinatario).join(', '), stato_aggiornato: statoAggiornato });
  } catch (e) { fail(res, e); }
});
// Cosa si può usare oltre alla mail: l'SMS c'è se il mittente è impostato e il servizio è attivo (con il prezzo di un SMS, se noto); WhatsApp c'è sempre (collegamento wa.me, senza costi).
admin.get('/capacita', requireAuth, requireAdmin, async (req, res) => {
  try { const c = await require('../lib/messaggi-clienti').canaliDisponibili(); res.json({ sms: { ok: !!c.sms.ok, motivo: c.sms.motivo || null, prezzo: require('../lib/openapi-spese').prezzo('sms_italia') }, whatsapp: { ok: true } }); } catch (e) { fail(res, e); }
});
admin.get('/richieste/:rid/whatsapp', requireAuth, requireAdmin, (req, res) => { try { res.json(firma.whatsappDi(Number(req.params.rid))); } catch (e) { fail(res, e); } });
admin.post('/richieste/:rid/sollecita', requireAuth, requireAdmin, async (req, res) => { try { res.json(await firma.sollecita(Number(req.params.rid))); } catch (e) { fail(res, e); } });
admin.delete('/richieste/:rid', requireAuth, requireAdmin, (req, res) => {
  if (!firma.annulla(Number(req.params.rid))) return res.status(404).json({ error: 'Richiesta non trovata o già conclusa.' });
  logAudit(req.user.username, 'firma.annulla', String(req.params.rid), null);
  res.json({ ok: true });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 12 } });
const pubblico = express.Router();
pubblico.get('/:token', async (req, res) => { try { const p = await firma.pubblica(req.params.token); res.status(p.valido ? 200 : 410).json(p); } catch (e) { fail(res, e); } });
pubblico.get('/:token/pdf/:key', async (req, res) => {
  try {
    const f = await firma.pdf(req.params.token, req.params.key);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + f.nome + '"', 'Cache-Control': 'no-store' });
    res.send(f.buffer);
  } catch (e) { fail(res, e); }
});
pubblico.post('/:token', upload.any(), async (req, res) => {
  try {
    const file = {};
    for (const f of req.files || []) { const m = /^file_(.+)$/.exec(f.fieldname); if (m) file[m[1]] = { buffer: f.buffer, nome: String(f.originalname || '').slice(0, 120), mime: f.mimetype }; }
    let consensi = {}; try { consensi = JSON.parse((req.body && req.body.consensi) || '{}'); } catch (e) { /* senza consensi */ }
    res.json(await firma.completa(req.params.token, { file, consensi, ip: req.ip }));
  } catch (e) { fail(res, e); }
});

// Firma con codice: parte la richiesta a eSignature (un PDF, un codice); la pagina poi ricontrolla con «controlla» (e comunque lo fa il server ogni 5 minuti).
pubblico.post('/:token/codice', async (req, res) => {
  try { res.json(await firma.avviaCodice(req.params.token, { consensi: (req.body && req.body.consensi) || {}, autenticazione: req.body && req.body.autenticazione, ip: req.ip })); } catch (e) { fail(res, e); }
});
pubblico.post('/:token/controlla', async (req, res) => { try { res.json(await firma.controllaDaPagina(req.params.token)); } catch (e) { fail(res, e); } });

module.exports = { admin, pubblico };
