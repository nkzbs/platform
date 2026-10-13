import React, { useState } from 'react'

// Il link di un invito, con i modi di consegnarlo: copiarlo, aprire WhatsApp col messaggio già scritto (wa.me, tu premi «invia»), condividerlo su Telegram (t.me/share).
// Nessun invio automatico: WhatsApp e Telegram non permettono a un'app di scrivere per prima a una persona nuova. Il link vale una volta sola e per `ore` ore.
// Usato da tenant e Super Admin; stile con i token comuni (bg-gray-800, text-ink, accent).
export default function InviteShare({ link, nome, progetto, ore = 72 }) {
  const [copiato, setCopiato] = useState(false)
  const [tel, setTel] = useState('')
  const messaggio = (nome ? 'Ciao ' + nome + ', ' : 'Ciao, ') + 'ti ho invitato su ' + (progetto || 'Platform') + '. Apri il link e scegli il tuo nome utente e la tua password (vale ' + ore + ' ore, una volta sola):'
  const copia = async () => {
    try { await navigator.clipboard.writeText(link); setCopiato(true); setTimeout(() => setCopiato(false), 2000) } catch (e) { window.prompt('Copia il link:', link) }
  }
  const cifre = tel.replace(/[^0-9]/g, '')
  const wa = 'https://wa.me/' + cifre + '?text=' + encodeURIComponent(messaggio + ' ' + link)
  const tg = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(messaggio)
  const btn = 'text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 transition text-center'
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 bg-surface-page text-ink px-3 py-2 rounded-lg text-xs font-mono outline-none border border-gray-800" />
        <button type="button" onClick={copia} className={btn}>{copiato ? 'Copiato' : 'Copia'}</button>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="Numero (facoltativo): 39333…" className="w-44 bg-surface-page text-ink px-3 py-2 rounded-lg text-xs outline-none border border-gray-800" />
        <a href={wa} target="_blank" rel="noopener noreferrer" className={btn}>Apri WhatsApp</a>
        <a href={tg} target="_blank" rel="noopener noreferrer" className={btn}>Condividi su Telegram</a>
      </div>
      <p className="text-[11px] text-gray-500">WhatsApp e Telegram si aprono con il messaggio già scritto: premi tu «invia». Il link vale {ore} ore e si usa una volta sola.</p>
    </div>
  )
}
