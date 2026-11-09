'use strict';
// La guida d'uso: i testi che i pacchetti di verticale attivi portano con sé (parte `guida`: introduzione, passi per ruolo, un capitolo per modulo, flussi, glossario).
// Qui solo i testi, uniti tra i pacchetti attivi; elenco di campi, passaggi e documenti di un modulo li ricava la scheda dagli schemi (sempre allineati). Nessun nome di settore.
const express = require('express');
const { requireAuth } = require('./auth');
const db = require('../db');
const seeds = require('../seed-blocchi-verticale');

const router = express.Router();

// Un passo del giro guidato: `pagina` (una pagina dell'app o lo slug di un modulo), `titolo` e `testo` sono obbligatori; `target` (cosa evidenziare)
// se manca è la voce di menu della pagina; `ruoli` (facoltativo) limita il passo a quei ruoli.
const passoValido = (p) => p && typeof p.pagina === 'string' && p.pagina && typeof p.titolo === 'string' && p.titolo && typeof p.testo === 'string' && p.testo;

// La guida scritta per questo tenant (generata dai moduli e rifinita a mano) viene prima di quella dei pacchetti: ciò che il tenant ha scritto vince, il resto lo completano i pacchetti.
function guidaDelTenant() {
  const r = db.prepare('SELECT contenuto FROM guida_tenant WHERE id = 1').get();
  if (!r) return {};
  try { return JSON.parse(r.contenuto) || {}; } catch (e) { return {}; }
}

function unisci(pacchetti) {
  const out = { introduzione: null, per_ruolo: {}, capitoli: {}, flussi: [], glossario: [], giro: [] };
  const t = guidaDelTenant();
  if (t.introduzione) out.introduzione = t.introduzione;
  for (const [k, v] of Object.entries(t.per_ruolo || {})) out.per_ruolo[k] = v;
  for (const [k, v] of Object.entries(t.capitoli || {})) out.capitoli[k] = v;
  if (Array.isArray(t.flussi)) out.flussi.push(...t.flussi);
  if (Array.isArray(t.glossario)) out.glossario.push(...t.glossario);
  if (Array.isArray(t.giro)) out.giro.push(...t.giro.filter(passoValido));
  for (const slug of pacchetti) {
    const g = seeds.leggiPacchetto(slug).guida || {};
    if (!out.introduzione && g.introduzione) out.introduzione = g.introduzione;
    for (const [k, v] of Object.entries(g.per_ruolo || {})) if (!k.startsWith('_') && !out.per_ruolo[k]) out.per_ruolo[k] = v;
    for (const [k, v] of Object.entries(g.capitoli || {})) if (!k.startsWith('_') && !out.capitoli[k]) out.capitoli[k] = v;
    if (Array.isArray(g.flussi)) out.flussi.push(...g.flussi);
    if (Array.isArray(g.glossario)) out.glossario.push(...g.glossario);
    if (Array.isArray(g.giro)) out.giro.push(...g.giro.filter(passoValido));
  }
  return out;
}

router.get('/', requireAuth, (req, res) => {
  const g = unisci(seeds.pacchettiAttivi());
  const vuota = !g.introduzione && !Object.keys(g.capitoli).length && !g.flussi.length && !g.glossario.length && !g.giro.length;
  res.json({ presente: !vuota, ...g });
});

// Il giro guidato di chi guarda: i passi per il suo ruolo e se partire da solo (mai visto, e niente Primi passi davanti). Parte anche a richiesta dalla Guida.
//   GET  /api/guida/giro        { passi: [{ pagina, target?, titolo, testo }], mostra }
//   POST /api/guida/giro/visto  segna il giro come visto (concluso o saltato): non riparte da solo
router.get('/giro', requireAuth, (req, res) => {
  const passi = unisci(seeds.pacchettiAttivi()).giro.filter((p) => !Array.isArray(p.ruoli) || !p.ruoli.length || p.ruoli.includes(req.user.role));
  const riga = db.prepare('SELECT giro_visto_at FROM users WHERE id = ?').get(req.user.id) || {};
  const primiPassi = req.user.role === 'admin' && require('./setup-wizard').daMostrare();
  res.json({ passi, mostra: passi.length > 0 && !riga.giro_visto_at && !primiPassi });
});
router.post('/giro/visto', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET giro_visto_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

// La guida del tenant: si genera dai moduli, si legge e si corregge a mano (solo amministratori).
//   GET    /api/guida/tenant   il contenuto salvato (o null)
//   POST   /api/guida/genera   la scrive dalla struttura dei moduli (sostituisce ciò che c'è; con { solo_se_vuota: true } non tocca una guida già scritta)
//   PUT    /api/guida/tenant   salva il contenuto modificato a mano
//   DELETE /api/guida/tenant   toglie la guida del tenant (restano quelle dei pacchetti)
const { requireAdmin } = require('./auth');
const salva = (contenuto) => db.prepare("INSERT INTO guida_tenant (id, contenuto) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET contenuto = excluded.contenuto, modificata_il = CURRENT_TIMESTAMP").run(JSON.stringify(contenuto));
router.get('/tenant', requireAuth, requireAdmin, (req, res) => { const r = db.prepare('SELECT contenuto, generata_il, modificata_il FROM guida_tenant WHERE id = 1').get(); res.json(r ? { contenuto: JSON.parse(r.contenuto), generata_il: r.generata_il, modificata_il: r.modificata_il } : { contenuto: null }); });
router.post('/genera', requireAuth, requireAdmin, (req, res) => {
  if (req.body && req.body.solo_se_vuota && db.prepare('SELECT 1 FROM guida_tenant WHERE id = 1').get()) return res.json({ ok: true, saltata: true });
  const g = require('../lib/guida-generata').genera(); salva(g);
  res.json({ ok: true, capitoli: Object.keys(g.capitoli).length, flussi: g.flussi.length, passi_giro: g.giro.length });
});
router.put('/tenant', requireAuth, requireAdmin, (req, res) => {
  const c = req.body && req.body.contenuto;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return res.status(400).json({ error: 'Contenuto non valido.' });
  const pulito = { introduzione: c.introduzione || null, per_ruolo: c.per_ruolo || {}, capitoli: c.capitoli || {}, flussi: Array.isArray(c.flussi) ? c.flussi : [], glossario: Array.isArray(c.glossario) ? c.glossario : [], giro: (Array.isArray(c.giro) ? c.giro : []).filter(passoValido) };
  salva(pulito); res.json({ ok: true });
});
router.delete('/tenant', requireAuth, requireAdmin, (req, res) => { db.prepare('DELETE FROM guida_tenant WHERE id = 1').run(); res.json({ ok: true }); });

module.exports = router;
module.exports.unisci = unisci;
