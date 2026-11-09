'use strict';
// La guida d'uso di un tenant, scritta dalla struttura dei suoi moduli: a cosa serve ogni scheda, come si compila, cosa serve per far avanzare un flusso, quali documenti si spediscono,
// cosa fanno da sole le automazioni. Stessa forma dei testi dei pacchetti (routes/guida.js): introduzione, passi per ruolo, un capitolo per modulo, flussi, glossario, giro guidato.
// Nessuna AI e nessun nome di settore: parte sempre dallo schema, quindi è sempre allineata a ciò che l'app fa davvero; poi la si rifinisce a mano (Impostazioni → Guida).
const db = require('../db');

const minuscolo = (s) => String(s || '').trim();
const elenco = (v) => { const a = v.filter(Boolean); return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1]; };
const grassetto = (v) => '**' + v + '**';

function leggi() {
  const mods = [];
  for (const m of db.prepare('SELECT slug, name, group_name, sort_order, menu_nascosto FROM modules WHERE installed = 1 AND support_module = 0 ORDER BY group_order, sort_order, id').all()) {
    const row = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(m.slug);
    let s; try { s = JSON.parse(row.schema_json || '{}'); } catch (e) { s = {}; }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    if (!steps.length && m.slug === 'dashboard') continue;
    mods.push({ ...m, steps, campi: steps.filter((b) => b.block_type === 'field'), relazioni: steps.filter((b) => b.block_type === 'relation' && b.target_module), stati: steps.filter((b) => b.block_type === 'workflow_state'), passaggi: steps.filter((b) => b.block_type === 'workflow_transition'), requisiti: steps.filter((b) => b.block_type === 'state_requirements'), documenti: steps.filter((b) => b.block_type === 'document_action'), automazioni: steps.filter((b) => b.block_type === 'automation'), allegati: steps.filter((b) => b.block_type === 'allegati'), viste: steps.filter((b) => ['calendar_view', 'map_view', 'match_view'].includes(b.block_type)), azioni: steps.filter((b) => b.block_type === 'external_action') });
  }
  return mods.filter((m) => m.campi.length || m.stati.length);
}

function percorso(m) {
  const ini = m.stati.find((s) => s.initial) || m.stati[0]; if (!ini) return [];
  const out = [ini]; const visti = new Set([ini.key]);
  for (let corrente = ini; ;) { const p = m.passaggi.find((x) => x.from === corrente.key && !visti.has(x.to)); const n = p && m.stati.find((s) => s.key === p.to); if (!n) break; out.push(n); visti.add(n.key); corrente = n; }
  return out;
}

function capitolo(m, tutti) {
  const nome = (slug) => (tutti.find((x) => x.slug === slug) || {}).name || slug;
  const obbligatori = m.campi.filter((f) => f.required).map((f) => f.label || f.key);
  const chiave = m.campi.filter((f) => f.dato_chiave).map((f) => f.label || f.key);
  const collegati = m.relazioni.map((r) => nome(r.target_module));
  const usatoDa = tutti.filter((x) => x.slug !== m.slug && x.relazioni.some((r) => r.target_module === m.slug)).map((x) => x.name);
  const scopo = 'Qui gestisci ' + grassetto(m.name) + (collegati.length ? ', collegati a ' + elenco([...new Set(collegati)]) : '') + (usatoDa.length ? '. Compare anche in ' + elenco(usatoDa) : '') + '.';
  const passi = [];
  passi.push('Premi **Nuovo** per creare una scheda' + (obbligatori.length ? ': i campi obbligatori sono ' + elenco(obbligatori) + '.' : '.') + (chiave.length ? ' In evidenza trovi ' + elenco(chiave) + '.' : ''));
  const controllati = m.campi.filter((f) => f.validazione);
  if (controllati.length) passi.push('Il campo ' + elenco(controllati.map((f) => grassetto(f.label || f.key))) + ' viene controllato mentre salvi: se non è valido l\'app ti dice quale correggere.');
  for (const r of m.relazioni.slice(0, 4)) passi.push('In «' + (r.label || r.key) + '» scegli una scheda di ' + grassetto(nome(r.target_module)) + (r.quick_create ? ' (se non c\'è, la crei al volo)' : '') + '.');
  const per = percorso(m);
  if (per.length > 1) {
    passi.push('Ogni scheda segue un percorso: ' + elenco(per.map((s) => grassetto(s.label || s.key))) + '. Lo stato si cambia dal riquadro **Stato**.');
    for (const b of m.requisiti.filter((x) => x.bloccante && (x.requisiti || []).length)) {
      const st = m.stati.find((s) => s.key === b.stato);
      passi.push('Per passare a «' + ((st && st.label) || b.stato) + '» servono: ' + elenco(b.requisiti.map((q) => q.label)) + '. Se manca qualcosa l\'app non ti lascia andare avanti e dice cosa manca.');
    }
  }
  if (m.documenti.length) passi.push('Dal menu **Documenti** della scheda prepari ' + elenco(m.documenti.map((d) => grassetto(d.label || d.key))) + ': si apre la bozza già compilata, la rivedi e la invii (o la scarichi in PDF).');
  const consigli = [];
  for (const a of m.automazioni.filter((x) => x.enabled !== false)) {
    const crea = []; const visita = (az) => { for (const x of (az || [])) { if (x.kind === 'condition') { visita(x.then); visita(x.otherwise); } else if (x.azione === 'crea_record' && x.config && x.config.modulo) crea.push(nome(x.config.modulo)); } }; visita(a.azioni);
    const tr = a.trigger || {};
    if (crea.length && tr.evento === 'cambio_stato') { const st = m.stati.find((s) => s.key === tr.stato); consigli.push('Quando una scheda arriva a «' + ((st && st.label) || tr.stato) + '» l\'app crea da sola le schede in ' + elenco([...new Set(crea)]) + ': non devi inserirle a mano.'); }
    else if (a.label) consigli.push('L\'app fa da sola: ' + a.label + '.');
  }
  for (const a of m.allegati) if ((a.types || []).length) consigli.push('Nel riquadro **Allegati** puoi caricare: ' + elenco(a.types) + '.');
  if (m.viste.some((v) => v.block_type === 'calendar_view')) consigli.push('Il pulsante **Calendario** mostra le schede sui loro giorni.');
  if (m.viste.some((v) => v.block_type === 'map_view')) consigli.push('Nella scheda compare una **mappa** con l\'indirizzo.');
  if (m.viste.some((v) => v.block_type === 'match_view')) consigli.push('La scheda propone da sola gli **abbinamenti** con altri moduli, con un punteggio.');
  const da = m.azioni.filter((a) => a.adapter === 'da_attivare'); if (da.length) consigli.push(elenco(da.map((a) => '«' + a.label + '»')) + ' si accende da sola quando il servizio esterno è abilitato (Impostazioni → Connessioni).');
  return { scopo, come_si_usa: passi, consigli };
}

