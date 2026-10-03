// Toglie i dati personali da un testo PRIMA che esca verso un servizio AI. Si fa qui, in un
// punto solo, e non nel tenant: la garanzia vale per qualunque chiamante.
// Cosa si toglie: IBAN, numeri di carta, email, codici fiscali, numeri di telefono e qualunque
// numero lungo (conti, POD/PDR, codici cliente). Importi, date e parole restano: servono.
const RULES = [
  [/\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/g, '[IBAN]'],
  [/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[carta]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b[A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z]\b/g, '[codice fiscale]'],
  [/(?:\+|00)?\d{2}[ .-]?\d{3}[ .-]?\d{3,4}[ .-]?\d{3,4}\b/g, '[telefono]'],
  [/\b3\d{2}[ .-]?\d{6,7}\b/g, '[telefono]'],
  [/\b0\d{1,3}[ .-]?\d{5,8}\b/g, '[telefono]'],
  [/\b\d{9,}\b/g, '[numero]'],
];

function redact(text) {
  let out = String(text || '');
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

module.exports = { redact };
