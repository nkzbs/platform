import React from 'react'
import Icon from '../../components/Icon'
import Select from '../../components/Select'
import { openUploadedFile } from '../../lib/api'

// Le righe dei moduli collegati (es. i figli di un record) aperte sotto la scheda: elenco, aggiunta, modifica ed eliminazione di una riga. Lo stato e le azioni restano nella scheda
// del record (RecordDetailModal), che le passa qui: questo file disegna soltanto.
export default function RigheFiglie({ figli, childSchemas, childData, childRelatedRecs, childAddForms, childAddingRow, childEditForms, childEditingRow, childSaving, childUploading, openSection, setOpenSection, setChildAddForms, setChildAddingRow, setChildEditForms, startEditingChildRow, cancelEditingChildRow, saveChildRow, saveChildRowEdit, deleteChildRow, renderChildFieldInput, uploadChildFile, token }) {
  return (
    <>
            {figli.filter((c) => openSection === 'child:' + c.module_slug).map((c) => {
              const cSchema = childSchemas[c.module_slug]
              const cFields = cSchema ? (cSchema.fields || []).filter((f) => f.key !== c.relation_key && f.type !== 'computed') : []
              const cRelations = cSchema ? (cSchema.relations || []).filter((r) => r.key !== c.relation_key) : []
              const displayFields = cFields.slice(0, 6)
              const rows = childData[c.module_slug] || []
              const isAddingRow = !!childAddingRow[c.module_slug]
              const addForm = childAddForms[c.module_slug] || {}
              const isSaving = !!childSaving[c.module_slug]
              // Campi calcolati del figlio (es. margini, ammortamenti residui...): esclusi
              // da displayFields perché non compilabili nel form "Aggiungi riga", ma vanno
              // comunque mostrati in lettura — qualunque campo computed di qualunque modulo,
              // non solo casi specifici (prima qui viveva un'eccezione hardcoded solo per
              // "attrezzature" viste da "clienti"; ora è lo stesso trattamento generico di
              // ogni altro campo computed dell'app).
              const computedFields = cSchema ? (cSchema.fields || []).filter((f) => f.key !== c.relation_key && f.type === 'computed') : []
              return (
                // Stesso involucro "pannello aperto" di stato/cronologia/allegati (bg-surface-page
                // + bordo + padding) — prima questo pannello aveva solo l'header nudo con la
                // tabella boxata sotto, senza il bordo esterno che rende ovvio "questa è la card
                // che si è aperta" — segnalato dall'utente ("la parte che si apre non si capisce
                // bene"). Aggiunta anche una X di chiusura esplicita nell'header: prima l'unico
                // modo di richiudere era ritrovare e ricliccare la stessa tile più in alto.
                <div key={c.module_slug} id={'collegati-' + c.module_slug} className="mb-4 p-3 rounded-lg bg-surface-page border border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-3 flex-wrap">
                    <Icon name={c.module_icon || 'box'} size={12} />{c.module_name}
                    <span className="text-gray-600 font-normal">({rows.length})</span>
                    <button
                      onClick={() => setChildAddingRow((p) => ({ ...p, [c.module_slug]: !isAddingRow }))}
                      className="ml-auto flex items-center gap-1 text-[10px] text-green-400 hover:text-green-300 bg-green-400/10 hover:bg-green-400/20 px-2 py-0.5 rounded transition"
                    >
                      <Icon name={isAddingRow ? 'x' : 'plus'} size={10} />
                      {isAddingRow ? 'Annulla' : 'Aggiungi riga'}
                    </button>
                    <button onClick={() => setOpenSection(null)} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={12} /></button>
                  </div>
                  <div className="bg-surface-input rounded-lg border border-gray-800 overflow-hidden">
                    {(rows.length > 0 || displayFields.length > 0) && (
                      // overflow-x-auto SOLO sulla tabella, non sul contenitore esterno (che
                      // deve restare overflow-hidden per gli angoli arrotondati) — con molte
                      // colonne, e ancora di più quando "Aggiungi riga" sostituisce celle di
                      // sola lettura con input/select più larghi, la tabella può superare la
                      // larghezza del pannello. Prima il contenitore la tagliava silenziosamente
                      // (overflow-hidden ovunque): l'ultima colonna — il bottone Salva della riga
                      // in aggiunta — spariva del tutto invece di restare raggiungibile scorrendo.
                      <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        {displayFields.length > 0 && (
                          <thead>
                            <tr className="border-b border-gray-800">
                              {displayFields.map((f) => (
                                <th key={f.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{f.label}</th>
                              ))}
                              {cRelations.slice(0, 2).map((r) => (
                                <th key={r.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{r.label}</th>
                              ))}
                              {computedFields.map((f) => (
                                <th key={f.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{f.label}</th>
                              ))}
                              <th className="px-2 py-1.5 w-6"></th>
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {rows.map((cr) => {
                            const isEditingThisRow = childEditingRow[c.module_slug] === cr.id
                            const editForm = childEditForms[c.module_slug] || {}
                            if (isEditingThisRow) {
                              return (
                                <tr key={cr.id} className="border-b border-accent/40 bg-blue-950/20">
                                  {displayFields.map((f) => (
                                    <td key={f.key} className="px-1.5 py-1.5">
                                      {renderChildFieldInput(f, editForm[f.key], (v) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: v } })))}
                                    </td>
                                  ))}
                                  {cRelations.slice(0, 2).map((r) => {
                                    const relData = childRelatedRecs[r.target_module]
                                    return (
                                      <td key={r.key} className="px-1.5 py-1.5">
                                        {relData ? (
                                          <Select
                                            value={editForm[r.key] || ''}
                                            onChange={(v) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: v } }))}
                                            placeholder={r.label + '...'}
                                            options={relData.records.map((rec) => ({ value: rec.id, label: relData.byId[rec.id] || '#' + rec.id }))}
                                          />
                                        ) : (
                                          <input type="text" className="w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent"
                                            placeholder={r.label} value={editForm[r.key] || ''}
                                            onChange={(e) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: e.target.value } }))} />
                                        )}
                                      </td>
                                    )
                                  })}
                                  {computedFields.map((f) => (
                                    <td key={f.key} className="px-3 py-2 text-gray-500 font-mono text-[10px]">{cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '—'}</td>
                                  ))}
                                  <td className="px-1.5 py-1.5 whitespace-nowrap">
                                    <button onClick={() => saveChildRowEdit(c)} disabled={!!childSaving[c.module_slug]} className="text-green-400 hover:text-green-300 disabled:opacity-50 transition mr-1.5"><Icon name="check" size={13} /></button>
                                    <button onClick={() => cancelEditingChildRow(c)} className="text-gray-500 hover:text-gray-300 transition"><Icon name="x" size={13} /></button>
                                  </td>
                                </tr>
                              )
                            }
                            return (
                              <tr key={cr.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30 group">
                                {displayFields.map((f) => (
                                  <td key={f.key} className="px-3 py-2 text-gray-300">
                                    {f.type === 'file'
                                      ? (cr.data[f.key] && cr.data[f.key].id
                                          ? <button onClick={() => openUploadedFile(cr.data[f.key], token)} className="text-accent hover:opacity-80 transition flex items-center gap-1"><Icon name="file" size={11} />{cr.data[f.key].name}</button>
                                          : '')
                                      : f.type === 'boolean' || f.type === 'checkbox'
                                      ? (cr.data[f.key] ? <Icon name="check" size={12} /> : '')
                                      : (cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '')}
                                  </td>
                                ))}
                                {cRelations.slice(0, 2).map((r) => (
                                  <td key={r.key} className="px-3 py-2 text-gray-500 text-[10px]">{cr.data[r.key] ? '#' + cr.data[r.key] : ''}</td>
                                ))}
                                {computedFields.map((f) => (
                                  <td key={f.key} className="px-3 py-2 text-gray-400 font-mono">{cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '—'}</td>
                                ))}
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <button onClick={() => startEditingChildRow(c, cr)} className="text-gray-600 hover:text-accent transition mr-2 opacity-0 group-hover:opacity-100"><Icon name="edit" size={11} /></button>
                                  <button onClick={() => deleteChildRow(c, cr.id)} className="text-red-400/40 hover:text-red-400 transition"><Icon name="trash" size={11} /></button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      </div>
                    )}
                    {rows.length === 0 && !isAddingRow && (
                      <div className="text-xs text-gray-600 p-3">Nessuna riga — usa &quot;Aggiungi riga&quot; per iniziare</div>
                    )}
                    {/* "Aggiungi riga" a schede impilate (un campo per riga, etichetta sopra), non più dentro la
                       tabella: su mobile, con 4-5 colonne, una riga di <td> stretti schiacciava i controlli l'uno
                       sull'altro (il menu "Seleziona..." del Tipo copriva il resto del form) — segnalato
                       dall'utente il 29/10 ("allegare un file è complicato"). Stesso identico stato/logica di
                       prima, solo il contenitore cambia. */}
                    {isAddingRow && (
                      <div className="p-3 border-t border-green-800/40 bg-green-950/20 space-y-2.5">
                        {displayFields.map((f) => (
                          <div key={f.key}>
                            <label className="text-[10px] text-gray-500 block mb-1">{f.label}</label>
                            {f.type === 'select' ? (
                              <Select
                                value={addForm[f.key] || ''}
                                onChange={(v) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: v } }))}
                                options={(f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))}
                              />
                            ) : f.type === 'boolean' || f.type === 'checkbox' ? (
                              <input type="checkbox" checked={!!addForm[f.key]} onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: e.target.checked } }))} className="ml-1" />
                            ) : f.type === 'file' ? (
                              <div>
                                <input type="file" className="w-full text-xs text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-800 file:text-gray-300 file:text-xs hover:file:bg-gray-700 file:cursor-pointer cursor-pointer"
                                  onChange={(e) => uploadChildFile(c.module_slug, f.key, e.target.files[0])} />
                                {childUploading[c.module_slug + '.' + f.key] && <div className="text-[10px] text-gray-500 mt-0.5">Caricamento...</div>}
                                {addForm[f.key] && !childUploading[c.module_slug + '.' + f.key] && (
                                  <div className="text-xs text-green-400 mt-0.5 flex items-center gap-1 truncate"><Icon name="check" size={10} />{addForm[f.key].name}</div>
                                )}
                              </div>
                            ) : (
                              <input
                                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                                className="w-full min-w-0 max-w-full bg-surface-input text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                placeholder={f.label}
                                value={addForm[f.key] || ''}
                                onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: e.target.value } }))}
                              />
                            )}
                          </div>
                        ))}
                        {cRelations.slice(0, 2).map((r) => {
                          const relData = childRelatedRecs[r.target_module]
                          return (
                            <div key={r.key}>
                              <label className="text-[10px] text-gray-500 block mb-1">{r.label}</label>
                              {relData ? (
                                <Select
                                  value={addForm[r.key] || ''}
                                  onChange={(v) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: v } }))}
                                  placeholder={r.label + '...'}
                                  options={relData.records.map((rec) => ({ value: rec.id, label: relData.byId[rec.id] || '#' + rec.id }))}
                                />
                              ) : (
                                <input
                                  type="text"
                                  className="w-full bg-surface-input text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                  placeholder={r.label}
                                  value={addForm[r.key] || ''}
                                  onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: e.target.value } }))}
                                />
                              )}
                            </div>
                          )
                        })}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => setChildAddingRow((p) => ({ ...p, [c.module_slug]: false }))} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-1.5 rounded text-xs transition">Annulla</button>
                          <button onClick={() => saveChildRow(c)} disabled={isSaving} className="flex-1 bg-green-600 hover:opacity-90 disabled:opacity-50 text-white py-1.5 rounded text-xs font-medium transition">{isSaving ? 'Salvo...' : 'Salva'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
    </>
  )
}
