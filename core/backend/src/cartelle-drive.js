'use strict';
// Le cartelle di Google Drive diventano le scelte del campo «cartella» di un archivio (drive-poller.js). Alcune non devono farlo (dichiarate in seeds/cartelle-drive.json:
// moduli e nomi stanno lì, non nel codice): `alias` {nome in Drive: scelta vera} (una cartella vecchia o scritta in modo diverso conta come la scelta giusta),
// `ignora` [nomi] (cartelle di prova o d'appoggio: non diventano una scelta e i file dentro restano senza cartella).
const REGOLE = require('./seeds/cartelle-drive.json');

// Il nome da usare per una cartella di Drive in un archivio: la scelta vera, oppure null se la cartella si ignora.
function nomeCartella(slug, nome, regole = REGOLE) {
  const r = regole[slug];
  if (!r || typeof nome !== 'string') return nome;
  if ((r.ignora || []).includes(nome)) return null;
  return (r.alias && Object.prototype.hasOwnProperty.call(r.alias, nome)) ? r.alias[nome] : nome;
}

// Una lista di nomi di cartelle di Drive, già tradotti (senza ignorate né doppioni).
function nomiCartelle(slug, nomi, regole = REGOLE) {
  return [...new Set((nomi || []).map((n) => nomeCartella(slug, n, regole)).filter(Boolean))];
}

module.exports = { nomeCartella, nomiCartelle, REGOLE };
