// ─── CODICI DI RECUPERO 2FA — UNICA fonte di verità ────────────────────────────
// Formato/sicurezza dei codici di backup, condivisi davvero tra core/backend
// (dove esistevano già) e super-admin/backend (2026-08-10, stesso 2FA portato
// qui). `bcrypt` iniettato come parametro invece di importato qui dentro:
// shared/ non ha un proprio node_modules (a differenza di rate-limit.js, che
// non ha bisogno di nessuna libreria — questo file sì), e Node non risale a
// quello dei singoli backend risolvendo require() da un file sotto /shared/
// dentro il container. L'iniezione evita il problema senza dover copiare
// node_modules dentro l'immagine anche per /shared/.
import { randomBytes } from 'crypto';

export function genBackupCodes(bcrypt) {
  const plain = Array.from({ length: 8 }, () =>
    randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g).join('-')
  );
  const hashed = plain.map((c) => bcrypt.hashSync(c, 10));
  return { plain, hashed };
}

// Cerca `code` (formato XXXX-XXXX) tra gli hash in `hashedCodesJson` — a
// singolo uso: se trovato, va rimosso dall'elenco, non solo segnato come
// "usato" (torna il JSON già aggiornato, il chiamante lo salva). matched:false
// se non trovato o se il JSON è vuoto/malformato.
export function matchBackupCode(bcrypt, code, hashedCodesJson) {
  let codes = [];
  try { codes = JSON.parse(hashedCodesJson || '[]'); } catch (e) {}
  const idx = codes.findIndex((h) => bcrypt.compareSync(String(code || '').toUpperCase(), h));
  if (idx === -1) return { matched: false };
  codes.splice(idx, 1);
  return { matched: true, remaining: JSON.stringify(codes) };
}
