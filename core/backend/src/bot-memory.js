'use strict';
// Bot Telegram: memoria minima per i "seguiti" di una domanda sui dati ("quanto ho speso in
// benzina a settembre?" → "e il mese scorso?"). Oggi bot-ai.js interpreta ogni frase da sola: la
// seconda, presa isolata, non vuol dire niente per il modello. Un solo scambio per chat, non una
// cronologia — basta a far funzionare "e..."/"anche..." — e scade da sola (15 minuti) così una
// domanda nuova non eredita per sbaglio il contesto di una vecchia.
const db = require('./db');

const TTL_MS = 15 * 60 * 1000;

// { testo, capito } dell'ultimo scambio di questa chat, o null se non c'è (o è scaduto).
function get(chatId) {
  const row = db.prepare('SELECT testo, capito, updated_at FROM telegram_memory WHERE chat_id = ?').get(String(chatId));
  if (!row || Date.now() - row.updated_at > TTL_MS) return null;
  return { testo: row.testo, capito: row.capito };
}

function save(chatId, testo, capito) {
  db.prepare('DELETE FROM telegram_memory WHERE updated_at < ?').run(Date.now() - TTL_MS); // pulizia opportunistica, stesso stile di telegram_pending
  db.prepare(`INSERT INTO telegram_memory (chat_id, testo, capito, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET testo = excluded.testo, capito = excluded.capito, updated_at = excluded.updated_at`)
    .run(String(chatId), String(testo || '').slice(0, 300), String(capito || '').slice(0, 300), Date.now());
}

function clear(chatId) { db.prepare('DELETE FROM telegram_memory WHERE chat_id = ?').run(String(chatId)); }

module.exports = { get, save, clear };
