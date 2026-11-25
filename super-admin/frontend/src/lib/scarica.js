import { API } from './api'

// Scarica un file protetto (backup, export) con un link MONOUSO e di 60 secondi, invece di mettere nell'indirizzo il token di sessione (che dura 24 ore e finirebbe
// in cronologia, log e intestazioni — audit 25/11/2026, M2). `percorso` è quello dell'API senza prefisso, per esempio '/tenants/x/backups/3/download'.
export async function scarica(token, percorso) {
  const r = await fetch(API + '/auth/download-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ path: API + percorso }),
  })
  const d = await r.json().catch(() => null)
  if (!r.ok || !d || !d.token) { window.alert((d && d.error) || 'Non riesco a preparare il download.'); return }
  window.location.href = API + percorso + '?dl=' + encodeURIComponent(d.token)
}
