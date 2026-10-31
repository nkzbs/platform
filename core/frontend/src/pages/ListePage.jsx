import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'

const toast = (message, type = 'success') => window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message, type } }))

// Liste di opzioni condivise tra campi select/multiselect di moduli diversi (Builder,
// Fase 2 della semplificazione ispirata a Collections — vedi
// core/backend/src/routes/option-lists.js). Un campo si collega a una lista dal
// Builder; da qui si gestiscono le voci — ogni add/rename/remove si propaga da solo a
// tutti i campi collegati (e, per il rename, alle righe già esistenti).
function ListePage({ token }) {
  const api = useApi(token)
  const [lists, setLists] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newItemValue, setNewItemValue] = useState('')
  const [renaming, setRenaming] = useState(null) // { itemId, value }
  const [busy, setBusy] = useState(false)
  const [confirmDeleteList, setConfirmDeleteList] = useState(false)

  const loadLists = async () => { const data = await api.get('/option-lists'); if (data) setLists(data) }
  const loadDetail = async (id) => {
    setLoadingDetail(true)
    const data = await api.get('/option-lists/' + id)
    setDetail(data || null)
    setLoadingDetail(false)
  }
  useEffect(() => { loadLists() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null) }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createList = async () => {
    const name = newListName.trim()
    if (!name) return
    setBusy(true)
    const { ok, data } = await api.post('/option-lists', { name })
    setBusy(false)
    if (ok) {
      setNewListName('')
      await loadLists()
      setSelectedId(data.id)
      toast('Lista creata')
    } else toast((data && data.error) || 'Errore nella creazione', 'error')
  }

  const renameList = async (name) => {
    if (!name || !name.trim() || !selectedId) return
    setBusy(true)
    const { ok, data } = await api.patch('/option-lists/' + selectedId, { name: name.trim() })
    setBusy(false)
    if (ok) { await loadLists(); await loadDetail(selectedId); toast('Lista rinominata') }
    else toast((data && data.error) || 'Errore nel rinominare', 'error')
  }

  const deleteList = async () => {
    setBusy(true)
    const { ok, data } = await api.del('/option-lists/' + selectedId)
    setBusy(false)
    setConfirmDeleteList(false)
    if (ok) {
      toast('Lista eliminata' + (data.moduli_aggiornati ? ` — ${data.moduli_aggiornati} campi scollegati (le loro opzioni restano come sono ora)` : ''))
      setSelectedId(null)
      await loadLists()
    } else toast((data && data.error) || 'Errore nell\'eliminare', 'error')
  }

  const addItem = async () => {
    const v = newItemValue.trim()
    if (!v || !selectedId) return
    setBusy(true)
    const { ok, data } = await api.post('/option-lists/' + selectedId + '/items', { value: v })
    setBusy(false)
    if (ok) { setNewItemValue(''); await loadDetail(selectedId); toast('Voce aggiunta' + (data.moduli_aggiornati ? ` a ${data.moduli_aggiornati} campi collegati` : '')) }
    else toast((data && data.error) || 'Errore nell\'aggiungere', 'error')
  }

  const renameItem = async (itemId, value) => {
    if (!value || !value.trim()) return
    setBusy(true)
    const { ok, data } = await api.patch('/option-lists/' + selectedId + '/items/' + itemId, { value: value.trim() })
    setBusy(false)
    setRenaming(null)
    if (ok) { await loadDetail(selectedId); toast('Voce rinominata' + (data.righe ? ` — ${data.righe} righe aggiornate` : '')) }
    else toast((data && data.error) || 'Errore nel rinominare', 'error')
  }

  const removeItem = async (itemId) => {
    setBusy(true)
    const { ok, data } = await api.del('/option-lists/' + selectedId + '/items/' + itemId)
    setBusy(false)
    if (ok) { await loadDetail(selectedId); toast('Voce tolta') }
    else toast((data && data.error) || 'Errore nel togliere', 'error')
  }

  const inputCls = 'bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition'

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <div className="glass-panel p-4">
        <div className="text-xs font-semibold text-gray-500 mb-3">LISTE CONDIVISE</div>
        {lists === null ? (
          <div className="text-sm text-gray-600">Caricamento...</div>
        ) : lists.length === 0 ? (
          <div className="text-sm text-gray-600 mb-3">Nessuna lista ancora — crea la prima qui sotto, o dal Builder scegliendo "Usa una lista condivisa" su un campo a scelta.</div>
        ) : (
          <div className="space-y-1 mb-3">
            {lists.map((l) => (
              <button key={l.id} onClick={() => setSelectedId(l.id)}
                className={'w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ' + (selectedId === l.id ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:bg-gray-800 hover:text-ink')}>
                <span className="truncate">{l.name}</span>
                <span className="text-[11px] text-gray-600 flex-shrink-0 ml-2">{l.item_count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input className={inputCls + ' flex-1 min-w-0 text-xs py-1.5'} placeholder="Nuova lista..." value={newListName}
            onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createList()} />
          <button onClick={createList} disabled={busy || !newListName.trim()} className="bg-accent hover:opacity-90 disabled:opacity-40 text-white px-2.5 rounded-lg transition flex-shrink-0">
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div className="glass-panel p-5">
        {!selectedId ? (
          <div className="text-sm text-gray-600 py-8 text-center">Seleziona una lista, o creane una nuova.</div>
        ) : loadingDetail || !detail ? (
          <div className="text-sm text-gray-600">Caricamento...</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <input defaultValue={detail.name} key={detail.id} onBlur={(e) => e.target.value !== detail.name && renameList(e.target.value)}
                className="text-lg font-bold text-ink bg-transparent outline-none border-b border-transparent focus:border-gray-700 transition" />
              <button onClick={() => setConfirmDeleteList(true)} className="text-[11px] text-red-400/70 hover:text-red-400 transition flex items-center gap-1">
                <Icon name="trash" size={12} />Elimina lista
              </button>
            </div>
            <div className="text-[11px] text-gray-600 mb-4">
              {detail.linked.length === 0 ? 'Non collegata a nessun campo — collegala dal Builder su un campo a scelta.' : (
                <>Usata da {detail.linked.length} {detail.linked.length === 1 ? 'campo' : 'campi'}: {detail.linked.map((l) => `${l.module_name} → ${l.field_key}`).join(', ')}</>
              )}
            </div>

            <div className="space-y-1.5 mb-4">
              {detail.items.length === 0 && <div className="text-sm text-gray-600">Nessuna voce ancora.</div>}
              {detail.items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 bg-surface-page rounded-lg border border-gray-700 px-3 py-1.5">
                  {renaming && renaming.itemId === it.id ? (
                    <input autoFocus className="flex-1 bg-surface-card text-ink px-2 py-1 rounded text-sm outline-none border border-accent"
                      value={renaming.value} onChange={(e) => setRenaming({ itemId: it.id, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') renameItem(it.id, renaming.value); if (e.key === 'Escape') setRenaming(null) }}
                      onBlur={() => renaming && renameItem(it.id, renaming.value)} />
                  ) : (
                    <button className="flex-1 text-left text-sm text-ink hover:text-accent transition truncate" onClick={() => setRenaming({ itemId: it.id, value: it.value })}>{it.value}</button>
                  )}
                  <button onClick={() => removeItem(it.id)} disabled={busy} className="text-red-400/50 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={13} /></button>
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              <input className={inputCls + ' flex-1'} placeholder="Nuova voce..." value={newItemValue}
                onChange={(e) => setNewItemValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
              <button onClick={addItem} disabled={busy || !newItemValue.trim()} className="bg-accent hover:opacity-90 disabled:opacity-40 text-white px-3 rounded-lg transition text-sm font-medium">
                + Aggiungi
              </button>
            </div>
          </>
        )}
      </div>

      {confirmDeleteList && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-red-900/50">
            <h2 className="text-lg font-bold text-ink mb-2">Eliminare "{detail && detail.name}"?</h2>
            <p className="text-sm text-gray-400 mb-4">
              {detail && detail.linked.length > 0
                ? `I ${detail.linked.length} campi collegati non perdono le voci attuali — restano come lista propria del campo, non più condivisa.`
                : 'Non è collegata a nessun campo.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteList(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg transition">Annulla</button>
              <button onClick={deleteList} disabled={busy} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2.5 rounded-lg transition font-medium">Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ListePage
