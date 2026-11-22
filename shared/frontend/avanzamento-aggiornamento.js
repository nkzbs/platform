// Quanto è avanti un aggiornamento di un tenant (0-100), dai messaggi che il server manda man mano (Super Admin → Aggiorna). Il server non dice «sono al 40%»:
// si stima dalle tappe che si riconoscono nel testo; la costruzione dell'immagine, la più lunga, manda messaggi vari e li conta (si avvicina al 65% senza
// arrivarci mai da sola). Non torna mai indietro. A fine lavoro: 100 se riuscito, altrimenti si ferma dov'era.
const TAPPE = [
  [/scarico il sorgente/i, 5],
  [/sorgente scaricato/i, 15],
  [/costruisco l.immagine/i, 20],
  [/il tenant è su linode/i, 30],
  [/controllo se qualcuno sta usando/i, 70],
  [/nessuna sessione attiva|via libera|aggiornamento forzato/i, 74],
  [/fermo il vecchio container/i, 78],
  [/nuovo container creato/i, 85],
  [/attendo che il tenant risponda/i, 88],
  [/il tenant risponde/i, 96],
  [/pacchetti aggiornati|pacchetti non aggiornati/i, 98],
]

export function avanzamento(righe, stato) {
  if (stato === 'ok') return 100
  let tappa = 0, nellaBuild = 0, costruzione = false
  for (const r of righe || []) {
    const m = String((r && r.msg) || '')
    let riconosciuta = false
    for (const [re, p] of TAPPE) if (re.test(m)) { tappa = Math.max(tappa, p); riconosciuta = true; if (/costruisco l.immagine/i.test(m)) costruzione = true }
    if (!riconosciuta && costruzione && tappa < 70) nellaBuild += 1
  }
  const build = costruzione && tappa < 70 ? 45 * (1 - Math.exp(-nellaBuild / 8)) : 0
  const v = Math.max(tappa, tappa >= 20 && tappa < 70 ? 20 + build : tappa)
  return Math.max(0, Math.min(99, Math.round(v)))
}
