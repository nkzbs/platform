// G4 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — generatore unico di password
// casuali, condiviso tra core/backend e super-admin/backend: prima di questo file
// esisteva solo dentro super-admin/backend/src/credentials.js (per resettare
// l'admin di un tenant appena creato), e core/backend non aveva alcun modo di
// generare una password server-side per un utente — chi voleva resettare la
// password di un utente normale doveva sceglierne una a mano e scriverla nel
// corpo della richiesta (routes/users.js PATCH /:id). Spostato qui perché sia
// il meccanismo "standard" in entrambi i backend, non due implementazioni che
// potrebbero divergere nel tempo.
import { randomBytes } from 'crypto';

// Alfabeto senza caratteri ambigui (niente 0/O, 1/l/I) — pensata per essere
// letta/ricopiata a mano una volta sola dallo schermo, non per essere
// memorizzata.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 16) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
