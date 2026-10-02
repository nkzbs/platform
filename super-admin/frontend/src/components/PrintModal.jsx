// Estratto da core/frontend/src/components/PrintModal.jsx (2026-08-16, resync
// Super Builder) — SOLO la funzione pura buildFullHtml, usata dall'anteprima
// stampa dentro l'editor del Builder (DocumentTemplatePreview). Niente
// componente PrintModal, niente printViaRawBT: quel file importa
// @capacitor/core in testa, non una dipendenza di questa app (Super Admin
// non gira mai come app nativa) — importarlo per intero romperebbe la build.
// Va risincronizzata a mano se la generazione HTML cambia in core, stesso
// principio già in uso per il resto della cartella BuilderPage.

// Genera il documento HTML COMPLETO (doctype + stile inline) a partire dal
// frammento già risolto dal backend (token sostituiti) — stesso schema di nico:
// due CSS diversi a seconda del formato (80mm termico vs A4 a pagina intera),
// iniettati in un <iframe srcDoc>, con un bottone che chiama window.print()
// dentro il contesto della iframe stessa (non window.open, niente popup).
export function buildFullHtml(fragment, formato, nome) {
  const isNarrow = formato === '80mm'
  const style = isNarrow ? `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; color: #1c1917; margin: 0; padding: 4mm; }
    .receipt { width: 80mm; max-width: 302px; margin: 0 auto; }
    @page { size: 80mm auto; margin: 0; }
    @media print { html, body { background: #fff; } .receipt { width: 80mm; max-width: none; padding: 4mm; } .print-btn { display: none; } }
    .print-btn { display: block; width: 100%; margin-top: 12px; padding: 10px; background: #2563EB; color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; }
  ` : `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; color: #1c1917; padding: 32px 40px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 6px 4px; }
    .right { text-align: right; }
    hr.divider { border: none; border-top: 2px solid #1c1917; margin: 16px 0; }
    hr.thin { border: none; border-top: 1px solid #d6d3d1; margin: 12px 0; }
    .total-row td { font-weight: 700; border-top: 2px solid #1c1917; }
    @media print { body { padding: 20px; } .print-btn { display: none; } }
    .print-btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #2563EB; color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; }
  `
  return `<!doctype html><html><head><meta charset="utf-8"><title>${nome || 'Documento'}</title><style>${style}</style></head>
    <body>
      <div class="${isNarrow ? 'receipt' : ''}">${fragment}</div>
      <button class="print-btn" onclick="window.print()">Stampa</button>
    </body></html>`
}
