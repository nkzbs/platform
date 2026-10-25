'use strict';
// Un solo punto che parla con l'API reale di Platform — mai una seconda copia
// della logica dell'app: ogni strumento MCP chiama ESATTAMENTE le stesse rotte
// che userebbe il browser, con gli stessi permessi dell'utente del token
// (Impostazioni → Il mio account → Token API).
const PLATFORM_URL = (process.env.PLATFORM_URL || '').replace(/\/+$/, '');
const PLATFORM_API_TOKEN = process.env.PLATFORM_API_TOKEN || '';

if (!PLATFORM_URL) throw new Error('PLATFORM_URL non impostato (es. https://finance.platform-core.it)');
if (!PLATFORM_API_TOKEN) throw new Error('PLATFORM_API_TOKEN non impostato — crealo da Impostazioni → Il mio account → Token API, nell\'app Platform');

async function call(method, path, body) {
  const res = await fetch(PLATFORM_URL + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PLATFORM_API_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* risposta vuota */ }
  if (!res.ok) {
    const msg = (data && data.error) || (res.status + ' ' + res.statusText);
    throw new Error(msg);
  }
  return data;
}

module.exports = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
  put: (path, body) => call('PUT', path, body),
};
