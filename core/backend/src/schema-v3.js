// Ponte CommonJS verso l'UNICA fonte di verità in shared/schema-v3-core.js
// (radice del repo, ESM, condivisa davvero col frontend — vedi i commenti lì).
// Node supporta require() sincrono di moduli ESM dalla versione 22 in poi (questo
// backend gira su node:22-alpine), quindi questo file non contiene più logica
// propria. Il percorso relativo (3 livelli, ../../../shared/) è quello corretto
// su disco (core/backend/src/ -> radice repo); dentro il container Docker
// funziona comunque, perché lì /app/src/ è a soli 2 livelli da /shared/ e i
// "../" in eccesso oltre la radice del filesystem sono no-op (path.resolve li
// tronca alla radice) — stesso identico file, path corretto in entrambi i mondi.
module.exports = require('../../../shared/schema-v3-core.js');
