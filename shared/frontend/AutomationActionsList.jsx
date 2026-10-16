// Vive in shared/frontend/ — condiviso davvero tra core/frontend e
// super-admin/frontend (vedi BuilderPage/index.jsx in entrambe), non più
// duplicato a mano. Import solo verso sibling di shared/, mai verso l'albero
// src/ di una delle due app, così il file funziona identico da qualunque
// Dockerfile lo copi (entrambi copiano shared/ su /shared, vedi COPY shared/
// /shared/ in core/Dockerfile e super-admin/frontend/Dockerfile).
import React from 'react'
import { HIDDEN_CONNECTOR_ACTIONS, INTERNAL_ACTIONS } from '../schema-v3-core.js'

// Icon.jsx richiede lucide-react iniettato dal chiamante (vedi il commento lì) —
// questo file è anch'esso in shared/, senza un proprio node_modules, e usa
// una sola icona fissa in due punti: più semplice inlineare qui l'esatto SVG di
// lucide-react's Trash2 (stesso stroke/outline di tutte le altre icone
// dell'app) che ripetere l'iniezione per un solo utilizzo statico.
function TrashIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

// ─── AUTOMAZIONE — blocco nel Builder ──────────────────────────────────────────
// Le automazioni non sono più una lista globale scollegata (vecchia AutomazioniPage):
// sono un blocco come Campo o Relazione, dentro il modulo a cui appartengono — su
// richiesta esplicita di raggruppare integrazioni/automazioni per modulo invece di
// tenerle come voci di menu separate scomode da navigare.
//
// Le azioni di un'automazione sono una lista piatta di { kind: 'action', ... } con,
// opzionalmente, blocchi { kind: 'condition', ... } che ne racchiudono un sotto-gruppo
// in un ramo Se/Altrimenti. Annidamento illimitato: una condizione dentro un altro
// ramo then/otherwise è supportata sia dal componente (si richiama da solo su
// item.then/item.otherwise, vedi sotto) sia dal motore (automation-engine.js,
// runAzioni è ricorsiva) — il limite a un solo livello che c'era prima era SOLO
// nella UI (il flag allowCondition passato come false ai rami annidati nascondeva
// il tasto "+ Se/Altrimenti"), non un vincolo strutturale nei dati o nel motore.
function newAction() {
  return { id: 'act_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'action', target: '', azione: '', config: '' }
}

function newCondition() {
  return { id: 'cnd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'condition', a: '', op: '>', b: { literal: 0 }, then: [], otherwise: [] }
}

function AutomationOperandPicker({ value, onChange, fields }) {
  const isLiteral = value && typeof value === 'object' && 'literal' in value
  return (
    <div className="flex items-center gap-1.5">
      <select className="bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition"
        value={isLiteral ? '__literal__' : (value || '')}
        onChange={(e) => onChange(e.target.value === '__literal__' ? { literal: 0 } : e.target.value)}>
        <option value="">Campo...</option>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
        <option value="__literal__">Valore fisso...</option>
      </select>
      {isLiteral && (
        <input type="number" className="w-16 bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition"
          value={value.literal} onChange={(e) => onChange({ literal: parseFloat(e.target.value) || 0 })} />
      )}
    </div>
  )
}

// Una riga azione: sceglie una Connessione GIÀ connessa (pagina Connessioni, globale
// per tenant) e una delle sue azioni disponibili. Se non c'è nessuna connessione
// attiva lo dice esplicitamente, invece di mostrare una select vuota e silenziosa.
function CreaRecordConfig({ config, onChange }) {
  const cfg = config && typeof config === 'object' ? config : {}
  return (
    <div className="w-full mt-1 space-y-1.5 bg-surface-card rounded-md p-2 border border-gray-700">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-14">Modulo</span>
        <input className="flex-1 bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700" placeholder="slug del modulo" value={cfg.modulo || ''} onChange={(e) => onChange({ ...cfg, modulo: e.target.value })} />
      </div>
      <div className="text-[10px] text-gray-500">Dati (JSON) — usa "campo:chiave", "_oggi_", "_ora_":</div>
      <textarea className="w-full bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 resize-none font-mono" rows={3}
        value={typeof cfg.dati === 'object' ? JSON.stringify(cfg.dati, null, 2) : (cfg.dati || '{}')}
        onChange={(e) => { try { onChange({ ...cfg, dati: JSON.parse(e.target.value) }) } catch {} }} />
    </div>
  )
}

function CreaRecordNVolteConfig({ config, onChange }) {
  const cfg = config && typeof config === 'object' ? config : {}
  return (
    <div className="w-full mt-1 space-y-1.5 bg-surface-card rounded-md p-2 border border-gray-700">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-14">Modulo</span>
        <input className="flex-1 bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700" placeholder="slug" value={cfg.modulo || ''} onChange={(e) => onChange({ ...cfg, modulo: e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-14">N (campo)</span>
        <input className="flex-1 bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700" placeholder="campo con il numero di record da creare (es. n_rate)" value={cfg.n_field || ''} onChange={(e) => onChange({ ...cfg, n_field: e.target.value, n: undefined })} />
      </div>
      <div className="text-[10px] text-gray-500">Dati (JSON) — usa "campo:chiave", "__indice__", "_oggi_", "mese_offset:campo_data":</div>
      <textarea className="w-full bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 resize-none font-mono" rows={4}
        placeholder={'{\n  "debito_id": "campo:id",\n  "numero": "__indice__",\n  "scadenza": "mese_offset:data_prima_rata"\n}'}
        value={typeof cfg.dati === 'object' ? JSON.stringify(cfg.dati, null, 2) : (cfg.dati || '')}
        onChange={(e) => { try { onChange({ ...cfg, dati: JSON.parse(e.target.value) }) } catch {} }} />
    </div>
  )
}

// Le 5 righe sotto sono un input di testo + una select operazione — stesso schema
// ricorrente in aggiorna_record, estratto per
// non ripetere il markup 3 volte.
function Riga({ label, placeholder, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-24 flex-shrink-0">{label}</span>
      <input className="flex-1 bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700" placeholder={placeholder} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function OperazioneSelect({ value, onChange }) {
  return (
    <select className="bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700 w-28" value={value || 'set'} onChange={(e) => onChange(e.target.value)}>
      <option value="set">Imposta</option>
      <option value="increment">Incrementa</option>
      <option value="decrement">Decrementa</option>
    </select>
  )
}

// Textarea JSON generica per le parti di config troppo annidate per una form dedicata
// (oggetti/array dinamici) — stesso pattern già usato per 'dati' in Crea Record.
function AggiornaRecordConfig({ config, onChange }) {
  const cfg = config && typeof config === 'object' ? config : {}
  return (
    <div className="w-full mt-1 space-y-1.5 bg-surface-card rounded-md p-2 border border-gray-700">
      <Riga label="Modulo" placeholder="slug del modulo da aggiornare" value={cfg.modulo} onChange={(v) => onChange({ ...cfg, modulo: v })} />
      <Riga label="Campo con l'ID" placeholder="campo del record corrente con l'id target, o '__self__'" value={cfg.id_field} onChange={(v) => onChange({ ...cfg, id_field: v })} />
      <Riga label="Campo da aggiornare" placeholder="es. stock_attuale" value={cfg.campo} onChange={(v) => onChange({ ...cfg, campo: v })} />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-24 flex-shrink-0">Operazione</span>
        <OperazioneSelect value={cfg.operazione} onChange={(v) => onChange({ ...cfg, operazione: v })} />
      </div>
      <Riga label="Valore" placeholder="numero, nome campo, o letterale per 'Imposta'" value={cfg.valore} onChange={(v) => onChange({ ...cfg, valore: v })} />
      {cfg.valore === 'numero_annuale' && (
        <Riga label="Numero di partenza" placeholder="es. 1049 — per continuare la numerazione di un sistema precedente (default 0)" value={cfg.numero_annuale_offset} onChange={(v) => onChange({ ...cfg, numero_annuale_offset: v })} />
      )}
      <div className="text-[10px] text-gray-600">"__self__" come campo ID punta al record corrente (utile per auto-transizioni, es. impostare _stato). Il valore può anche usare "relazione:campo:modulo:campo_sorgente" per copiare un campo da un record collegato, o "conto:XXXX" per un conto del piano dei conti per codice. "numero_annuale" cerca sempre il numero più alto già usato quest'anno (mai una collisione, anche cancellando record) — "Numero di partenza" serve solo se il primo numero deve continuare da un sistema precedente.</div>
    </div>
  )
}

function InviaNotificaConfig({ config, onChange }) {
  const cfg = config && typeof config === 'object' ? config : {}
  return (
    <div className="w-full mt-1 space-y-1.5 bg-surface-card rounded-md p-2 border border-gray-700">
      <Riga label="Tag trigger" placeholder="es. rata_scadenza, bolletta — libero, non una lista fissa" value={cfg.trigger_tag} onChange={(v) => onChange({ ...cfg, trigger_tag: v })} />
      <div>
        <div className="text-[10px] text-gray-500 mb-1">Messaggio — usa {'{{campo}}'} per valori del record</div>
        <textarea className="w-full bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 resize-none"
          rows={2} value={cfg.messaggio || ''} onChange={(e) => onChange({ ...cfg, messaggio: e.target.value })} />
      </div>
      <div className="text-[10px] text-gray-600">Invia via CallMeBot (connessione "WhatsApp (CallMeBot)") a tutti i destinatari WhatsApp (Impostazioni → Notifiche) iscritti a questo tag.</div>
    </div>
  )
}

function InviaReportPeriodicoConfig({ config, onChange }) {
  const cfg = config && typeof config === 'object' ? config : {}
  return (
    <div className="w-full mt-1 space-y-1.5 bg-surface-card rounded-md p-2 border border-gray-700">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-24 flex-shrink-0">Periodo</span>
        <select className="flex-1 bg-surface-page text-ink px-2 py-1 rounded-md text-xs outline-none border border-gray-700"
          value={cfg.periodo || 'settimana'} onChange={(e) => onChange({ ...cfg, periodo: e.target.value })}>
          <option value="settimana">Ultimi 7 giorni</option>
          <option value="mese">Mese solare precedente</option>
        </select>
      </div>
      <Riga label="Campo importo" placeholder="importo" value={cfg.campo_importo} onChange={(v) => onChange({ ...cfg, campo_importo: v })} />
      <Riga label="Campo data" placeholder="data" value={cfg.campo_data} onChange={(v) => onChange({ ...cfg, campo_data: v })} />
      <Riga label="Raggruppa per" placeholder="es. categoria — opzionale" value={cfg.raggruppa_per} onChange={(v) => onChange({ ...cfg, raggruppa_per: v })} />
      <Riga label="Titolo messaggio" placeholder="es. 📊 Report settimanale Spese Casa" value={cfg.titolo} onChange={(v) => onChange({ ...cfg, titolo: v })} />
      <Riga label="Tag trigger" placeholder="es. report — libero, non una lista fissa" value={cfg.trigger_tag} onChange={(v) => onChange({ ...cfg, trigger_tag: v })} />
      <div className="text-[10px] text-gray-600">Somma il campo importo di tutti i record di QUESTO modulo nel periodo scelto (opzionale: spaccato per il campo scelto in "Raggruppa per", top 5). Pensata per un'automazione schedulata SENZA "esegui una volta per record" — gira una volta sola.</div>
    </div>
  )
}

// Le etichette vivono in INTERNAL_ACTIONS (schema-v3-core.js, sibling di questo file) — unica
// fonte condivisa anche con HIDDEN_CONNECTOR_ACTIONS, invece di una lista propria
// di questo file da tenere sincronizzata a mano con quella.
const AZIONE_LABELS = Object.fromEntries(Object.entries(INTERNAL_ACTIONS).map(([k, v]) => [k, v.label]))

function AutomationActionRow({ action, onChange, onRemove, connections }) {
  const isInterno = action.target === '__interno__'
  const connected = connections.filter((c) => c.connected)
  const currentIntg = connections.find((c) => c.id === action.target)
  // 'invia_notifica' & co. sono azioni "interne" solo nel nome — chiamano davvero un
  // connettore esterno dietro le quinte (vedi HIDDEN_CONNECTOR_ACTIONS, gemella di
  // automation-engine.js). Se quel connettore non è collegato, l'azione resta
  // selezionabile ma disattivata qui invece di lasciarla configurabile e scoprire solo
  // dopo, nel log automazioni, che veniva eseguita "simulata".
  const hiddenConnectorId = HIDDEN_CONNECTOR_ACTIONS[action.azione]
  const hiddenConnectorIntg = hiddenConnectorId && connections.find((c) => c.id === hiddenConnectorId)
  const hiddenConnectorMissing = hiddenConnectorId && !(hiddenConnectorIntg && hiddenConnectorIntg.connected)
  return (
    <div className="flex items-center gap-2 flex-wrap bg-surface-page rounded-lg p-2 border border-gray-800">
      <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition"
        value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value, azione: '' })}>
        <option value="">Connessione...</option>
        <option value="__interno__">— Azione interna —</option>
        {connected.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {isInterno ? (
        <>
          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition"
            value={action.azione} onChange={(e) => onChange({ ...action, azione: e.target.value, config: {} })}>
            <option value="">Azione...</option>
            {Object.entries(AZIONE_LABELS).map(([k, label]) => {
              const connId = HIDDEN_CONNECTOR_ACTIONS[k]
              const intg = connId && connections.find((c) => c.id === connId)
              const missing = connId && !(intg && intg.connected)
              return <option key={k} value={k} disabled={missing}>{label}{missing ? ' — non collegata' : ''}</option>
            })}
          </select>
          {hiddenConnectorMissing && (
            <div className="text-[10px] text-amber-500 w-full">
              {(hiddenConnectorIntg && hiddenConnectorIntg.name) || hiddenConnectorId} non è collegata — vai su Store, sulla card di un modulo che la richiede, per collegarla prima di usare questa azione.
            </div>
          )}
          {action.azione === 'crea_record' && (
            <CreaRecordConfig config={action.config} onChange={(v) => onChange({ ...action, config: v })} />
          )}
          {action.azione === 'crea_record_n_volte' && (
            <CreaRecordNVolteConfig config={action.config} onChange={(v) => onChange({ ...action, config: v })} />
          )}
          {action.azione === 'notifica_interna' && (() => {
            // config era solo una stringa (il messaggio) — ora può essere un oggetto
            // {message, roles, category}. Una config stringa esistente resta valida:
            // qui la si legge come messaggio e si scrive un oggetto solo se l'utente
            // tocca ruoli/categoria, così un'automazione mai toccata non cambia forma.
            const isObj = action.config && typeof action.config === 'object'
            const message = isObj ? (action.config.message || '') : (typeof action.config === 'string' ? action.config : '')
            const roles = isObj && Array.isArray(action.config.roles) ? action.config.roles : []
            const category = isObj ? (action.config.category || '') : ''
            const patch = (p) => onChange({ ...action, config: { message, roles, category, ...p } })
            return (
              <div className="w-full mt-1 space-y-2">
                <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600"
                  placeholder="Messaggio — usa {{campo}} per valori del record"
                  value={message} onChange={(e) => patch({ message: e.target.value })} />
                <input className="w-full bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 placeholder-gray-600"
                  placeholder="Categoria (opzionale, per filtrare/tracciare le notifiche — usa {{campo}} per un valore del record)"
                  value={category} onChange={(e) => patch({ category: e.target.value })} />
                {allRoles && allRoles.length > 0 && (
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Destinatari — vuoto = visibile a tutti</label>
                    <div className="flex gap-3 flex-wrap">
                      {allRoles.map(({ name: role, label: roleLabel }) => (
                        <label key={role} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                          <input type="checkbox" checked={roles.includes(role)}
                            onChange={(e) => patch({ roles: e.target.checked ? [...roles, role] : roles.filter((r) => r !== role) })}
                            className="accent-blue-500" />
                          {roleLabel}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
          {action.azione === 'invia_notifica' && (
            <InviaNotificaConfig config={action.config} onChange={(v) => onChange({ ...action, config: v })} />
          )}
          {action.azione === 'invia_report_periodico' && (
            <InviaReportPeriodicoConfig config={action.config} onChange={(v) => onChange({ ...action, config: v })} />
          )}
          {action.azione === 'aggiorna_record' && (
            <AggiornaRecordConfig config={action.config} onChange={(v) => onChange({ ...action, config: v })} />
          )}
        </>
      ) : (
        <>
          <select className="bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition"
            value={action.azione} onChange={(e) => onChange({ ...action, azione: e.target.value })} disabled={!currentIntg}>
            <option value="">Azione...</option>
            {currentIntg && currentIntg.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="flex-1 min-w-[100px] bg-surface-card text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition placeholder-gray-600"
            placeholder="testo/config (opzionale)" value={typeof action.config === 'string' ? action.config : ''} onChange={(e) => onChange({ ...action, config: e.target.value })} />
          {connected.length === 0 && !isInterno && <div className="text-[10px] text-amber-500 w-full">Nessuna connessione attiva — vai su Store, sulla card di un modulo che la richiede, per collegarne una.</div>}
        </>
      )}
      <button onClick={onRemove} className="text-red-400/60 hover:text-red-400 transition flex-shrink-0"><TrashIcon size={12} /></button>
    </div>
  )
}

function AutomationActionsList({ azioni, onChange, connections, fields, allowCondition, allRoles }) {
  const list = azioni || []
  const update = (idx, next) => { const copy = [...list]; copy[idx] = next; onChange(copy) }
  const remove = (idx) => { const copy = [...list]; copy.splice(idx, 1); onChange(copy) }
  const add = (item) => onChange([...list, item])

  return (
    <div className="space-y-2">
      {list.map((item, idx) => item.kind === 'condition' ? (
        <div key={item.id} className="border border-amber-800/40 rounded-lg p-2.5 bg-amber-950/10">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[11px] text-amber-400 font-semibold">Se</span>
            <AutomationOperandPicker value={item.a} onChange={(v) => update(idx, { ...item, a: v })} fields={fields} />
            <select className="bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-blue-500 transition w-16"
              value={item.op} onChange={(e) => update(idx, { ...item, op: e.target.value })}>
              <option value=">">&gt;</option><option value="<">&lt;</option>
              <option value=">=">&ge;</option><option value="<=">&le;</option>
              <option value="==">=</option><option value="!=">&ne;</option>
            </select>
            <AutomationOperandPicker value={item.b} onChange={(v) => update(idx, { ...item, b: v })} fields={fields} />
            <button onClick={() => remove(idx)} className="text-red-400/60 hover:text-red-400 transition ml-auto"><TrashIcon size={12} /></button>
          </div>
          <div className="text-[10px] text-gray-500 mb-1">Allora:</div>
          <AutomationActionsList azioni={item.then} onChange={(v) => update(idx, { ...item, then: v })} connections={connections} fields={fields} allowCondition={true} allRoles={allRoles} />
          <div className="text-[10px] text-gray-500 mt-2 mb-1">Altrimenti:</div>
          <AutomationActionsList azioni={item.otherwise} onChange={(v) => update(idx, { ...item, otherwise: v })} connections={connections} fields={fields} allowCondition={true} allRoles={allRoles} />
        </div>
      ) : (
        <AutomationActionRow key={item.id} action={item} onChange={(v) => update(idx, v)} onRemove={() => remove(idx)} connections={connections} />
      ))}
      {list.length === 0 && <div className="text-[11px] text-gray-600 border border-dashed border-gray-800 rounded-lg py-3 text-center">Nessuna azione — aggiungine una.</div>}
      <div className="flex gap-2">
        <button onClick={() => add(newAction())} className="flex-1 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-medium transition">+ Azione</button>
        {allowCondition && <button onClick={() => add(newCondition())} className="flex-1 py-1.5 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 text-[11px] font-medium transition">+ Se/Altrimenti</button>}
      </div>
    </div>
  )
}

export { newAction, newCondition, AutomationActionsList }
export default AutomationActionsList
