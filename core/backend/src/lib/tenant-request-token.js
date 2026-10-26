'use strict';
// Firma un token breve con il JWT_SECRET di QUESTO tenant (mai il segreto interno
// condiviso) per le chiamate verso le rotte di super-admin/backend/src/routes/
// tenant-ai.js e registry.js che hanno bisogno di sapere DAVVERO quale tenant sta
// chiamando (26/10/2026, chiusura di un gap: con solo il segreto condiviso, ogni
// tenant poteva dichiarare lo slug di un altro). Stesso schema già in uso da
// routes/export-server.js/invites.js — un 'purpose' per feature, scadenza breve
// (round-trip sincrono sulla rete Docker interna, non un job in background: 60s
// basta e tiene corta la finestra di replay).
//
// Vive QUI (core/backend/src/lib/), non in shared/: shared/ è un pacchetto ESM
// senza node_modules proprio (solo codice senza dipendenze esterne, vedi
// shared/internal-secret.js) — importarvi 'jsonwebtoken' fallirebbe a runtime
// (risoluzione dei moduli radicata in shared/, mai nei node_modules di un
// pacchetto fratello come core/backend). Tutti i chiamanti sono già dentro
// core/backend, che la dipendenza ce l'ha.
const jwt = require('jsonwebtoken');

function signTenantRequest(purpose, expiresIn = 60) {
  return jwt.sign({ slug: process.env.TENANT_SLUG, purpose }, process.env.JWT_SECRET, { expiresIn });
}

module.exports = { signTenantRequest };
