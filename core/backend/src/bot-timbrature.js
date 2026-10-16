'use strict';
// Bot Telegram: le timbrature. Un modulo che dichiara `kind: presenze` (ruoli data / inizio / fine) permette di timbrare dalla chat e di chiedere le ore.
// A differenza delle spese NON c'è conferma prima: «sono entrata» è un gesto da una riga e fermarsi a confermare lo rende scomodo; la sicurezza sta altrove:
//  • passa dall'API dell'app come quell'utente (permessi, «solo propri», validazioni, automazioni, registro);
//  • scrive solo la data e l'orario (mai altri campi), e per l'uscita chiude SOLO l'ultima entrata ancora aperta di quell'utente (oggi o ieri);
//  • ogni timbratura ha il bottone «↩ Annulla» (15 minuti, una volta, solo per chi l'ha fatta) che toglie la riga o ripristina l'uscita.
const db = require('./db');
const moduleRoles = require('./module-roles');
const { logAudit } = require('./audit-log');
const { callAs } = require('./lib/internal-api');
const { esc } = require('./bot-ai');

const oggiRoma = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
const oraRoma = (now = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
const { GIORNI, shiftDay, toMin, hhmm, durata, minuti, intervallo, somma } = require('./ore-calc');

// Il modulo delle presenze che questo utente vede (e i nomi dei suoi campi). Se ce n'è più d'uno, il primo.
function modulo(user) {
  const vis = new Set(require('./routes/modules').visibleSlugsFor(user));
  const m = moduleRoles.list({ kind: 'presenze' }).find((x) => vis.has(x.module_slug) && x.roles.data && x.roles.inizio && x.roles.fine);
  return m ? { slug: m.module_slug, nome: m.name || m.module_slug, R: m.roles } : null;
}
const haPresenze = (user) => !!modulo(user);

// Le righe di quest'utente che può vedere. Chi è admin vede anche le righe degli altri: per «le mie ore» si contano solo quelle create da lui.
function righe(user, m) {
  const { rows } = require('./reports');
  const vis = rows(m.slug, { user, slugs: new Set([m.slug]) });
  if (!vis.length) return [];
  const owner = new Map(db.prepare('SELECT id, user_id FROM records WHERE module_slug = ?').all(m.slug).map((r) => [r.id, r.user_id]));
  return vis.filter((r) => user.role !== 'admin' || owner.get(r.id) === user.id).map((r) => ({ id: r.id, d: r.data, mia: owner.get(r.id) === user.id }));
}

function annullaKb(pid) { return [[{ text: '↩ Annulla', callback_data: 'tu:' + pid }]]; }
const { savePending, takePending } = (() => { const a = () => require('./bot-actions'); return { savePending: (...x) => a().savePending(...x), takePending: (...x) => a().takePending(...x) }; })();

async function timbra(user, chatId, intent, now = new Date()) {
  const m = modulo(user);
  if (!m) return { html: 'Non hai un modulo di timbrature a cui il bot possa lavorare.' };
  const oggi = oggiRoma(now), ora = intent.ora || oraRoma(now), data = intent.data || oggi;
  const aperte = righe(user, m).filter((r) => r.mia && toMin(r.d[m.R.inizio]) != null && toMin(r.d[m.R.fine]) == null && String(r.d[m.R.data] || '').slice(0, 10) >= shiftDay(oggi, -1)).sort((a, b) => String(b.d[m.R.data]).localeCompare(String(a.d[m.R.data])) || toMin(b.d[m.R.inizio]) - toMin(a.d[m.R.inizio]));

  if (intent.tipo === 'entrata') {
    const dup = aperte.find((r) => String(r.d[m.R.data]).slice(0, 10) === data);
    if (dup) return { html: 'Hai già un\'entrata alle <b>' + hhmm(dup.d[m.R.inizio]) + '</b> senza uscita. Dimmi quando sei uscita (es. «uscita alle 13:00»).' };
    const r = await callAs(user, 'POST', '/records/' + m.slug, { [m.R.data]: data, [m.R.inizio]: ora });
    if (!r.ok) return { html: '⚠ Non sono riuscito a registrare l\'entrata: ' + esc((r.data && (r.data.error || (r.data.errors || []).join('; '))) || 'errore') };
    const id = r.data && r.data.id;
    logAudit(user.username, 'telegram.timbra', m.slug + '#' + id, { tipo: 'entrata', via: 'bot' });
    const pid = savePending(chatId, user.id, { tipo: 'timbra_annulla', slug: m.slug, id, creata: true });
    return { html: '🟢 <b>Entrata</b> registrata alle <b>' + ora + '</b>' + (data !== oggi ? ' del ' + data.slice(8, 10) + '/' + data.slice(5, 7) : '') + '.', keyboard: annullaKb(pid) };
  }

  // uscita: chiude l'ultima entrata ancora aperta (se la data è indicata, quella di quel giorno)
  const riga = data !== oggi ? aperte.find((r) => String(r.d[m.R.data]).slice(0, 10) === data) : aperte[0];
  if (!riga) return { html: 'Non trovo un\'entrata aperta da chiudere (oggi o ieri). Dimmi anche l\'orario di entrata, per esempio «ieri sono entrata alle 7».' };
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(riga.id, m.slug);
  if (!row) return { html: 'Non trovo più quella entrata.' };
  const stored = JSON.parse(row.data);
  const r = await callAs(user, 'PUT', '/records/' + m.slug + '/' + riga.id, { ...stored, [m.R.fine]: ora });
  if (!r.ok) return { html: '⚠ Non sono riuscito a registrare l\'uscita: ' + esc((r.data && (r.data.error || (r.data.errors || []).join('; '))) || 'errore') };
  logAudit(user.username, 'telegram.timbra', m.slug + '#' + riga.id, { tipo: 'uscita', via: 'bot' });
  const pid = savePending(chatId, user.id, { tipo: 'timbra_annulla', slug: m.slug, id: riga.id, creata: false, campo: m.R.fine, prima: stored[m.R.fine] == null ? '' : stored[m.R.fine] });
  const tot = minuti(stored[m.R.inizio], ora);
  return { html: '🔴 <b>Uscita</b> registrata alle <b>' + ora + '</b> (entrata ' + hhmm(stored[m.R.inizio]) + (tot != null ? ' · ' + durata(tot) : '') + ').', keyboard: annullaKb(pid) };
}

// Il tocco su «↩ Annulla»: toglie la riga creata dal bot, o rimette l'uscita com'era. Solo chi l'ha fatta, una volta, entro 15 minuti.
async function annulla(user, chatId, pid) {
  const a = takePending(pid, chatId, user.id);
  if (!a || a.tipo !== 'timbra_annulla') return { html: 'Non si può più annullare (è passato troppo tempo o è già stato fatto).', scaduta: true };
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(a.id, a.slug);
  if (!row) return { html: 'La riga non c\'è più: niente da annullare.' };
  if (a.creata) {
    const r = await callAs(user, 'DELETE', '/records/' + a.slug + '/' + a.id);
    if (!r.ok) return { html: '⚠ Non sono riuscito a toglierla' + (r.status === 403 ? ': il tuo ruolo non può eliminare righe, chiedi a un amministratore.' : '.') };
    logAudit(user.username, 'telegram.timbra_annulla', a.slug + '#' + a.id, { tipo: 'entrata' });
    return { html: '↩ Entrata annullata.' };
  }
  const r = await callAs(user, 'PUT', '/records/' + a.slug + '/' + a.id, { ...JSON.parse(row.data), [a.campo]: a.prima });
  if (!r.ok) return { html: '⚠ Non sono riuscito ad annullare l\'uscita.' };
  logAudit(user.username, 'telegram.timbra_annulla', a.slug + '#' + a.id, { tipo: 'uscita' });
  return { html: '↩ Uscita annullata: il turno è di nuovo aperto.' };
}

function ore(user, periodo, now = new Date()) {
  const m = modulo(user);
  if (!m) return { html: 'Non hai un modulo di timbrature a cui il bot possa lavorare.' };
  const oggi = oggiRoma(now), iv = intervallo(periodo, oggi), { titolo } = iv;
  const { giorni, aperti, totale: tot } = somma(righe(user, m), m.R, iv);
  if (!giorni.size && !aperti) return { html: '<b>' + titolo + '</b>\nNessuna timbratura in questo periodo.' };
  const righeTxt = [...giorni.keys()].sort().map((g) => '• ' + GIORNI[new Date(g + 'T00:00:00Z').getUTCDay()] + ' ' + g.slice(8, 10) + '/' + g.slice(5, 7) + ' — <b>' + durata(giorni.get(g).min) + '</b> (' + giorni.get(g).turni.join(', ') + ')');
  return { html: '<b>' + titolo + '</b>: <b>' + durata(tot) + '</b> in ' + giorni.size + (giorni.size === 1 ? ' giorno' : ' giorni') + '\n\n' + righeTxt.slice(-31).join('\n') + (aperti ? '\n\n<i>' + aperti + (aperti === 1 ? ' turno è ancora aperto (manca l\'uscita) e non è contato.' : ' turni sono ancora aperti (manca l\'uscita) e non sono contati.') + '</i>' : '') };
}

const menu = () => ({ html: 'Cosa vuoi fare?', keyboard: [[{ text: '🟢 Sono entrata/o', callback_data: 'tb:e' }, { text: '🔴 Sono uscita/o', callback_data: 'tb:u' }], [{ text: '🕒 Le mie ore', callback_data: 'tb:o' }]] });

module.exports = { haPresenze, timbra, annulla, ore, menu, minuti, modulo };
