import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'
import PeriodView from './PeriodView'
import ParentChildrenView from './ParentChildrenView'
import GenericView from './GenericView'

// Più viste "sostituisce tutta la tabella" alternabili a tab sullo stesso modulo —
// es. Spese Casa: tab "Spese" (period_view proprio) + tab "Debiti" (parent_children_view
// di un ALTRO modulo, letto via source_module). Ogni tab referenzia un blocco già
// dichiarato altrove per key — non lo ridefinisce, riusa esattamente gli stessi
// componenti/route già usati quando quel blocco è la vista unica di un modulo.
const BLOCK_ARRAY = {
  period_view: 'period_views',
  parent_children_view: 'parent_children_views',
  view: 'views',
}

function ViewTabs({ tabs, mod, schema, token, tableColumns, records, user }) {
  const api = useApi(token)
  const [activeIdx, setActiveIdx] = useState(0)
  const [sourceCache, setSourceCache] = useState({}) // slug -> { mod, schema }

  const activeTab = tabs[activeIdx] || tabs[0]
  const sourceSlug = activeTab.source_module || mod.slug
  const isOwn = sourceSlug === mod.slug

  useEffect(() => {
    if (isOwn || sourceCache[sourceSlug]) return
    api.get('/modules/' + sourceSlug).then((m) => {
      if (m) setSourceCache((prev) => ({ ...prev, [sourceSlug]: { mod: m, schema: parseSchemaFrontend(m.schema_json) } }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, isOwn])

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-800 overflow-x-auto">
        {tabs.map((t, i) => (
          <button key={t.key || i} onClick={() => setActiveIdx(i)}
            className={'px-4 py-2.5 text-sm whitespace-nowrap transition border-b-2 -mb-px ' + (activeIdx === i ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300')}>
            {t.label}
          </button>
        ))}
      </div>

      {(() => {
        const srcMod = isOwn ? mod : (sourceCache[sourceSlug] && sourceCache[sourceSlug].mod)
        const srcSchema = isOwn ? schema : (sourceCache[sourceSlug] && sourceCache[sourceSlug].schema)
        if (!srcMod || !srcSchema) return <div className="text-sm text-gray-600 py-6 text-center">Caricamento…</div>

        const arrayKey = BLOCK_ARRAY[activeTab.block_type]
        const config = arrayKey && (srcSchema[arrayKey] || []).find((b) => b.key === activeTab.block_key)
        if (!config) return <div className="text-sm text-red-400 py-6 text-center">Blocco "{activeTab.block_key}" non trovato su "{sourceSlug}".</div>

        // tableColumns/records hanno senso solo per il modulo PROPRIO (le colonne/righe
        // già caricate da ModulePage) — per una tab su un modulo diverso, i componenti
        // che le usano (PeriodView per le colonne della tabella
        // filtrata, ParentChildrenView per il titolo scorciatoia) restano senza, si
        // adattano già a quel caso (mostrano solo l'id se non trovano tableColumns[0]).
        const srcTableColumns = isOwn ? tableColumns : []
        const srcRecords = isOwn ? records : []

        if (activeTab.block_type === 'period_view') return <PeriodView config={config} mod={srcMod} schema={srcSchema} token={token} tableColumns={srcTableColumns} records={srcRecords} user={user} />
        if (activeTab.block_type === 'parent_children_view') return <ParentChildrenView config={config} mod={srcMod} schema={srcSchema} token={token} tableColumns={srcTableColumns} records={srcRecords} user={user} />
        if (activeTab.block_type === 'view') return <GenericView step={config} mod={srcMod} schema={srcSchema} token={token} tableColumns={srcTableColumns} records={srcRecords} defaultModuleSlug={srcMod.slug} />
        return null
      })()}
    </div>
  )
}

export default ViewTabs
