import React from 'react'

// ─── CONNESSIONI ──────────────────────────────────────────────────────────────
// Sostituisce le vecchie IntegrazioniPage + AutomazioniPage. Qui resta SOLO la
// gestione delle credenziali (per tenant, non per modulo) e il log — le automazioni
// vere e proprie si configurano ora dentro ogni modulo, nel Builder (blocco
// "Automazione"), non più qui. Dati reali dal backend (GET/POST /api/connections),
// non più uno useState locale che si dimenticava tutto al reload.
// ─── GUIDA ────────────────────────────────────────────────────────────────────
// Manuale in-app, contenuto statico (non dati del tenant — spiega Platform stesso,
// identico per ogni istanza). Copre solo funzionalità REALMENTE costruite ad oggi:
// nessuna promessa di roadmap, nessuna funzione "in arrivo" — se qualcosa qui dentro
// smette di essere vero perché il codice cambia, questo testo va aggiornato insieme,
// stesso principio di onestà già seguito nel resto del prodotto.
// ─── TESTO ARRICCHITO ───────────────────────────────────────────────────────
// I paragrafi della Guida (e la descrizione dei moduli nello Store) erano rese come
// <p> di testo semplice — nessuna gerarchia visiva, un bottone citato ("Pubblica")
// si leggeva identico a un nome di campo (ordini.totale) o a una frase qualunque.
// RichText riconosce pattern già presenti nel testo esistente, senza dover riscrivere
// ogni frase a mano:
//   "Testo tra virgolette"  -> pillola (di norma un'etichetta di bottone/campo UI)
//   `testo tra backtick`    -> monospazio esplicito
//   parola.parola           -> monospazio automatico (riferimenti tipo modulo.campo,
//                              che nel testo esistente compaiono già così com'è,
//                              es. "ordini.totale")
//   **testo**               -> grassetto
function RichText({ text }) {
  if (!text) return null
  const regex = /(\*\*[^*]+\*\*)|("[^"]{1,60}")|(`[^`]+`)|(\b[a-z_]+\.[a-z_]+\b)/g
  const parts = []
  let last = 0, m, key = 0
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={key++} className="text-ink font-semibold">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('"')) {
      parts.push(<span key={key++} className="inline-block px-1.5 py-0.5 rounded bg-gray-800 text-gray-200 text-[0.9em] border border-gray-700 whitespace-nowrap">{token.slice(1, -1)}</span>)
    } else if (token.startsWith('`')) {
      parts.push(<code key={key++} className="px-1.5 py-0.5 rounded bg-surface-page text-accent text-[0.9em] font-mono border border-gray-800">{token.slice(1, -1)}</code>)
    } else {
      parts.push(<code key={key++} className="px-1.5 py-0.5 rounded bg-surface-page text-accent text-[0.9em] font-mono border border-gray-800">{token}</code>)
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

export default RichText
