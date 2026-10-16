'use strict';
// Inviti a un tenant: un link monouso con cui la persona sceglie da sé utente e password (nessuna password gira per mail o chat). Il token vale 72 ore, una volta sola, si può
// revocare; nel database resta solo la sua impronta SHA-256. Il ruolo lo decide chi invita e deve esistere. L'uso è atomico: due persone con lo stesso link non creano due utenti.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const ORE = 72;
const MIN_PASSWORD = 10;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const ruoliValidi = () => new Set(['admin', 'user', ...db.prepare('SELECT name FROM roles').all().map((r) => r.name)]);
const pulisci = (s, n) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function crea({ nome, email, role, by }) {
  const r = pulisci(role || 'user', 40);
  if (!ruoliValidi().has(r)) throw err('Ruolo non valido.');
  const mail = pulisci(email, 120);
  if (mail && !EMAIL_RE.test(mail)) throw err('L\'email non sembra valida.');
  const token = crypto.randomBytes(32).toString('base64url');
  const scade = new Date(Date.now() + ORE * 3600 * 1000).toISOString();
  const id = db.prepare('INSERT INTO invites (token_hash, nome, email, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(hash(token), pulisci(nome, 80), mail || null, r, pulisci(by, 80), scade).lastInsertRowid;
  return { id: Number(id), token, scade, ore: ORE };
}

const riga = (token) => db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hash(token));
function motivoNonValido(i) {
  if (!i) return 'Questo invito non esiste.';
  if (i.revoked_at) return 'Questo invito è stato annullato.';
  if (i.used_at) return 'Questo invito è già stato usato.';
  if (new Date(i.expires_at).getTime() < Date.now()) return 'Questo invito è scaduto.';
  return null;
}
// Per la pagina pubblica: dice solo se è valido e a chi è rivolto; mai altro.
function stato(token) {
  const i = riga(token), motivo = motivoNonValido(i);
  return motivo ? { valido: false, motivo } : { valido: true, nome: i.nome || '', ruolo: i.role };
}

function usa(token, { username, password }) {
  const u = pulisci(username, 60), p = String(password || '');
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(u)) throw err('Scegli un nome utente di almeno 3 caratteri (lettere, numeri, . _ - @).');
  if (p.length < MIN_PASSWORD) throw err('La password deve avere almeno ' + MIN_PASSWORD + ' caratteri.');
  if (p.toLowerCase() === u.toLowerCase()) throw err('La password non può essere uguale al nome utente.');
  return db.transaction(() => {
    const i = riga(token), motivo = motivoNonValido(i);
    if (motivo) throw err(motivo, 410);
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(u)) throw err('Questo nome utente è già preso: scegline un altro.', 409);
    const r = db.prepare('UPDATE invites SET used_at = CURRENT_TIMESTAMP, used_username = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(u, i.id);
    if (!r.changes) throw err('Questo invito è già stato usato.', 410);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(u, bcrypt.hashSync(p, 10), i.nome || u, i.role);
    return { username: u, ruolo: i.role };
  })();
}

const elenco = () => db.prepare('SELECT id, nome, email, role, created_by, created_at, expires_at, used_at, used_username, revoked_at FROM invites ORDER BY id DESC LIMIT 50').all()
  .map((i) => ({ ...i, stato: i.used_at ? 'usato' : i.revoked_at ? 'annullato' : new Date(i.expires_at).getTime() < Date.now() ? 'scaduto' : 'in_attesa' }));
function revoca(id) { return db.prepare('UPDATE invites SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(id).changes > 0; }

module.exports = { crea, stato, usa, elenco, revoca, ORE, MIN_PASSWORD };
