import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Proprietario delle righe create senza una persona (automazioni, importazioni, mail) e riassegnazione delle righe esistenti.
// Serve ai moduli con "vede solo i propri": una riga senza proprietario, o di un altro utente, per chi non è admin non esiste.
export default function RecordOwnerCard({ token }) {
  const api = useApi(token)
  const [info, setInfo] = useState(null)
  const [msg, setMsg] = useState('')
  const [mod, setMod] = useState('')
  const [chi, setChi] = useState('entrambi')
  const [anteprima, setAnteprima] = useState(null)
  const [aperta, setAperta] = useState(false) // la riassegnazione è uno strumento di correzione: chiusa finché non serve
  const load = () => api.get('/record-owner').then((d) => { if (d) { setInfo(d); if (!mod && d.moduli.length) setMod(d.moduli[0].slug) } })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return null
  const owner = info.default_owner_user_id
  const nome = (id) => { const u = info.utenti.find((x) => x.id === id); return u ? (u.display_name || u.username) : '—' }

  const salva = async (v) => {
    const r = await api.put('/record-owner', { user_id: v === '' ? null : parseInt(v, 10) })
    setMsg(r.ok ? 'Salvato.' : (r.data && r.data.error) || 'Non salvato.')
    load()
  }
  const prova = async () => {
    if (!owner || !mod) return
    const r = await api.post('/record-owner/assign', { module_slug: mod, to_user_id: owner, from: chi, dry_run: true })
    setAnteprima(r.ok ? r.data : null); setMsg(r.ok ? '' : (r.data && r.data.error) || 'Errore.')
  }
  const assegna = async () => {
    const r = await api.post('/record-owner/assign', { module_slug: mod, to_user_id: owner, from: chi })
    setAnteprima(null)
    setMsg(r.ok ? 'Fatto: ' + r.data.righe + ' righe di «' + r.data.modulo + '» ora sono di ' + nome(owner) + '.' : (r.data && r.data.error) || 'Errore.')
    load()
  }
  const sel = 'bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent'
  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-5 mb-8">
      <h2 className="text-base font-semibold text-ink mb-1">Proprietario delle righe automatiche</h2>
      <p className="text-xs text-gray-500 mb-4">Le righe create senza una persona (automazioni, importazioni, mail) prendono questo proprietario, se non derivano da una riga che ne ha già uno. Conta nei moduli dove ognuno vede solo le proprie righe: una riga di un altro utente, o senza proprietario, non si vede a meno di essere admin.</p>
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <label className="text-sm text-gray-400">Proprietario predefinito</label>
        <select className={sel} value={owner || ''} onChange={(e) => salva(e.target.value)}>
          <option value="">Nessuno</option>
          {info.utenti.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
        </select>
      </div>
      <div className="border-t border-gray-800 pt-4">
        {info.moduli.length === 0 ? <div className="text-xs text-gray-500">Nessuna riga senza proprietario o dell'admin da riassegnare.</div> : (
          <>
            <button type="button" onClick={() => setAperta(!aperta)} className="text-sm text-ink font-medium flex items-center gap-1.5">
              <span className="text-gray-500">{aperta ? '▾' : '▸'}</span> Riassegna righe già presenti
            </button>
            {aperta && (
              <div className="mt-3 space-y-3 max-w-md">
                <p className="text-xs text-gray-500">Per correggere righe arrivate prima di scegliere il proprietario. I dati delle righe non cambiano, cambia solo di chi sono.</p>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Modulo</div>
                  <select className={sel + ' w-full'} value={mod} onChange={(e) => { setMod(e.target.value); setAnteprima(null) }}>
                    {info.moduli.map((m) => <option key={m.slug} value={m.slug}>{m.name} — {m.senza_proprietario} senza proprietario, {m.di_admin} admin</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Quali righe</div>
                  <select className={sel + ' w-full'} value={chi} onChange={(e) => { setChi(e.target.value); setAnteprima(null) }}>
                    <option value="entrambi">Senza proprietario o dell'admin</option>
                    <option value="senza_proprietario">Solo senza proprietario</option>
                    <option value="admin">Solo dell'admin</option>
                  </select>
                </div>
                <div className="text-sm text-gray-400">Le assegno a <b className="text-ink">{owner ? nome(owner) : '— scegli prima il proprietario —'}</b></div>
                <button type="button" onClick={prova} disabled={!owner} className="text-sm px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40">Controlla quante</button>
              </div>
            )}
          </>
        )}
        {anteprima && (
          <div className="mt-3 flex items-center gap-3 flex-wrap text-sm">
            <span className="text-ink">{anteprima.righe === 0 ? 'Nessuna riga da cambiare.' : anteprima.righe + ' righe di «' + anteprima.modulo + '» passeranno a ' + nome(owner) + '.'}</span>
            {anteprima.righe > 0 && <button type="button" onClick={assegna} className="text-sm px-3 py-2 rounded-lg bg-accent hover:opacity-90 text-white">Assegna</button>}
          </div>
        )}
      </div>
      {msg && <div className="text-xs text-gray-400 mt-3">{msg}</div>}
    </div>
  )
}
