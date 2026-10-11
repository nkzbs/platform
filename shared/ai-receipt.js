// Foto di scontrini per il bot: le regole condivise tra Super Admin (che valida la risposta del modello) e il tenant (che la rivalida prima di proporre una spesa).
// Il modello può solo restituire questi campi; qualunque cosa fuori misura (importo assurdo, data impossibile, valuta diversa, categoria non ammessa) si scarta o diventa «null».
// Vedi super-admin/backend/src/lib/ai-receipt.js e core/backend/src/bot-ai.js.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CONFIDENZE = ['alta', 'media', 'bassa'];
const MAX_IMMAGINE = 3 * 1024 * 1024;

// Tipo reale dell'immagine dai primi byte (mai fidarsi dell'estensione o del tipo dichiarato). Ritorna 'image/jpeg' | 'image/png' | 'image/webp' | null.
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const validDate = (s) => { if (!ISO.test(String(s))) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// raw = risposta del modello; categorie = quelle ammesse dal modulo; oggi = AAAA-MM-GG. Ritorna { ricevuta } oppure { error }.
function validateReceipt(raw, categorie = [], oggi = new Date().toISOString().slice(0, 10)) {
  if (!raw || typeof raw !== 'object') return { error: 'Risposta non valida' };
  if (raw.leggibile === false) return { error: 'illeggibile' };
  const totale = typeof raw.totale === 'number' ? raw.totale : Number(String(raw.totale == null ? '' : raw.totale).replace(',', '.'));
  if (!(Number.isFinite(totale) && totale > 0 && totale <= 100000)) return { error: 'Non riesco a leggere il totale' };
  const valuta = clean(raw.valuta, 5).toUpperCase();
  if (valuta && valuta !== 'EUR' && valuta !== '€') return { error: 'Per ora leggo solo scontrini in euro' };
  // data: valida e plausibile (non nel futuro, non più vecchia di due anni); altrimenti si usa «oggi» al momento di proporre
  const data = raw.data && validDate(raw.data) && raw.data <= addDays(oggi, 1) && raw.data >= addDays(oggi, -730) ? raw.data : null;
  const categoria = raw.categoria ? (categorie.find((c) => String(c).toLowerCase() === String(raw.categoria).trim().toLowerCase()) || null) : null;
  const esercente = clean(raw.esercente, 80);
  return { ricevuta: { esercente: esercente.length >= 2 ? esercente : 'Scontrino', data, totale: Math.round(totale * 100) / 100, categoria, confidenza: CONFIDENZE.includes(raw.confidenza) ? raw.confidenza : 'media' } };
}

export { validateReceipt, imageKind, MAX_IMMAGINE, CONFIDENZE };
