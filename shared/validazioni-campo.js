// VALIDAZIONI DI CAMPO dichiarate nello schema (proprietà `validazione` del campo). Funzioni pure, nessuna rete, nessun costo:
//   'codice_fiscale_it'         codice fiscale italiano di persona fisica (16 caratteri, carattere di controllo)
//   'partita_iva_it'            partita IVA italiana (11 cifre, cifra di controllo)
//   'codice_fiscale_o_piva_it'  uno dei due (le società hanno il codice fiscale numerico di 11 cifre, uguale alla partita IVA)
// Valore vuoto = valido (l'obbligatorietà è un'altra cosa).
const DISPARI = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };

export function codiceFiscaleValido(valore) {
  const cf = String(valore || '').trim().toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPR-T][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = cf[i];
    if (i % 2 === 0) somma += DISPARI[c];
    else somma += /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (somma % 26)) === cf[15];
}

export function partitaIvaValida(valore) {
  const p = String(valore || '').replace(/^IT/i, '').trim();
  if (!/^[0-9]{11}$/.test(p)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(p[i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somma += n;
  }
  return (10 - (somma % 10)) % 10 === Number(p[10]);
}

export const REGOLE = {
  codice_fiscale_it: { controlla: codiceFiscaleValido, messaggio: 'non è un codice fiscale valido (16 caratteri con carattere di controllo corretto)' },
  partita_iva_it: { controlla: partitaIvaValida, messaggio: 'non è una partita IVA valida (11 cifre)' },
  codice_fiscale_o_piva_it: { controlla: (v) => codiceFiscaleValido(v) || partitaIvaValida(v), messaggio: 'non è un codice fiscale né una partita IVA validi' },
};

// Controlla i campi con `validazione` presenti in `dati`; se c'è `prima` (record esistente) salta quelli invariati, così un dato vecchio non blocca altre modifiche.
// Restituisce null se tutto va bene, altrimenti { error, campo }.
export function controllaValidazioni(campi, dati, prima = null) {
  for (const f of campi || []) {
    const regola = f && REGOLE[f.validazione];
    if (!regola) continue;
    const v = dati ? dati[f.key] : undefined;
    if (v === undefined || v === null || v === '') continue;
    if (prima && prima[f.key] === v) continue;
    if (!regola.controlla(v)) return { error: `${f.label || f.key}: «${v}» ${regola.messaggio}`, campo: f.key };
  }
  return null;
}
