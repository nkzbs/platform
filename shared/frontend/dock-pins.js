// Voci appuntate nel dock mobile (tenant e Super Admin): logica pura, senza React né storage,
// così sta sotto test e le due Sidebar non ne tengono ciascuna una copia.
//
// L'utente sceglie esplicitamente cosa appuntare (tasto "Modifica" nel pannello "Altro");
// non c'è alcun riordino automatico per uso. Le preferenze (lista di id) le salva ciascuna
// app sul dispositivo; qui si decide soltanto cosa mostrare e cosa succede a un tocco.

// Quali voci stanno nel dock: le preferenze dell'utente se ci sono, altrimenti le predefinite.
// Si scartano id non più esistenti (un modulo tolto) e doppioni, e si taglia a `max`.
export function risolviAppuntate(preferenze, predefinite, disponibili, max) {
  const base = Array.isArray(preferenze) ? preferenze : predefinite
  return base.filter((id, i, tutte) => tutte.indexOf(id) === i && disponibili.includes(id)).slice(0, max)
}

// Un tocco in modalità "Modifica": toglie la voce se è appuntata, la aggiunge se c'è posto.
// Se il dock è già pieno e la voce non è appuntata non cambia nulla e restituisce LA STESSA
// lista ricevuta (stesso riferimento), così chi chiama può riconoscere il "niente da salvare".
export function alternaAppuntata(correnti, id, max) {
  if (correnti.includes(id)) return correnti.filter((x) => x !== id)
  if (correnti.length < max) return [...correnti, id]
  return correnti
}
