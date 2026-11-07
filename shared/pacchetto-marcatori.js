// I marcatori che l'applicazione di un pacchetto di verticale lascia in `seed_applicati` di un tenant (una riga per blocco applicato). Servono a riconoscere un tenant che
// aveva già applicato blocchi di un pacchetto prima che i pacchetti esistessero. UNA sola definizione, usata dal core (che applica) e da Super Admin (che decide a chi inviare).
// `parti` è il contenuto del pacchetto: { estensioni, documenti, abbinamenti, moduli, ruoli, relazioni, proprieta, sezioni }.
export function marcatoriDelPacchetto(parti) {
  const P = parti || {}, m = []
  const perModulo = (parte, f) => { for (const [mod, v] of Object.entries(P[parte] || {})) if (!mod.startsWith('_')) f(mod, v) }
  const lista = (l) => (Array.isArray(l) ? l : [])
  perModulo('estensioni', (mod, l) => lista(l).forEach((x) => m.push('estensione:' + mod + ':' + x.key)))
  perModulo('documenti', (mod, l) => lista(l).forEach((x) => m.push('azione_documento:' + mod + ':' + x.key)))
  perModulo('abbinamenti', (mod, l) => lista(l).forEach((x) => m.push('abbinamento:' + mod + ':' + x.key)))
  perModulo('relazioni', (mod, l) => lista(l).forEach((x) => m.push('relazione:' + mod + ':' + x.chiave)))
  perModulo('moduli', (mod) => m.push('modulo:' + mod))
  perModulo('ruoli', (mod) => m.push('ruoli:' + mod))
  perModulo('proprieta', (mod) => m.push('proprieta:' + mod))
  perModulo('sezioni', (mod) => m.push('sezioni:' + mod))
  return m
}
