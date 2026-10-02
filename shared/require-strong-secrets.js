// G1 (PLATFORM-0.6-GAP-ANALYSIS.md) — boot-time secret validation, condivisa tra i
// due backend. Nessun secret richiesto deve mai restare al valore di default noto
// in questo repo (chiunque legga il codice sorgente conosce già quei valori) né
// mancare del tutto quando il processo parte davvero in produzione. In sviluppo
// resta solo un avviso, non bloccante — non deve rompere `npm start` locale con
// un `.env` minimale.
//
// Va chiamata come prima cosa in assoluto in index.js, PRIMA di `require`
// qualunque route: molte route leggono `process.env.X || 'default'` in una
// `const` di modulo, quindi il valore è già "letto" (con fallback) nel momento
// stesso in cui il file viene richiesto — un controllo fatto dopo arriverebbe
// sempre tardi.
export function requireStrongSecrets(checks) {
  const isProd = process.env.NODE_ENV === 'production';
  const problems = [];
  for (const { name, value, badDefault } of checks) {
    if (!value) problems.push(name + ' (mancante)');
    else if (value === badDefault) problems.push(name + ' (uguale al default noto "' + badDefault + '")');
  }
  if (problems.length === 0) return;

  const lines = problems.map((p) => '  - ' + p).join('\n');
  if (isProd) {
    console.error('ERRORE FATALE — secret non sicuri per un avvio in produzione:\n' + lines +
      '\nImposta variabili d\'ambiente reali (diverse dal valore di default) prima di avviare con NODE_ENV=production.');
    process.exit(1);
  } else {
    console.warn('ATTENZIONE (solo sviluppo, non bloccante — imposterebbe NODE_ENV=production a bloccare l\'avvio):\n' + lines);
  }
}
