const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { parseSchemaNormalized } = require('../schema-v3');
const getModuleSchema = (slug) => { const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug); return m ? parseSchemaNormalized(m.schema_json) : null; };
const msg = require('../lib/messaggi-clienti');

// Messaggi ai clienti (auguri di compleanno, invio di massa): impostazioni, registro e invio di massa. Solo amministratori: un invio parla a nome dell'azienda e spende.
const router = express.Router();

router.get('/impostazioni', requireAuth, requireAdmin, async (req, res) => {
  const disp = await msg.canaliDisponibili();
  res.json({ ...msg.impostazioni(), canali: disp, inviati_oggi: msg.inviatiOggi() });
});
router.put('/impostazioni', requireAuth, requireAdmin, (req, res) => {
  const r = msg.salvaImpostazioni(req.body || {});
  if (r.errore) return res.status(400).json({ error: r.errore });
  logAudit(req.user.username, 'messaggi.impostazioni', 'messaggi', { auguri_attivi: msg.impostazioni().auguri.attivi });
  res.json({ ok: true, ...msg.impostazioni() });
});
router.get('/registro', requireAuth, requireAdmin, (req, res) => res.json(msg.registroRecente(Math.min(200, Number(req.query.limite) || 50))));
// Prova degli auguri di oggi, a mano (stessa logica del controllo automatico: rispetta consenso, tetto e «già inviato quest'anno»).
router.post('/auguri/esegui-ora', requireAuth, requireAdmin, async (req, res) => {
  const r = await msg.eseguiAuguri();
  logAudit(req.user.username, 'messaggi.auguri_ora', 'messaggi', r);
  res.json(r);
});

// Invio di massa. `anteprima: true` non spedisce: dice chi riceverebbe cosa, chi è saltato e perché, quanti SMS e il costo. Senza `conferma: true` non parte niente (la conferma la chiede il server).
// I destinatari sono gli `ids` passati (il frontend manda i record della lista filtrata); il consenso si controlla qui, per ognuno.
router.post('/:slug/massivo/:key', requireAuth, requireAdmin, async (req, res) => {
  const schema = getModuleSchema(req.params.slug);
  const cfg = schema && (schema.external_actions || []).find((x) => x.key === req.params.key && x.adapter === 'messaggio_cliente');
  if (!cfg) return res.status(404).json({ error: 'Azione non trovata in questo modulo' });
  const b = req.body || {};
  const canali = (Array.isArray(b.canali) ? b.canali : []).filter((c) => ['mail', 'sms'].includes(c));
  if (!canali.length) return res.status(400).json({ error: 'Scegli almeno un canale (mail o SMS).' });
  const testo = String(b.testo || '').trim(), oggetto = String(b.oggetto || '').trim();
  if (!testo) return res.status(400).json({ error: 'Scrivi il testo del messaggio.' });
  if (canali.includes('mail') && !oggetto) return res.status(400).json({ error: 'Scrivi l\'oggetto della mail.' });
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 5000);
  if (!ids.length) return res.status(400).json({ error: 'Nessun destinatario.' });
  const rows = db.prepare('SELECT id, data FROM records WHERE module_slug = ? AND id IN (' + ids.map(() => '?').join(',') + ')').all(req.params.slug, ...ids).map((r) => ({ id: r.id, data: JSON.parse(r.data || '{}') }));
  const prep = await msg.prepara({ records: rows, config: cfg, canali, testoSms: msg.riempi(testo, {}, cfg.campi || {}) });
  const riepilogo = { destinatari: rows.length, pronti: prep.pronti.length, mail: prep.mail, sms: prep.sms, costo_sms: prep.costo_sms, segmenti_sms: prep.segmenti_sms, canali: prep.canali, saltati: prep.saltati.length, saltati_motivi: [...new Set(prep.saltati.map((s) => s.motivo))],
    tetto_giornaliero: msg.impostazioni().tetto_giornaliero, gia_inviati_oggi: msg.inviatiOggi(),
    esempio: prep.pronti.length ? { nome: prep.pronti[0].record.data[(cfg.campi || {}).nome], testo: msg.riempi(testo, prep.pronti[0].record.data, cfg.campi || {}) } : null };
  if (b.anteprima || b.conferma !== true) return res.json({ anteprima: true, ...riepilogo, conferma_richiesta: true });
  if (!prep.pronti.length) return res.status(400).json({ error: 'Nessun destinatario può ricevere il messaggio (consenso o contatti mancanti).', ...riepilogo });
  const esiti = await msg.spedisci({ pronti: prep.pronti, config: cfg, tipo: 'massivo', modulo: req.params.slug, oggetto, testoMail: testo, testoSms: testo, utente: req.user.username });
  logAudit(req.user.username, 'messaggi.massivo', req.params.slug + ':' + req.params.key, { ...esiti, destinatari: rows.length });
  res.json({ ok: true, ...riepilogo, ...esiti });
});

module.exports = router;
