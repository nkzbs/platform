import React, { useState } from 'react'
import { GUIDA_SECTIONS } from './content'
import GuidedPath from './GuidedPath'
import ModuleGuide from './ModuleGuide'
import RichText from '../../components/RichText'
import Icon from '../../components/Icon'

function GuidaPage({ modules, token }) {
  const [tab, setTab] = useState('percorso')
  const [openSection, setOpenSection] = useState(GUIDA_SECTIONS[0].title)
  const [openTopic, setOpenTopic] = useState(null)
  const [query, setQuery] = useState('')

  const matches = (text) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase())
  const filteredSections = GUIDA_SECTIONS.map((s) => ({
    ...s,
    topics: s.topics.filter((t) => matches(t.title) || t.body.some((p) => matches(p))),
  })).filter((s) => s.topics.length > 0)

  const current = openTopic && filteredSections.find((s) => s.title === openTopic.section)?.topics.find((t) => t.title === openTopic.title)
  const currentSection = openTopic && filteredSections.find((s) => s.title === openTopic.section)

  // Lista piatta di tutti gli argomenti nell'ordine mostrato in sidebar — serve solo per
  // "Precedente/Successivo" in fondo al pannello di lettura, non un dato salvato a parte.
  const flatTopics = filteredSections.flatMap((s) => s.topics.map((t) => ({ section: s.title, title: t.title, color: s.color })))
  const currentIdx = openTopic ? flatTopics.findIndex((t) => t.section === openTopic.section && t.title === openTopic.title) : -1
  const prevTopic = currentIdx > 0 ? flatTopics[currentIdx - 1] : null
  const nextTopic = currentIdx >= 0 && currentIdx < flatTopics.length - 1 ? flatTopics[currentIdx + 1] : null

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Guida</h1>
      <p className="text-gray-500 text-sm mb-5">Come funziona Platform — moduli, campi, relazioni, permessi, automazioni e il resto.</p>

      <div className="flex items-center gap-1 mb-6 border-b border-gray-800">
        <button onClick={() => setTab('percorso')}
          className={'px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ' + (tab === 'percorso' ? 'text-ink border-accent' : 'text-gray-500 border-transparent hover:text-gray-300')}>
          Percorso guidato
        </button>
        <button onClick={() => setTab('riferimento')}
          className={'px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ' + (tab === 'riferimento' ? 'text-ink border-accent' : 'text-gray-500 border-transparent hover:text-gray-300')}>
          Riferimento
        </button>
        <button onClick={() => setTab('moduli')}
          className={'px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ' + (tab === 'moduli' ? 'text-ink border-accent' : 'text-gray-500 border-transparent hover:text-gray-300')}>
          I tuoi moduli
        </button>
      </div>

      {tab === 'percorso' ? <GuidedPath /> : tab === 'moduli' ? <ModuleGuide modules={modules} /> : (
      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-80 flex-shrink-0">
          <div className="relative mb-3">
            <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setOpenTopic(null) }} placeholder="Cerca nella guida…"
              className="w-full bg-surface-page text-ink pl-8 pr-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" />
          </div>
          <div className="bg-surface-card border border-gray-800 rounded-xl divide-y divide-gray-800/70 max-h-[70vh] overflow-y-auto">
            {filteredSections.map((s) => (
              <div key={s.title}>
                <button onClick={() => setOpenSection(openSection === s.title ? null : s.title)}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/5 transition">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: s.color + '22', color: s.color }}>
                    <Icon name={s.icon} size={14} />
                  </div>
                  <span className="text-sm font-semibold text-ink flex-1">{s.title}</span>
                  <span className="text-[10px] text-gray-600 font-mono">{s.topics.length}</span>
                  <Icon name={openSection === s.title || query ? 'chevron-down' : 'chevron-right'} size={12} className="text-gray-600" />
                </button>
                {(openSection === s.title || query) && (
                  <div className="pb-2">
                    {s.topics.map((t) => (
                      <button key={t.title} onClick={() => setOpenTopic({ section: s.title, title: t.title })}
                        className={'w-full text-left pl-14 pr-4 py-2 text-xs transition ' + (openTopic && openTopic.title === t.title ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-ink hover:bg-white/5')}>
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
            // Prima era una sola riga grigia ("Seleziona un argomento") — una porta
            // d'ingresso più povera di quanto la guida meriti. Griglia di sezioni come
            // punto di partenza: click su una apre subito il suo primo argomento,
            // stesso colore/icona già definiti in content.js, nessun dato nuovo.
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
                      <span className="text-sm font-semibold text-ink group-hover:text-white transition">{s.title}</span>
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
                  <Icon name={currentSection?.icon || 'home'} size={11} style={{ color: currentSection?.color }} />
                  {openTopic.section}
                </button>
                <h2 className="text-xl font-bold text-ink mb-4">{current.title}</h2>
                <div className="space-y-3">
                  {current.body.map((p, i) => <p key={i} className="text-sm text-gray-300 leading-relaxed"><RichText text={p} /></p>)}
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
      )}
    </div>
  )
}

export default GuidaPage
