const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
// G4 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — generatePassword spostata in
// shared/, ora usata anche da core/backend (routes/users.js, reset password di
// un utente normale) — stesso meccanismo "standard" in entrambi i backend,
// invece di due implementazioni che potrebbero divergere.
const { generatePassword } = require('../../../shared/generate-password.js');

// Scrive/aggiorna la password dell'utente 'admin' DIRETTAMENTE nel file .db del
// tenant — stesso accesso diretto già usato da backup-scheduler.js (VACUUM INTO),
// non passa per l'API del tenant (che potrebbe non essere ancora pronta subito
// dopo la creazione del container, o il tenant potrebbe essere fermo per licenza).
// Se l'utente 'admin' non esiste ancora (caso raro, race condition con il primo
// boot del container che lo semina) lo crea qui, idempotente.
function setTenantAdminPassword(dbPath, plainPassword) {
  const tdb = new Database(dbPath, { timeout: 5000 });
  try {
    const hash = bcrypt.hashSync(plainPassword, 10);
    const existing = tdb.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (existing) {
      tdb.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'admin');
    } else {
      tdb.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, 'Admin', 'admin');
    }
  } finally {
    tdb.close();
  }
}

module.exports = { generatePassword, setTenantAdminPassword };
