'use strict';
// Regole sul marchio dell'azienda (impostazioni del tenant), usate dalle impostazioni e dalla creazione da analisi.

// Il logo è un indirizzo https oppure un'immagine incorporata (PNG/JPEG/WebP, fino a ~700 KB): niente altro,
// perché finisce anche in un <img> e nei PDF.
function logoValido(url) {
  return /^https:\/\//i.test(url) || (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length < 950000);
}

module.exports = { logoValido };
