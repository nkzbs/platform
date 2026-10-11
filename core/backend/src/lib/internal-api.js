'use strict';
// Il bot esegue le azioni chiamando l'API dell'app COME L'UTENTE collegato (stessa rotta che userebbe il browser), con un token firmato dal server che dura 2 minuti.
// Così ogni controllo dell'app — permessi del ruolo, «solo propri», validazioni, automazioni, registro — vale anche per il bot, senza una seconda copia della logica.
// Non crea una sessione (nessuna riga in `sessions`: non è un accesso e non deve contare come utente attivo per gli aggiornamenti).
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

async function callAs(user, method, path, body) {
  const token = jwt.sign({
    id: user.id, username: user.username, role: user.role, display_name: user.display_name,
    linked_module_slug: user.linked_module_slug || null, linked_record_id: user.linked_record_id || null,
  }, JWT_SECRET, { expiresIn: '2m' });
  const res = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api' + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  let data = null; try { data = await res.json(); } catch (e) { /* risposta vuota */ }
  return { ok: res.ok, status: res.status, data };
}

module.exports = { callAs };
