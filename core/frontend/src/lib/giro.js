// Il giro guidato del verticale: da un elenco di passi dichiarati nel pacchetto (`pagina`, `titolo`, `testo`, `target` facoltativo)
// ai passi che ProductTour sa mostrare ({ page, target, title, body }). Un passo la cui pagina non c'è per chi guarda (modulo non installato
// o non visibile al suo ruolo) si salta: il giro non mostra mai una pagina che non esiste.
// `pagine` = pagine sempre presenti (dashboard, impostazioni, guida…) più gli slug dei moduli installati.
export function costruisciGiro(passi, pagine) {
  const presenti = new Set(pagine)
  return (passi || [])
    .filter((p) => p && p.pagina && p.titolo && p.testo && presenti.has(p.pagina))
    .map((p) => ({ page: p.pagina, target: p.target || 'sidebar-' + p.pagina, title: p.titolo, body: p.testo }))
}

export const PAGINE_FISSE = ['dashboard', 'libreria', 'builder', 'impostazioni', 'guida']
