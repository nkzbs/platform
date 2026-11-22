import React from 'react'
import Portal from './Portal'

// Rete di sicurezza: se qualcosa dentro va in errore mentre si disegna, invece della schermata bianca di tutta l'app compare un messaggio
// con il dettaglio dell'errore (da copiare e mandare) e un modo per tornare indietro. L'errore resta anche in localStorage («platform_ultimo_errore»).
// `onClose` (opzionale): chiude la scheda che ha dato errore; `nome`: dice cosa si stava aprendo.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { errore: null } }
  static getDerivedStateFromError(errore) { return { errore } }
  componentDidCatch(errore, info) {
    try {
      const testo = (errore && (errore.stack || errore.message)) || String(errore)
      console.error('Errore in ' + (this.props.nome || 'pagina') + ':', errore, info && info.componentStack)
      localStorage.setItem('platform_ultimo_errore', JSON.stringify({ quando: new Date().toISOString(), dove: this.props.nome || 'pagina', url: window.location.href, errore: String(testo).slice(0, 2000), componenti: String((info && info.componentStack) || '').slice(0, 1500) }))
    } catch (e) { /* senza localStorage resta solo la console */ }
  }
  render() {
    if (!this.state.errore) return this.props.children
    const e = this.state.errore
    const messaggio = (e && e.message) || String(e)
    return (
      <Portal>
      <div role="alert" className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
        <div className="bg-surface-card border border-red-900/50 rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="text-base font-bold text-ink mb-1">Qualcosa non è andato</div>
          <div className="text-sm text-gray-400 mb-3">{this.props.nome ? 'Non sono riuscito ad aprire: ' + this.props.nome + '.' : 'La pagina ha avuto un errore.'} I tuoi dati non sono stati toccati.</div>
          <pre className="text-[11px] text-red-300 bg-red-900/20 border border-red-900/40 rounded-lg p-2 whitespace-pre-wrap break-words mb-4">{messaggio}</pre>
          <div className="flex gap-2">
            {this.props.onClose && <button onClick={() => { this.setState({ errore: null }); this.props.onClose() }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2 rounded-lg text-sm transition">Chiudi</button>}
            <button onClick={() => window.location.reload()} className="flex-1 bg-accent hover:opacity-90 text-white py-2 rounded-lg text-sm font-medium transition">Ricarica</button>
          </div>
        </div>
      </div>
      </Portal>
    )
  }
}
