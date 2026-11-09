// CONTROLLO DI COERENZA DEGLI SCHEMI: dati dei moduli (come stanno nel database di un tenant, o bozze appena generate) controlla che tutto ciò che dichiarano stia in piedi da solo:
// flussi, requisiti, relazioni, automazioni, documenti, viste, ruoli. Funzione pura (nessun accesso a database o rete): la usano il tenant (lib/verifica-tenant.js, «Controlla il tenant»)
// e Super Admin (generatore di moduli dell'analisi, per validare le bozze prima di installarle). I controlli che richiedono il database (le formule) si passano come funzione.
//   mods:  { slug: { slug, nome, steps: [blocchi], schema_json? } }
//   opz:   { ruoli?: Set, connessi?: Set, validaFormula?: (expr, slug) => { valid, errors } }
//   esce:  { righe: [{ categoria, ok, modulo, blocco, messaggio }], manuali: [{ modulo, cosa, dove }] }
import { getRequiredConnectors } from './schema-v3-core.js'

const SPECIALI = (k) => typeof k === 'string' && (k.startsWith('_') || k.startsWith('@'))
const CAMPO_BLOCCHI = ['field', 'computed']

// Prepara un modulo per i controlli: campi, relazioni, tipi di allegato, stati, passaggi.
export function preparaModulo(slug, nome, steps) {
  const st = Array.isArray(steps) ? steps : []
  const campi = new Set(st.filter((b) => CAMPO_BLOCCHI.includes(b.block_type) && b.key).map((b) => b.key))
  // un'azione esterna scrive il proprio esito in un campo suo: è un valore valido anche se non è un campo del modulo
  for (const b of st) if (b.block_type === 'external_action' && b.risultato_in) campi.add(b.risultato_in)
  // i tipi di allegato: quelli del riquadro Allegati, più quelli che nascono da soli quando torna un documento firmato
  const allegati = new Set([...st.filter((b) => b.block_type === 'allegati').flatMap((b) => b.types || []), ...st.filter((b) => b.block_type === 'document_action' && b.signed_type).map((b) => b.signed_type)])
  return {
    slug, nome, steps: st, campi, allegati,
    relazioni: new Map(st.filter((b) => b.block_type === 'relation' && b.key).map((b) => [b.key, b])),
    stati: st.filter((b) => b.block_type === 'workflow_state'), passaggi: st.filter((b) => b.block_type === 'workflow_transition'),
  }
}

// Chiavi di un token tipo «campo» o «relazione.campo» riferito da un modulo: esiste?
function riferimentoValido(mods, m, token) {
  const t = String(token || '').trim()
  if (!t || SPECIALI(t)) return true
  const [a, b] = t.split('.')
  if (!b) return m.campi.has(a) || m.relazioni.has(a)
  const rel = m.relazioni.get(a)
  if (!rel) return false
  const bersaglio = mods[rel.target_module]
  return !!bersaglio && (bersaglio.campi.has(b) || bersaglio.relazioni.has(b))
}

