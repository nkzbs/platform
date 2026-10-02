import React, { useState, useEffect, useRef } from 'react'
import Icon from '../../components/Icon'
import { AGG_SIMPLE_FUNCS, AGG_IF_FUNCS, CHILD_FUNCS, CONTROL_FUNCS, FORMULA_EXAMPLES, FORMULA_EXAMPLES_CHILDREN } from './constants'

// Capisce, dato il testo e la posizione del cursore, se l'utente sta scrivendo un nome
// modulo o un nome campo dentro una funzione di aggregazione — per pilotare l'autocomplete.
// Copre sia le funzioni semplici sum/avg/count/min/max sia quelle condizionali *if, che
// possono avere più coppie modulo.campo nella stessa chiamata (target e filtro).
function getAutocompleteContext(text, caret) {
  const before = text.slice(0, caret)
  const allFuncs = [...AGG_SIMPLE_FUNCS, ...AGG_IF_FUNCS, ...CHILD_FUNCS].join('|')
  const re = new RegExp('(' + allFuncs + ')\\(((?:[^()]*,)*)\\s*([a-zA-Z_][a-zA-Z0-9_]*)?(\\.([a-zA-Z_][a-zA-Z0-9_]*)?)?$')
  const m = before.match(re)
  if (!m) return null
  const func = m[1]
  const priorArgs = m[2] || ''
  // conta gli argomenti già passati per capire se stiamo scrivendo il campo target
  // (numerico, o data per minif/maxif) o il campo filtro (qualsiasi tipo) di una *if
  const argIndex = priorArgs.split(',').filter((s) => s.trim() !== '').length
  const isFilterArg = AGG_IF_FUNCS.includes(func) && (func === 'countif' ? argIndex >= 0 : argIndex >= 1)
  const modulePart = m[3] || ''
  const hasDot = m[4] !== undefined
  const fieldPart = m[5] || ''
  if (!hasDot) return { type: 'module', func, isFilterArg, query: modulePart, from: caret - modulePart.length }
  return { type: 'field', func, module: modulePart, isFilterArg, query: fieldPart, from: caret - fieldPart.length }
}

