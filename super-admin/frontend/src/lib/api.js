export const API = '/api'

// Copiato da core/frontend/src/lib/api.js — serve a useApi.js (anch'esso
// copiato) usato dal Builder integrato.
function notifyUnauthorized(res) {
  if (res && res.status === 401) {
    window.dispatchEvent(new CustomEvent('platform:unauthorized'))
  }
  return res
}

// Fallimento silenzioso (2026-08-15): ogni pagina di questa app fa
// `if (res.ok) setX(...)` senza un else — una fetch fallita (token scaduto,
// backend giù, un vero incidente come quello con platform-nginx risolto in
// sessione) lascia semplicemente lo stato vuoto, indistinguibile da "0 dati
// veri". Riscrivere tutte le pagine una per una sarebbe stato il modo
// sbagliato di risolverlo (12 punti diversi da tenere allineati, e ogni
// pagina futura ripeterebbe lo stesso errore) — si intercetta invece UNA
// volta sola qui, avvolgendo window.fetch stesso, così ogni chiamata
// esistente E futura è coperta senza toccare le pagine. Un 401 continua a
// riusare 'platform:unauthorized' (già dispatched sopra da ogni pagina che
// lo chiama esplicitamente: qui lo emettiamo comunque una seconda volta per
// le tantissime pagine che non chiamano affatto notifyUnauthorized — un
// listener duplicato è innocuo, un mancato listener no); qualunque altro
// errore su una GET (le pagine gestiscono già da sole gli errori su azioni
// esplicite POST/PATCH/DELETE con un banner proprio: qui serve solo coprire
// il caricamento silenzioso in background) emette un evento generico che
// App.jsx mostra come avviso transitorio.
if (typeof window !== 'undefined' && !window.__platformFetchWrapped) {
  window.__platformFetchWrapped = true
  const realFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const res = await realFetch(...args)
    if (!res.ok) {
      const method = (args[1] && args[1].method) || 'GET'
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      if (url.startsWith(API)) {
        if (res.status === 401) window.dispatchEvent(new CustomEvent('platform:unauthorized'))
        else if (method === 'GET') window.dispatchEvent(new CustomEvent('platform:load-error', { detail: { url, status: res.status } }))
      }
    }
    return res
  }
}

export { notifyUnauthorized }
