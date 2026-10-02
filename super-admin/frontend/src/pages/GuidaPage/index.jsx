import React, { useState, useEffect } from 'react'
import { API } from '../../lib/api'
import { GUIDA_SECTIONS } from './content'
import RichText from '../../components/RichText'
import Icon from '../../components/Icon'

// PLATFORM-UI-REDESIGN-CATALOG.md #10 — chiave stabile per il feedback di un
// argomento: gli argomenti vivono in un file JS statico (content.js), non in
// una tabella con un id proprio, quindi lo slug è derivato da sezione+titolo
// (stesso principio "chiave stabile senza id dedicato" già in uso altrove,
// es. tenant_name in monitoring.js) — instabile solo se un titolo cambia,
// stesso limite accettato altrove in questo codebase.
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Tempo di lettura calcolato dal conteggio parole reale del testo — non un
// dato inventato, solo derivato (200 parole/min, stima standard).
const readingTime = (body) => {
  const words = body.join(' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

// Guida di Super Admin — stessa struttura di navigazione della Guida in
// core/frontend (sezioni con icona/colore, argomenti, ricerca, Precedente/
// Successivo), ma senza il tab "Percorso guidato": lì serviva a orientare chi
// scopre Platform Core per la prima volta dentro un tenant; qui il pubblico è
// sempre lo stesso operatore che amministra la piattaforma, un indice di
// riferimento diretto basta.
function GuidaPage({ token }) {
  const [openSection, setOpenSection] = useState(GUIDA_SECTIONS[0].title)
  const [openTopic, setOpenTopic] = useState(null)
  const [query, setQuery] = useState('')
  // PLATFORM-UI-REDESIGN-CATALOG.md #10 — feedback 👍👎 reale (non solo
  // visivo): conteggi letti da GET /guida/feedback/:topicKey, un voto per
  // sessione di pagina (myVote, si azzera cambiando argomento).
  const [feedback, setFeedback] = useState(null)
  const [myVote, setMyVote] = useState(null)

  const matches = (text) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase())
  const filteredSections = GUIDA_SECTIONS.map((s) => ({
    ...s,
    topics: s.topics.filter((t) => matches(t.title) || t.body.some((p) => matches(p))),
  })).filter((s) => s.topics.length > 0)

  const current = openTopic && filteredSections.find((s) => s.title === openTopic.section)?.topics.find((t) => t.title === openTopic.title)
  const currentSection = openTopic && filteredSections.find((s) => s.title === openTopic.section)
  const topicKey = openTopic ? slugify(openTopic.section + '-' + openTopic.title) : null

  const flatTopics = filteredSections.flatMap((s) => s.topics.map((t) => ({ section: s.title, title: t.title, color: s.color })))
  const currentIdx = openTopic ? flatTopics.findIndex((t) => t.section === openTopic.section && t.title === openTopic.title) : -1
  const prevTopic = currentIdx > 0 ? flatTopics[currentIdx - 1] : null
  const nextTopic = currentIdx >= 0 && currentIdx < flatTopics.length - 1 ? flatTopics[currentIdx + 1] : null

  useEffect(() => {
    setFeedback(null); setMyVote(null)
    if (!topicKey) return
    fetch(API + '/guida/feedback/' + topicKey, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.ok && r.json()).then((d) => d && setFeedback(d))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey])

  const vote = async (useful) => {
    if (myVote !== null || !topicKey) return
    setMyVote(useful)
    setFeedback((f) => f && { ...f, useful: f.useful + (useful ? 1 : 0), not_useful: f.not_useful + (useful ? 0 : 1) })
    await fetch(API + '/guida/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ topic_key: topicKey, useful }) })
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Guida</h1>
      <p className="text-gray-500 text-sm mb-6">Come funziona il pannello di amministrazione — tenant, Store moduli, Super Builder, aggiornamenti, attività.</p>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-80 flex-shrink-0">
          <div className="relative mb-3">
            <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setOpenTopic(null) }} placeholder="Cerca nella guida…"
              className="w-full bg-surface-page text-ink pl-8 pr-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary transition" />
          </div>
          <div className="bg-surface-card border border-gray-800 rounded-xl divide-y divide-gray-800/70 max-h-[70vh] overflow-y-auto">
            {filteredSections.map((s) => (
              <div key={s.title}>
                <button onClick={() => setOpenSection(openSection === s.title ? null : s.title)}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/5 transition">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: s.color + '22', color: s.color }}>
                    <Icon name={s.icon} size={14} />
                  </div>
                  <span className="text-xs font-semibold text-ink flex-1">{s.title}</span>
                  <span className="text-[10px] text-gray-600 font-mono">{s.topics.length}</span>
                  <Icon name={openSection === s.title || query ? 'chevron-down' : 'chevron-right'} size={12} className="text-gray-600" />
                </button>
                {(openSection === s.title || query) && (
                  <div className="pb-2">
                    {s.topics.map((t) => (
                      <button key={t.title} onClick={() => setOpenTopic({ section: s.title, title: t.title })}
                        className={'w-full text-left pl-14 pr-4 py-2 text-xs transition ' + (openTopic && openTopic.title === t.title ? 'text-cp-primary bg-cp-primary/10' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filteredSections.length === 0 && <div className="text-xs text-gray-600 text-center py-8">Nessun risultato per "{query}".</div>}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {!current ? (
            <div>
              <div className="text-sm text-gray-500 mb-4">Scegli un argomento dalla lista a sinistra, o parti da qui:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredSections.map((s) => (
                  <button key={s.title} onClick={() => { setOpenSection(s.title); setOpenTopic({ section: s.title, title: s.topics[0].title }) }}
                    className="text-left bg-surface-card border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition group">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: s.color + '22', color: s.color }}>
                        <Icon name={s.icon} size={16} />
                      </div>
                      <span className="text-xs font-semibold text-ink group-hover:text-ink transition">{s.title}</span>
                    </div>
                    <div className="text-xs text-gray-600">{s.topics.length} argoment{s.topics.length === 1 ? 'o' : 'i'}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-surface-card border border-gray-800 rounded-xl overflow-hidden max-w-2xl">
              <div className="h-1.5" style={{ backgroundColor: currentSection?.color || '#2563EB' }} />
              <div className="p-6">
                <button onClick={() => setOpenTopic(null)} className="text-xs text-gray-600 hover:text-gray-400 transition mb-2 flex items-center gap-1">
                  <Icon name={currentSection?.icon || 'grid'} size={11} style={{ color: currentSection?.color }} />
                  {openTopic.section}
                </button>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <h2 className="text-xl font-bold text-ink">{current.title}</h2>
                  <span className="text-xs text-gray-600 flex items-center gap-1 flex-shrink-0">
                    <Icon name="clock" size={11} />{readingTime(current.body)} min di lettura
                  </span>
                </div>

                {/* PLATFORM-UI-REDESIGN-CATALOG.md #10 — "indice in questa pagina":
                    qui il contenuto è prosa, non ha sotto-titoli propri — l'indice
                    onesto è quindi la lista degli altri argomenti della stessa
                    categoria, non una TOC inventata su paragrafi senza intestazioni. */}
                {currentSection && currentSection.topics.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-gray-800/70">
                    {currentSection.topics.map((t) => (
                      <button key={t.title} onClick={() => setOpenTopic({ section: currentSection.title, title: t.title })}
                        disabled={t.title === current.title}
                        className={'text-[11px] px-2.5 py-1 rounded-full transition ' + (t.title === current.title ? 'bg-cp-primary/20 text-cp-primary cursor-default' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {current.body.map((p, i) => <p key={i} className="text-sm text-gray-300 leading-relaxed"><RichText text={p} /></p>)}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 mt-6 pt-4 border-t border-gray-800/70">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Utile?</span>
                    <button onClick={() => vote(true)} disabled={myVote !== null}
                      className={'px-2 py-1 rounded-lg transition flex items-center gap-1 ' + (myVote === true ? 'bg-green-900/30 text-green-400' : 'hover:bg-white/5 disabled:hover:bg-transparent')}>
                      👍 {feedback ? feedback.useful : ''}
                    </button>
                    <button onClick={() => vote(false)} disabled={myVote !== null}
                      className={'px-2 py-1 rounded-lg transition flex items-center gap-1 ' + (myVote === false ? 'bg-red-900/30 text-red-400' : 'hover:bg-white/5 disabled:hover:bg-transparent')}>
                      👎 {feedback ? feedback.not_useful : ''}
                    </button>
                  </div>
                </div>

                {(prevTopic || nextTopic) && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800/70">
                    {prevTopic ? (
                      <button onClick={() => setOpenTopic({ section: prevTopic.section, title: prevTopic.title })}
                        className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1.5 text-left">
                        <Icon name="chevron-left" size={12} />
                        <span>{prevTopic.title}</span>
                      </button>
                    ) : <span />}
                    {nextTopic && (
                      <button onClick={() => setOpenTopic({ section: nextTopic.section, title: nextTopic.title })}
                        className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1.5 text-right">
                        <span>{nextTopic.title}</span>
                        <Icon name="chevron-right" size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GuidaPage
