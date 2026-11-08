'use strict';
// I caratteri scelti per l'app in Impostazioni → Aspetto (`tenant_settings.font_app`). Oggi: «Zuccà Banner», un serif con grazie (build di GFS Didot, SIL Open Font License 1.1: la
// licenza e le note stanno accanto ai file in assets/fonts/zucca-banner). I file sono serviti da /api/fonts/<famiglia>/<file> (pubblici: servono anche alla schermata di accesso) e usati
// nei PDF (titoli e piè di pagina). Nessun nome di cliente qui: aggiungere una famiglia è aggiungere una voce.
const path = require('path');
const DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const FAMIGLIE = {
  zucca_banner: {
    etichetta: 'Zuccà Banner', cartella: 'zucca-banner',
    file: { regular: 'Zucca_Banner_Regular.otf', bold: 'Zucca_Banner_Bold.otf', italic: 'Zucca_Banner_Italic.otf', boldItalic: 'Zucca_Banner_Bold_Italic.otf' },
  },
};

const valida = (chiave) => (chiave === null || chiave === undefined || chiave === '' ? null : (Object.prototype.hasOwnProperty.call(FAMIGLIE, chiave) ? chiave : undefined));
const percorso = (cartella, nome) => {
  const f = Object.values(FAMIGLIE).find((x) => x.cartella === cartella);
  return f && Object.values(f.file).includes(nome) ? path.join(DIR, f.cartella, nome) : null;
};

// Registra la famiglia in un documento pdfkit e ritorna i nomi da usare con doc.font(...), oppure null (resta Times/Helvetica).
function registraPdf(doc, chiave) {
  const f = FAMIGLIE[valida(chiave)];
  if (!f) return null;
  try {
    const nomi = {};
    for (const [stile, nome] of Object.entries(f.file)) { nomi[stile] = 'Famiglia-' + chiave + '-' + stile; doc.registerFont(nomi[stile], path.join(DIR, f.cartella, nome)); }
    return nomi;
  } catch (e) { return null; } // un file illeggibile non deve impedire il PDF
}

module.exports = { FAMIGLIE, valida, percorso, registraPdf };
