import React, { useState, useMemo } from 'react'
import Icon from '../../components/Icon'

// Vista a CALENDARIO (blocco di schema `calendar_view`): le righe del modulo sul mese, per la data di un loro campo. Giorni con le righe in punti/etichette; toccando un giorno
// le sue righe compaiono sotto (comodo sul telefono). Nessun nome di modulo qui: il blocco dice quale campo è la data (`date_field`), quale l'ora (`time_field`, facoltativo),
// quale il titolo (`title_field`) e quali relazioni/campi formano il sottotitolo (`subtitle_fields`).
//   { block_type: 'calendar_view', key, label, date_field, time_field?, title_field?, subtitle_fields?: [campo|relazione], done_state?: stato (le righe in questo stato sono attenuate) }
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export default function CalendarView({ config, records, relatedCache, onOpen }) {
  const oggi = iso(new Date())
  const [mese, setMese] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [giorno, setGiorno] = useState(oggi)

  const leggi = (r, k) => {
    const v = r.data ? r.data[k] : undefined
    const cache = relatedCache && relatedCache[k]
    if (cache && v !== undefined && v !== null && v !== '') return cache.byId[v] || ''
    return v === undefined || v === null ? '' : String(v)
  }
  const voci = useMemo(() => {
    const per = {}
    for (const r of records || []) {
      const g = String((r.data || {})[config.date_field] || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) continue
      const ora = config.time_field ? String(r.data[config.time_field] || '') : ''
      const titolo = (config.title_field && leggi(r, config.title_field)) || (config.subtitle_fields || []).map((k) => leggi(r, k)).filter(Boolean)[0] || config.label || 'Riga ' + r.id
      const sotto = (config.subtitle_fields || []).map((k) => leggi(r, k)).filter((x) => x && x !== titolo).join(' · ')
      const fatta = !!config.done_state && r.data._stato === config.done_state
      ;(per[g] = per[g] || []).push({ id: r.id, ora, titolo, sotto, fatta })
    }
    Object.values(per).forEach((l) => l.sort((a, b) => a.ora.localeCompare(b.ora)))
    return per
  }, [records, relatedCache, config]) // eslint-disable-line react-hooks/exhaustive-deps

  const primo = (new Date(mese.getFullYear(), mese.getMonth(), 1).getDay() + 6) % 7 // lunedì = 0
  const nGiorni = new Date(mese.getFullYear(), mese.getMonth() + 1, 0).getDate()
  const celle = [...Array(primo).fill(null), ...Array.from({ length: nGiorni }, (_, i) => iso(new Date(mese.getFullYear(), mese.getMonth(), i + 1)))]
  const vai = (n) => setMese(new Date(mese.getFullYear(), mese.getMonth() + n, 1))
  const delGiorno = voci[giorno] || []

  return (
    <div className="glass-panel p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={() => vai(-1)} aria-label="Mese precedente" className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400"><Icon name="chevron-left" size={16} /></button>
        <div className="flex-1 text-center text-sm font-semibold text-ink capitalize">{MESI[mese.getMonth()]} {mese.getFullYear()}</div>
        <button type="button" onClick={() => vai(1)} aria-label="Mese successivo" className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400"><Icon name="chevron-right" size={16} /></button>
        <button type="button" onClick={() => { const d = new Date(); setMese(new Date(d.getFullYear(), d.getMonth(), 1)); setGiorno(oggi) }} className="text-xs text-accent px-2 py-1 rounded-lg hover:bg-white/5">Oggi</button>
      </div>
      <div className="grid grid-cols-7 gap-px text-[11px] text-gray-500 mb-1">{GIORNI.map((g) => <div key={g} className="text-center py-1">{g}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {celle.map((g, i) => {
          if (!g) return <div key={'v' + i} />
          const l = voci[g] || [], scelto = g === giorno, eOggi = g === oggi
          return (
            <button key={g} type="button" onClick={() => setGiorno(g)} aria-label={g + (l.length ? ', ' + l.length + ' in agenda' : '')} aria-pressed={scelto}
              className={'min-h-[3.25rem] sm:min-h-[5.5rem] rounded-lg p-1 text-left border transition flex flex-col ' + (scelto ? 'border-accent bg-accent/10' : 'border-gray-800 hover:bg-white/5')}>
              <span className={'text-xs ' + (eOggi ? 'bg-accent text-white rounded-full w-5 h-5 flex items-center justify-center font-semibold' : 'text-gray-400')}>{Number(g.slice(8))}</span>
              {/* telefono: un punto per riga; schermo largo: le prime etichette */}
              <span className="sm:hidden flex gap-0.5 mt-1 flex-wrap">{l.slice(0, 4).map((v) => <span key={v.id} className={'w-1.5 h-1.5 rounded-full bg-accent ' + (v.fatta ? 'opacity-40' : '')} />)}</span>
              <span className="hidden sm:flex flex-col gap-0.5 mt-1 min-w-0">
                {l.slice(0, 3).map((v) => <span key={v.id} className={'truncate text-[11px] rounded px-1 bg-accent/15 text-ink ' + (v.fatta ? 'opacity-50 line-through' : '')}>{v.ora ? v.ora + ' ' : ''}{v.titolo}</span>)}
                {l.length > 3 && <span className="text-[11px] text-gray-500">+{l.length - 3}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 border-t border-gray-800 pt-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">{new Date(giorno + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        {delGiorno.length === 0 && <div className="text-sm text-gray-500">Niente in programma.</div>}
        <div className="divide-y divide-gray-800">
          {delGiorno.map((v) => (
            <button key={v.id} type="button" onClick={() => onOpen(v.id)} className={'w-full text-left py-2 flex items-start gap-3 hover:bg-white/[0.03] rounded ' + (v.fatta ? 'opacity-60' : '')}>
              <span className="text-sm text-accent w-12 flex-shrink-0">{v.ora || '—'}</span>
              <span className="flex-1 min-w-0"><span className="block text-sm text-ink break-words">{v.titolo}</span>{v.sotto && <span className="block text-xs text-gray-500">{v.sotto}</span>}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
