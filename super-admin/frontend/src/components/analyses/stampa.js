// Stile di stampa condiviso dai due documenti dell'analisi (Manuale e Guida all'uso): foglio A4 con margini, solo il documento, colori fedeli,
// una copertina che chiude la pagina, nessuna scheda spezzata a metà, titoli mai da soli in fondo alla pagina, numero di pagina dove il browser lo permette.
export const STAMPA_CSS = `
@media print {
  @page { size: A4; margin: 16mm 14mm 18mm; @bottom-right { content: counter(page); font: 9pt system-ui, sans-serif; color: #78716c } }
  body * { visibility: hidden }
  .doc-stampa, .doc-stampa * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .doc-stampa { position: absolute; left: 0; top: 0; width: 100%; border: 0 !important; border-radius: 0 !important; padding: 0 !important; font-size: 10.5pt }
  .doc-stampa .copertina { break-after: page }
  .doc-stampa .scheda { break-inside: avoid-page }
  .doc-stampa .nuova-pagina { break-before: page }
  .doc-stampa h2, .doc-stampa h3 { break-after: avoid-page }
  .doc-stampa .riga { break-inside: avoid }
  .no-stampa { display: none !important }
}`
