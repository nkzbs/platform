// G6 (PLATFORM-0.6-GAP-ANALYSIS.md) — header di sicurezza HTTP di base, condivisi
// tra i due backend. Nessuna dipendenza esterna (stesso principio già in uso in
// questo repo per bcrypt/redis in instance-pairing.js/rate-limit.js: shared/ non
// ha un proprio node_modules) — sono poche righe, non serve una libreria come
// helmet per questo sottoinsieme minimo.
//
// Frontend serviti da qui sono sempre iframe-in-se-stessi al più (nessun embed
// di terze parti previsto), quindi una CSP restrittiva di default non rompe
// nulla di noto — se un caso reale la richiede più permissiva, va rivista
// puntualmente, non allargata di default per comodità.
export function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 'unsafe-inline' su script: VERIFICATO necessario — sia core/frontend/index.html
  // sia super-admin/frontend/index.html hanno uno <script> inline pre-mount (il
  // check tema chiaro/scuro, applicato prima che React monti per evitare il
  // lampo del tema sbagliato) — una CSP `script-src 'self'` senza eccezioni
  // bloccherebbe quello script e romperebbe il tema ad ogni refresh. Restringere
  // ulteriormente (nonce/hash sullo script, o spostarlo in un file esterno)
  // resta possibile in un secondo passo, non incluso qui per non rischiare una
  // regressione non verificata dal vivo in questo giro.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'"
  );
  next();
}
