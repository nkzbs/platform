'use strict';
// Foto profilo utente — sempre locali su disco, mai su Drive (a differenza degli
// allegati di upload-storage.js): un avatar deve restare raggiungibile da un <img
// src> SENZA header Authorization (il browser non li manda sulle immagini), quindi
// è servito pubblico via express.static (vedi index.js, mount su /api/avatars) e
// non ha senso farlo passare dal flusso Drive/record-attachment pensato per
// documenti privati collegati a un record. Vive in una sottocartella di UPLOAD_DIR
// (non una cartella/variabile d'ambiente a sé) apposta per non dover toccare
// docker-compose/volumi sul NAS per questa funzione.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('./upload-storage');

const AVATAR_DIR = path.join(UPLOAD_DIR, '_avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

function isAllowedAvatarMime(mime) {
  return !!EXT_BY_MIME[mime];
}

function saveAvatar(buffer, mime) {
  const name = crypto.randomUUID() + EXT_BY_MIME[mime];
  fs.writeFileSync(path.join(AVATAR_DIR, name), buffer);
  return name;
}

function deleteAvatar(name) {
  if (!name) return;
  const filePath = path.join(AVATAR_DIR, name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { AVATAR_DIR, isAllowedAvatarMime, saveAvatar, deleteAvatar };
