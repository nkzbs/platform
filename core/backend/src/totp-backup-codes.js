// Ponte CommonJS verso l'UNICA fonte di verità in shared/totp-backup-codes.js —
// stesso identico ponte già in uso per shared/rate-limit.js e shared/schema-v3-core.js.
module.exports = require('../../../shared/totp-backup-codes.js');
