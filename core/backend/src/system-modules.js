'use strict';
// Funzioni di sistema che per storia sono salvate come moduli (i loro dati stanno nella tabella
// `records` con questi slug) ma che si gestiscono dalle Impostazioni, non dal menu: non compaiono
// tra i moduli, né nella Libreria, né nel Builder. Il motore (notifiche, riepilogo, poller Gmail)
// continua a leggere le loro righe come prima.
const SYSTEM_MODULES = ['gmail_regole', 'whatsapp_destinatari'];
const SQL_NOT_SYSTEM = SYSTEM_MODULES.map((s) => "'" + s + "'").join(',');
module.exports = { SYSTEM_MODULES, SQL_NOT_SYSTEM, isSystem: (slug) => SYSTEM_MODULES.includes(slug) };