function genera() {
  const mods = leggi();
  const nomeTenant = process.env.TENANT_NAME || (db.prepare('SELECT app_name FROM tenant_settings WHERE id = 1').get() || {}).app_name || 'questo spazio di lavoro';
  const capitoli = {}; const flussi = []; const giro = []; const glossario = [];
  for (const m of mods) {
    capitoli[m.slug] = capitolo(m, mods);
    const per = percorso(m);
    if (per.length > 1) flussi.push({ titolo: m.name + ': dal primo all\'ultimo passo', passi: per.map((s, i) => i === 0 ? 'In **' + m.name + '** crea la scheda: parte da «' + (s.label || s.key) + '».' : 'Portala a «' + (s.label || s.key) + '».') });
    giro.push({ pagina: m.slug, titolo: m.name, testo: capitoli[m.slug].scopo.replace(/\*\*/g, '') + (per.length > 1 ? ' Il percorso è ' + per.map((s) => s.label || s.key).join(' → ') + '.' : '') });
    for (const s of per) if (!glossario.some((g) => g.termine === (s.label || s.key))) glossario.push({ termine: s.label || s.key, significato: 'Uno stato di «' + m.name + '».' });
  }
  const primo = mods[0];
  return {
    introduzione: { titolo: 'Come si lavora in ' + nomeTenant, testo: [
      'Qui trovi, nell\'ordine del menu: ' + elenco(mods.map((m) => m.name)) + '. Parti da ' + (primo ? grassetto(primo.name) : 'il primo modulo') + ' e segui i collegamenti tra le schede.',
      'Ogni scheda ti mostra in alto **dove si trova la pratica** (il percorso degli stati) e **cosa manca per fare il passo successivo**. Se un passaggio è importante l\'app non ti lascia andare avanti senza i dati richiesti.',
    ] },
    per_ruolo: {
      admin: { titolo: 'Per iniziare — amministratore', passi: [
        'Controlla in **Impostazioni → Aspetto** il nome, il logo e il colore dell\'app.',
        'Collega i servizi che ti servono in **Impostazioni → Connessioni** (posta in uscita, Google, ecc.).',
        'Invita le persone da **Utenti & Ruoli** e dai a ciascuna il ruolo giusto.',
        'In **Impostazioni → Moduli** premi **Controlla** e **Collaudo completo**: ti dicono se i moduli stanno in piedi e se i flussi funzionano davvero.',
        'Il punto interrogativo accanto al titolo di ogni pagina apre la guida di quella pagina.',
      ] },
      default: { titolo: 'Per iniziare — il tuo lavoro di ogni giorno', passi: ['Apri la **Dashboard** per vedere cosa c\'è da fare.'].concat(mods.slice(0, 4).map((m) => 'In ' + grassetto(m.name) + ': ' + capitoli[m.slug].scopo.replace(/\*\*/g, '').replace(/^Qui gestisci /, 'gestisci ').replace(/\.$/, '') + '.')) },
    },
    capitoli, flussi, glossario,
    giro: [{ pagina: 'dashboard', titolo: 'Da qui si comincia', testo: 'Questa è la Dashboard: ogni mattina apri questa pagina per vedere cosa c\'è da fare e dove andare.' }, ...giro],
  };
}

module.exports = { genera };
