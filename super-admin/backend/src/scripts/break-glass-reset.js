'use strict';
// Recupero dell'ULTIMO admin bloccato — quando non c'è un altro admin che
// possa resettarti password/2FA da Impostazioni (routes/users.js
// reset-password/disable-2fa), serve comunque una via pulita, non SQL a
// mano sul file del database. Segnalato dall'utente (2026-10-14): la vecchia
// idea "basta INITIAL_ADMIN_PASSWORD" non funziona davvero — quella variabile
// agisce SOLO alla primissima creazione del database (vedi routes/auth.js,
// `if (!existing) {...}`), mai su un admin già esistente e bloccato.
//
// Eseguibile SOLO da chi ha già accesso alla shell del container (NAS SSH) —
// non è una rotta HTTP, non è raggiungibile dalla rete: lo stesso principio
// di fiducia già in uso per INTERNAL_API_SECRET e INITIAL_ADMIN_PASSWORD,
// chi arriva fin qui è già l'operatore.
//
// Uso:
//   docker exec super-admin-backend node src/scripts/break-glass-reset.js <username> <nuova-password> [--disable-2fa]
//
// Resta un'azione tracciata, non un backdoor silenzioso: finisce in
// audit_log con un attore esplicito ("break-glass-script"), visibile dopo in
// Attività come ogni altro reset tra admin.
const bcrypt = require('bcryptjs');
const db = require('../db');
const { logAudit } = require('../audit-log');

function fail(msg) {
  console.error('\nERRORE: ' + msg + '\n');
  process.exit(1);
}

const [, , username, newPassword, ...rest] = process.argv;
const disable2fa = rest.includes('--disable-2fa');

if (!username || !newPassword) {
  fail('Uso: node src/scripts/break-glass-reset.js <username> <nuova-password> [--disable-2fa]');
}
if (newPassword.length < 8) fail('La nuova password deve avere almeno 8 caratteri.');

const user = db.prepare("SELECT id, username, totp_enabled FROM users WHERE username = ? AND role = 'admin'").get(username);
if (!user) {
  const all = db.prepare("SELECT username FROM users WHERE role = 'admin'").all().map((u) => u.username);
  fail(`Nessun admin con username "${username}". Admin esistenti: ${all.join(', ') || '(nessuno)'}.`);
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
logAudit('break-glass-script', 'user.reset_password', user.username, { via: 'break-glass (accesso NAS)' });
console.log(`\nPassword di "${user.username}" reimpostata.`);

if (disable2fa) {
  if (user.totp_enabled) {
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?').run(user.id);
    logAudit('break-glass-script', 'user.force_disable_2fa', user.username, { via: 'break-glass (accesso NAS)' });
    console.log('2FA disattivato.');
  } else {
    console.log('2FA non era attivo, nessuna modifica.');
  }
} else if (user.totp_enabled) {
  console.log('Attenzione: il 2FA resta attivo — se sei bloccato anche lì, rilancia con --disable-2fa.');
}

console.log('\nAccedi ora con la nuova password. Conviene poi registrare una passkey o riconfigurare il 2FA dalle Impostazioni.\n');