export function controllaModuli(modsGrezzi, opz = {}) {
  const mods = {}
  for (const [slug, m] of Object.entries(modsGrezzi)) mods[slug] = { ...preparaModulo(slug, m.nome || slug, m.steps), schema_json: m.schema_json }
  const righe = []; const manuali = []
  const ck = (categoria, ok, modulo, blocco, messaggio) => righe.push({ categoria, ok: !!ok, modulo, blocco, messaggio })
  const manuale = (modulo, cosa, dove) => manuali.push({ modulo, cosa, dove })
  const ruoliEsistenti = opz.ruoli || new Set(['admin'])
  const connessi = opz.connessi || new Set()
  const soloQuesti = opz.soloModuli ? new Set(opz.soloModuli) : null // controlla solo questi moduli (gli altri servono per risolvere i riferimenti)

  for (const m of Object.values(mods)) {
    if (soloQuesti && !soloQuesti.has(m.slug)) continue
    // ── Flusso: stati e passaggi ──
    if (m.stati.length) {
      const iniziali = m.stati.filter((s) => s.initial);
      ck('flusso', iniziali.length === 1, m.slug, 'stati', iniziali.length === 1 ? '' : (iniziali.length === 0 ? 'Nessuno stato iniziale: i record nuovi non hanno uno stato da cui partire.' : 'Più di uno stato iniziale.'));
      const chiavi = new Set(m.stati.map((s) => s.key));
      for (const p of m.passaggi) ck('flusso', chiavi.has(p.from) && chiavi.has(p.to), m.slug, 'passaggio «' + (p.label || p.from + ' → ' + p.to) + '»', 'Il passaggio cita uno stato che non esiste (' + p.from + ' → ' + p.to + ').');
      // ogni stato deve essere raggiungibile dall'iniziale
      if (iniziali.length === 1) {
        const visti = new Set([iniziali[0].key]); let cresciuto = true;
        while (cresciuto) { cresciuto = false; for (const p of m.passaggi) if (visti.has(p.from) && chiavi.has(p.to) && !visti.has(p.to)) { visti.add(p.to); cresciuto = true; } }
        for (const s of m.stati) ck('flusso', visti.has(s.key), m.slug, 'stato «' + (s.label || s.key) + '»', 'Lo stato non si raggiunge da quello iniziale: nessun passaggio porta fin lì.');
      }
      for (const p of m.passaggi) for (const r of (Array.isArray(p.roles) ? p.roles : [])) ck('permessi', ruoliEsistenti.has(r), m.slug, 'passaggio «' + (p.label || '') + '»', 'Il passaggio è riservato al ruolo «' + r + '», che non esiste.');
    }

    for (const b of m.steps) {
      // ── Requisiti per stato ──
      if (b.block_type === 'state_requirements') {
        ck('requisiti', m.stati.some((s) => s.key === b.stato), m.slug, 'requisiti per «' + b.stato + '»', 'I requisiti riguardano uno stato che non esiste.');
        for (const r of (b.requisiti || [])) {
          const eti = 'requisito «' + (r.label || '') + '»';
          if (r.tipo === 'campo') ck('requisiti', riferimentoValido(mods, m, r.campo), m.slug, eti, 'Il campo «' + r.campo + '» non esiste in questo modulo.');
          else if (r.tipo === 'uno_di') ck('requisiti', (r.campi || []).length > 0 && (r.campi || []).every((c) => riferimentoValido(mods, m, c)), m.slug, eti, 'Uno dei campi elencati non esiste.');
          else if (r.tipo === 'allegato') ck('requisiti', m.allegati.has(r.valore), m.slug, eti, 'Il tipo di allegato «' + r.valore + '» non è tra quelli del riquadro Allegati: il passaggio non si potrà mai sbloccare.');
          else ck('requisiti', false, m.slug, eti, 'Tipo di requisito sconosciuto («' + r.tipo + '»).');
        }
      }
      // ── Relazioni ──
      if (b.block_type === 'relation') {
        const t = mods[b.target_module];
        ck('relazioni', !!t, m.slug, 'relazione «' + (b.label || b.key) + '»', 'Punta al modulo «' + b.target_module + '», che non esiste o non è installato.');
        if (t && b.display_field) ck('relazioni', t.campi.has(b.display_field), m.slug, 'relazione «' + (b.label || b.key) + '»', 'Il campo mostrato «' + b.display_field + '» non esiste in «' + t.nome + '».');
      }
      // ── Automazioni ──
      if (b.block_type === 'automation') {
        const et = 'automazione «' + (b.label || 'senza nome') + '»';
        const tr = b.trigger || {};
        if (tr.evento === 'cambio_stato' && tr.stato) ck('automazioni', m.stati.some((s) => s.key === tr.stato), m.slug, et, 'Parte quando arriva lo stato «' + tr.stato + '», che non esiste.');
        if (tr.evento === 'modifica_campo' && tr.campo) ck('automazioni', riferimentoValido(mods, m, tr.campo), m.slug, et, 'Osserva il campo «' + tr.campo + '», che non esiste.');
        if (Array.isArray(tr.filtro)) for (const f of tr.filtro) ck('automazioni', riferimentoValido(mods, m, f.campo), m.slug, et, 'Il filtro usa il campo «' + f.campo + '», che non esiste.');
        ck('automazioni', Array.isArray(b.azioni) && b.azioni.length > 0, m.slug, et, 'Non ha nessuna azione: non fa nulla.');
        const visita = (azioni) => { for (const a of (azioni || [])) {
          if (a.kind === 'condition') { visita(a.then); visita(a.otherwise); continue; }
          const c = a.config || {};
          if (a.azione === 'crea_record' || a.azione === 'crea_record_n_volte') {
            const t2 = mods[c.modulo];
            ck('automazioni', !!t2, m.slug, et, 'Crea record in «' + c.modulo + '», che non esiste.');
            if (t2) for (const [k, v] of Object.entries(c.dati || {})) {
              if (!SPECIALI(k)) ck('automazioni', t2.campi.has(k) || t2.relazioni.has(k), m.slug, et, 'Scrive il campo «' + k + '» in «' + t2.nome + '», che non esiste.');
              if (typeof v === 'string' && v.startsWith('campo:')) ck('automazioni', riferimentoValido(mods, m, v.slice(6)), m.slug, et, 'Legge il campo «' + v.slice(6) + '» di questo modulo, che non esiste.');
            }
          }
          if (a.azione === 'aggiorna_record') {
            const t2 = mods[c.modulo]; ck('automazioni', !!t2, m.slug, et, 'Aggiorna record in «' + c.modulo + '», che non esiste.');
            if (t2 && c.campo && !SPECIALI(c.campo)) ck('automazioni', t2.campi.has(c.campo) || t2.relazioni.has(c.campo), m.slug, et, 'Aggiorna il campo «' + c.campo + '» in «' + t2.nome + '», che non esiste.');
          }
        } };
        visita(b.azioni);
      }
      // ── Documenti da modello ──
      if (b.block_type === 'document_action') {
        const et = 'documento «' + (b.label || b.key) + '»';
        const trovati = new Set(); const re = /\{\{[#^/]?\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g; let x;
        for (const testo of [b.subject, b.body]) { const s = String(testo || ''); re.lastIndex = 0; while ((x = re.exec(s))) trovati.add(x[1]); }
        for (const t of trovati) if (!SPECIALI(t)) ck('documenti', riferimentoValido(mods, m, t), m.slug, et, 'Il testo usa «' + t + '», che non esiste.');
        if (b.recipient) ck('documenti', riferimentoValido(mods, m, b.recipient), m.slug, et, 'Il destinatario «' + b.recipient + '» non esiste.');
      }
      // ── Viste ──
      if (b.block_type === 'calendar_view') {
        for (const k of ['date_field', 'title_field']) if (b[k]) ck('viste', riferimentoValido(mods, m, b[k]), m.slug, 'calendario «' + (b.label || b.key) + '»', 'Il campo «' + b[k] + '» non esiste.');
        if (b.done_state) ck('viste', m.stati.some((s) => s.key === b.done_state), m.slug, 'calendario «' + (b.label || b.key) + '»', 'Lo stato «fatto» («' + b.done_state + '») non esiste.');
      }
      if (b.block_type === 'map_view') for (const k of (b.campi || [])) ck('viste', riferimentoValido(mods, m, k), m.slug, 'mappa «' + (b.label || b.key) + '»', 'Il campo dell\'indirizzo «' + k + '» non esiste.');
      if (b.block_type === 'match_view') {
        const t = mods[b.target_module]; ck('viste', !!t, m.slug, 'abbinamento «' + (b.label || b.key) + '»', 'Cerca nel modulo «' + b.target_module + '», che non esiste.');
        if (t) for (const r of (b.rules || [])) {
          ck('viste', m.campi.has(r.mine), m.slug, 'abbinamento «' + (b.label || b.key) + '»', 'Il campo «' + r.mine + '» non esiste in questo modulo.');
          for (const k of [].concat(r.theirs || [])) ck('viste', t.campi.has(k), m.slug, 'abbinamento «' + (b.label || b.key) + '»', 'Il campo «' + k + '» non esiste in «' + t.nome + '».');
        }
      }
      // ── Permessi ──
      if (b.block_type === 'permissions') for (const r of (b.rules || [])) ck('permessi', ruoliEsistenti.has(r.role), m.slug, 'permessi', 'Le regole citano il ruolo «' + r.role + '», che non esiste.');
      // ── Calcoli ──
      if (b.block_type === 'field' && b.type === 'computed' && b.expr) {
        let esito = { valid: true, errors: [] };
        if (opz.validaFormula) { try { esito = opz.validaFormula(b.expr, m.slug); } catch (e) { esito = { valid: false, errors: [e.message] }; } }
        ck('calcoli', esito.valid, m.slug, 'calcolo «' + (b.label || b.key) + '»', esito.valid ? '' : 'La formula non è valida: ' + String((esito.errors || [])[0] || '').slice(0, 140));
      }
      // ── Cose che deve completare una persona ──
      if (b.block_type === 'external_action' && b.adapter === 'da_attivare') manuale(m.slug, 'Funzione «' + b.label + '» da attivare: ' + (b.servizio_richiesto || 'servizio esterno'), 'Impostazioni → Connessioni');
    }
    // Servizi esterni richiesti dal modulo
    try { for (const id of getRequiredConnectors(m.schema_json || JSON.stringify({ version: 3, steps: m.steps }))) if (!connessi.has(id)) manuale(m.slug, 'Collegare il servizio «' + id + '»', 'Impostazioni → Connessioni'); } catch (e) { /* schema non leggibile: niente requisiti */ }
  }

  return { righe, manuali }
}
