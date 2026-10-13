'use strict';
// Calcolo delle ore dalle timbrature (un modulo con ruoli data / inizio / fine): usato dal bot («quante ore ho fatto?») e dai report («ore lavorate»).
// Stessa regola dei campi calcolati: tempo trascorso tra entrata e uscita; a cavallo della mezzanotte +24h; con un orario mancante il turno è aperto (non conta).
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const shiftDay = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t)); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; };
const hhmm = (t) => { const m = toMin(t); return m == null ? '' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const durata = (min) => Math.floor(min / 60) + 'h' + (min % 60 ? ' ' + String(min % 60).padStart(2, '0') + 'm' : '');
function minuti(inizio, fine) {
  const a = toMin(inizio), b = toMin(fine);
  if (a == null || b == null) return null;
  const d = b - a; return d < 0 ? d + 1440 : d;
}

const PERIODI = { oggi: 'Oggi', settimana: 'Questa settimana', settimana_scorsa: 'Settimana scorsa', mese: 'Questo mese', mese_scorso: 'Mese scorso' };
// Intervallo [da, a] (date ISO) di un periodo, rispetto a `oggi` (data ISO italiana).
function intervallo(periodo, oggi) {
  const lunedi = (iso) => shiftDay(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
  if (periodo === 'oggi') return { da: oggi, a: oggi, titolo: PERIODI.oggi };
  if (periodo === 'mese') return { da: oggi.slice(0, 8) + '01', a: oggi, titolo: PERIODI.mese };
  if (periodo === 'mese_scorso') { const ultimo = shiftDay(oggi.slice(0, 8) + '01', -1); return { da: ultimo.slice(0, 8) + '01', a: ultimo, titolo: PERIODI.mese_scorso }; }
  if (periodo === 'settimana_scorsa') { const lun = shiftDay(lunedi(oggi), -7); return { da: lun, a: shiftDay(lun, 6), titolo: PERIODI.settimana_scorsa }; }
  return { da: lunedi(oggi), a: oggi, titolo: PERIODI.settimana };
}

// Somma le ore di un elenco di righe { d } con i ruoli { data, inizio, fine }, nell'intervallo. Ritorna { giorni: Map(giorno → { min, turni }), aperti, totale }.
function somma(righe, R, { da, a }) {
  const giorni = new Map(); let aperti = 0;
  for (const r of righe) {
    const g = String(r.d[R.data] || '').slice(0, 10);
    if (!g || g < da || g > a) continue;
    const t = minuti(r.d[R.inizio], r.d[R.fine]);
    if (t == null) { if (toMin(r.d[R.inizio]) != null) aperti++; continue; }
    const e = giorni.get(g) || { min: 0, turni: [] };
    e.min += t; e.turni.push(hhmm(r.d[R.inizio]) + '–' + hhmm(r.d[R.fine])); giorni.set(g, e);
  }
  return { giorni, aperti, totale: [...giorni.values()].reduce((s, e) => s + e.min, 0) };
}

module.exports = { GIORNI, PERIODI, shiftDay, toMin, hhmm, durata, minuti, intervallo, somma };