// Editor formule: autocomplete moduli/campi (client-side, dalla cache), validazione live
// e anteprima del risultato sui dati reali del tenant (debounced verso il backend, unica
// fonte di verità). Il pannello di riferimento resta sempre disponibile, non un tooltip.
function FormulaEditor({ value, onChange, fieldCache, api, context }) {
  const inputRef = React.useRef(null)
  const debounceRef = React.useRef(null)
  const [caret, setCaret] = useState(0)
  const [ctx, setCtx] = useState(null)
  const [check, setCheck] = useState(null)
  const [checking, setChecking] = useState(false)
  const [showRef, setShowRef] = useState(false)

  const updateCaretCtx = (el) => {
    const pos = el.selectionStart
    setCaret(pos)
    setCtx(getAutocompleteContext(el.value, pos))
  }

  useEffect(() => {
    if (!value || !value.trim()) { setCheck(null); setChecking(false); return }
    setChecking(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await api.post('/builder/formula/check', { expr: value, context: context || null })
      setCheck(res.data)
      setChecking(false)
    }, 450)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, context && context.currentModule])

  const insertAt = (from, to, text) => {
    const next = value.slice(0, from) + text + value.slice(to)
    onChange(next)
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const pos = from + text.length
        inputRef.current.focus()
        inputRef.current.setSelectionRange(pos, pos)
        updateCaretCtx(inputRef.current)
      }
    })
  }

  const pickModule = (slug) => { if (ctx) insertAt(ctx.from, caret, slug + '.') }
  const pickField = (key) => {
    if (!ctx) return
    const isMultiArg = AGG_IF_FUNCS.includes(ctx.func)
    insertAt(ctx.from, caret, isMultiArg ? key + ', ' : key + ')')
  }

  const filteredModules = ctx && ctx.type === 'module'
    ? fieldCache.filter((m) => m.slug.toLowerCase().includes(ctx.query.toLowerCase()))
    : []
  const filteredFields = ctx && ctx.type === 'field'
    ? (fieldCache.find((m) => m.slug === ctx.module)?.fields || [])
        .filter((f) => f.key.toLowerCase().includes(ctx.query.toLowerCase()))
        .filter((f) => {
          if (ctx.isFilterArg) return true // campo filtro: qualsiasi tipo ammesso
          if (ctx.func === 'count' || ctx.func === 'countif' || ctx.func === 'count_children') return true
          if (['min', 'max', 'minif', 'maxif', 'min_children', 'max_children'].includes(ctx.func)) {
            return ['number', 'currency', 'date', 'datetime'].includes(f.type)
          }
          return ['number', 'currency'].includes(f.type)
        })
    : []

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-1.5">
        <input
          ref={inputRef}
          className="flex-1 w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-cp-primary transition font-mono"
          placeholder="es. sumif(ordini.totale, ordini.stato, '==', 'pagato')"
          value={value}
          onChange={(e) => { onChange(e.target.value); updateCaretCtx(e.target) }}
          onKeyUp={(e) => updateCaretCtx(e.target)}
          onClick={(e) => updateCaretCtx(e.target)}
          onBlur={() => setTimeout(() => setCtx(null), 150)}
        />
        <button type="button" onClick={() => setShowRef((s) => !s)}
          title="Riferimento sintassi"
          className={'p-2 rounded-lg border transition flex-shrink-0 ' + (showRef ? 'bg-cp-primary/20 text-cp-primary border-cp-primary/50' : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300')}>
          <Icon name="info" size={14} />
        </button>
      </div>

      {ctx && ctx.type === 'module' && filteredModules.length > 0 && (
        <div className="absolute z-20 w-64 bg-surface-card border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filteredModules.map((m) => (
            <div key={m.slug} onMouseDown={() => pickModule(m.slug)}
              className="px-3 py-2 text-xs text-gray-300 hover:bg-cp-primary/20 hover:opacity-80 cursor-pointer flex items-center gap-2">
              <Icon name={m.icon || 'box'} size={12} /><span className="font-mono">{m.slug}</span>
              <span className="text-gray-600">— {m.name}</span>
            </div>
          ))}
        </div>
      )}
      {ctx && ctx.type === 'field' && (
        <div className="absolute z-20 w-64 bg-surface-card border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filteredFields.length > 0 ? filteredFields.map((f) => (
            <div key={f.key} onMouseDown={() => pickField(f.key)}
              className="px-3 py-2 text-xs text-gray-300 hover:bg-cp-primary/20 hover:opacity-80 cursor-pointer flex items-center justify-between">
              <span className="font-mono">{f.key}</span><span className="text-gray-600">{f.type}</span>
            </div>
          )) : (
            <div className="px-3 py-2 text-xs text-gray-600">
              {ctx.func === 'count' ? 'Nessun campo trovato' : 'Nessun campo numerico trovato in questo modulo'}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] mt-1 min-h-[14px]">
        {checking && <span className="text-gray-600">Verifica in corso…</span>}
        {!checking && check && check.valid && (
          <span className="text-green-400 flex items-center gap-1">
            <Icon name="check" size={11} />
            Valida — risultato attuale: <span className="font-mono">{typeof check.value === 'number' ? check.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : String(check.value)}</span>
          </span>
        )}
        {!checking && check && !check.valid && (
          <span className="text-red-400 flex items-center gap-1"><Icon name="x" size={11} />{check.errors[0]}</span>
        )}
        {!checking && !check && !(value || '').trim() && <span className="text-gray-600">Scrivi una formula per vedere l'anteprima dal vivo</span>}
      </div>

      {check && check.valid && check.breakdown && check.breakdown.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {check.breakdown.map((b, i) => {
            const fieldType = b.module && b.field
              ? (fieldCache.find((m) => m.slug === b.module)?.fields || []).find((f) => f.key === b.field)?.type
              : null
            const isDateAgg = ['date', 'datetime'].includes(fieldType) && (b.func === 'min' || b.func === 'max' || b.func === 'minif' || b.func === 'maxif')
            const display = isDateAgg
              ? new Date(b.value * 86400000).toLocaleDateString('it-IT', { timeZone: 'UTC' })
              : (typeof b.value === 'number' ? b.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : String(b.value))
            return (
              <span key={i} className="text-[10px] bg-surface-page border border-gray-800 text-gray-500 px-2 py-1 rounded-md font-mono">
                {b.expr} = {display}
              </span>
            )
          })}
        </div>
      )}

      {showRef && (
        <div className="mt-2 bg-surface-page border border-gray-800 rounded-lg p-3 text-[11px] text-gray-400 space-y-2.5">
          <div>
            <div className="text-gray-300 font-semibold mb-1">Sintassi</div>
            <div className="font-mono text-gray-500">funzione(modulo.campo)</div>
          </div>
          <div>
            <div className="text-gray-300 font-semibold mb-1">Aggregazioni semplici</div>
            <div className="grid grid-cols-2 gap-1">
              <div><span className="font-mono text-cp-primary">sum</span> — somma</div>
              <div><span className="font-mono text-cp-primary">avg</span> — media</div>
              <div><span className="font-mono text-cp-primary">count</span> — conteggio</div>
              <div><span className="font-mono text-cp-primary">min</span> / <span className="font-mono text-cp-primary">max</span></div>
            </div>
          </div>
          <div>
            <div className="text-gray-300 font-semibold mb-1">Aggregazioni condizionali</div>
            <div className="font-mono text-gray-500 mb-1">funzioneif(modulo.target, modulo.filtro, 'operatore', valore)</div>
            <div className="grid grid-cols-2 gap-1">
              <div><span className="font-mono text-cp-primary">sumif</span> / <span className="font-mono text-cp-primary">avgif</span></div>
              <div><span className="font-mono text-cp-primary">minif</span> / <span className="font-mono text-cp-primary">maxif</span></div>
              <div className="col-span-2"><span className="font-mono text-cp-primary">countif</span>(modulo.filtro, 'op', valore) — senza target</div>
            </div>
            <div className="text-gray-600 mt-1">operatori: '==' '!=' '&gt;' '&lt;' '&gt;=' '&lt;=' — su campi testo/scelta solo '==' e '!='</div>
            <div className="text-gray-600 mt-1">il "modulo.filtro" può anche essere il nome di una relazione many_to_one del modulo target verso un altro modulo, es. <span className="font-mono text-cp-primary">sumif(movimenti_righe.dare, conto.codice, '==', '5900')</span> filtra per un campo del conto collegato, non solo per un campo proprio.</div>
          </div>
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Aggregazioni sui figli</div>
              <div className="font-mono text-gray-500 mb-1">funzione_children(modulo_figlio.campo)</div>
              <div className="grid grid-cols-2 gap-1">
                <div><span className="font-mono text-cp-primary">sum_children</span> / <span className="font-mono text-cp-primary">avg_children</span></div>
                <div><span className="font-mono text-cp-primary">min_children</span> / <span className="font-mono text-cp-primary">max_children</span></div>
                <div className="col-span-2"><span className="font-mono text-cp-primary">count_children</span>(modulo_figlio) — senza campo</div>
              </div>
              <div className="text-gray-600 mt-1">il collegamento al record corrente si deduce dalla relazione già creata nel modulo figlio (tab Relazioni) — nessuna configurazione aggiuntiva</div>
            </div>
          )}
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Aggregazioni sui figli, filtrate</div>
              <div className="font-mono text-gray-500 mb-1">funzioneif_children(modulo_figlio.campo, campo_filtro, 'op', valore)</div>
              <div className="grid grid-cols-2 gap-1">
                <div><span className="font-mono text-cp-primary">sumif_children</span> / <span className="font-mono text-cp-primary">avgif_children</span></div>
                <div><span className="font-mono text-cp-primary">minif_children</span> / <span className="font-mono text-cp-primary">maxif_children</span></div>
                <div className="col-span-2"><span className="font-mono text-cp-primary">countif_children</span>(modulo_figlio.campo_filtro, 'op', valore) — senza campo target</div>
              </div>
              <div className="text-gray-600 mt-1">come sum_children ma somma solo i figli che soddisfano il filtro — es. <span className="font-mono text-cp-primary">totale - sumif_children(note_credito.totale_calcolato, _stato, '==', 'emessa') - sumif_children(pagamenti.importo, _stato, '!=', 'stornato')</span> per un residuo che esclude bozze e storni.</div>
            </div>
          )}
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Fascia attiva (scaglioni)</div>
              <div className="font-mono text-gray-500 mb-1">active_tier(campo_scaglioni, valore)</div>
              <div className="text-gray-600">restituisce la percentuale della fascia con soglia più alta ≤ valore (o l'ultima se nessuna soglia è raggiunta) — es. <span className="font-mono text-cp-primary">active_tier(scaglioni_provvigione, fatturato_lifetime)</span>. "valore" può essere un altro campo di questo modulo (anche calcolato) o un numero fisso.</div>
            </div>
          )}
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Progressivo cumulato</div>
              <div className="font-mono text-gray-500 mb-1">running_sum(campo, campo_data[, 'mese'|'anno'])</div>
              <div className="text-gray-600">somma "campo" (anche calcolato) su tutti i record di questo modulo fino alla data di questo record inclusa — es. <span className="font-mono text-cp-primary">running_sum(netto, data, 'mese')</span> per un saldo che riparte da zero ogni mese. Senza il terzo argomento, cumulativo su tutto lo storico.</div>
            </div>
          )}
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Aggregazioni per periodo</div>
              <div className="font-mono text-gray-500 mb-1">sum_period/avg_period/min_period/max_period(modulo.campo, modulo.campo_data, 'periodo')</div>
              <div className="text-gray-600 mb-1">aggrega solo le righe con data nel periodo scelto — <span className="font-mono text-cp-primary">'mese_corrente'</span>, <span className="font-mono text-cp-primary">'mese_scorso'</span>, <span className="font-mono text-cp-primary">'anno_corrente'</span>, o un numero di giorni (es. <span className="font-mono text-cp-primary">30</span> = ultimi 30 giorni). <span className="font-mono text-cp-primary">count_period(modulo.campo_data, 'periodo')</span> conta senza campo target.</div>
              <div className="font-mono text-gray-500 mb-1">sumif_period/avgif_period/minif_period/maxif_period(modulo.campo, modulo.campo_data, 'periodo', modulo.campo_filtro, 'op', valore)</div>
              <div className="text-gray-600">come sopra ma con in più un filtro (stesso modulo) — es. <span className="font-mono text-cp-primary">sumif_period(spese.importo, spese.data, 'mese_corrente', spese.categoria, '==', 'Rata')</span> per le sole rate del mese corrente. <span className="font-mono text-cp-primary">countif_period(modulo.campo_data, 'periodo', modulo.campo_filtro, 'op', valore)</span> conta senza campo target.</div>
            </div>
          )}
          {context && context.currentModule && (
            <div>
              <div className="text-gray-300 font-semibold mb-1">Riferimento ad un altro aggregato</div>
              <div className="text-gray-600">in un blocco "Formula/Aggregato" a valore singolo (non raggruppato), scrivi semplicemente la <span className="font-mono text-cp-primary">chiave</span> di un altro aggregato dello stesso modulo per usarne il valore — es. <span className="font-mono text-cp-primary">0.4*(1-dti) + 0.4*pct_pagato</span> dove "dti" e "pct_pagato" sono chiavi di altri aggregati già definiti in questo modulo. Un ciclo (A che referenzia B che referenzia di nuovo A) blocca la formula con un errore invece di calcolare un numero sbagliato.</div>
            </div>
          )}
          <div>
            <div className="text-gray-300 font-semibold mb-1">Funzioni di controllo</div>
            <div className="grid grid-cols-2 gap-1">
              <div><span className="font-mono text-cp-primary">round</span>(x, decimali)</div>
              <div><span className="font-mono text-cp-primary">if</span>(condizione, a, b)</div>
              <div><span className="font-mono text-cp-primary">today</span>()</div>
              <div><span className="font-mono text-cp-primary">diff_days</span>(a, b)</div>
              <div><span className="font-mono text-cp-primary">year</span> / <span className="font-mono text-cp-primary">month</span> / <span className="font-mono text-cp-primary">day</span></div>
            </div>
            <div className="text-gray-600 mt-1">condizione = confronto tra aggregati, es. count(ordini) &gt; 0</div>
          </div>
          <div>
            <div className="text-gray-300 font-semibold mb-1">Operatori ammessi</div>
            <div className="font-mono text-gray-500">+  −  *  /  ( )  ,  ==  !=  &gt;  &lt;  &gt;=  &lt;=</div>
          </div>
          <div>
            <div className="text-gray-300 font-semibold mb-1">Esempi — clic per inserire</div>
            <div className="flex flex-wrap gap-1.5">
              {[...FORMULA_EXAMPLES, ...(context && context.currentModule ? FORMULA_EXAMPLES_CHILDREN : [])].map((ex) => (
                <button key={ex.label} type="button" onClick={() => onChange(ex.expr)}
                  className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-md transition font-mono">
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FormulaEditor
