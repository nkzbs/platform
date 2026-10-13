import React, { useState, useEffect, useRef, useCallback } from 'react'
import Icon from './Icon'

// Tour di onboarding interattivo (2026-09-07, richiesto dall'utente: "wizard
// completo con guida interattiva all'uso della piattaforma" al primo
// accesso su un tenant nuovo). Motore riusabile e generico — il contenuto
// vive altrove (onboardingSteps.js), questo componente sa solo come
// mostrare un elenco ordinato di {page, target, title, body} come uno
// spotlight che segue la pagina.
//
// Overlay a 4 rettangoli intorno al target (non clip-path/mask CSS) — scelta
// deliberata: più semplice da ragionare, nessuna sorpresa di rendering tra
// temi chiaro/scuro, e il "buco" è per costruzione sempre un rettangolo
// esatto (getBoundingClientRect), niente arrotondamenti di maschera da
// tarare a mano.
function ProductTour({ steps, currentPage, onNavigate, onFinish, onStepChange }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const pollRef = useRef(null)
  const step = steps[stepIndex]

  // Il target potrebbe non esistere ancora, o non essere ancora nella sua
  // posizione FINALE, quando parte la misura — tre cause reali diverse
  // trovate testando il tour (non ipotetiche): (1) la pagina nuova deve
  // prima montare dopo onNavigate; (2) il menu mobile impiega una
  // transizione CSS di 150ms per scivolare in vista (onStepChange lo apre,
  // ma lo stato React deve prima renderizzare — un ritardo fisso prima
  // della misura può sempre perdere questa corsa, non è la cosa giusta da
  // indovinare); (3) una pagina che sta ancora caricando dati (es. Store)
  // può cambiare altezza e richiedere uno scroll diverso un attimo dopo il
  // primo tentativo. Invece di indovinare un ritardo per ciascun caso,
  // niente scorciatoie: si misura ad OGNI tick (aggiornando lo spotlight
  // via via, mai fermo su un valore intermedio sbagliato) e ci si ferma
  // solo quando due letture consecutive combaciano — il layout è
  // realmente fermo, non "probabilmente fermo dopo N ms".
  //
  // scrollIntoView con behavior 'instant', non 'smooth': uno scroll
  // "smooth" genera eventi scroll per tutta la durata dell'animazione, e
  // se la misura scatta mentre sta ancora scorrendo cattura una posizione
  // intermedia — con 'instant' lo scroll è sincrono, subito dopo la
  // chiamata il layout è già nella posizione definitiva.
  const locateTarget = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    let tries = 0
    let lastKey = null
    let stableTicks = 0
    const tryFind = () => {
      const el = step.target ? document.querySelector('[data-tour="' + step.target + '"]') : null
      if (!el) {
        if (++tries > 20) { setRect(null); clearInterval(pollRef.current) }
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      const r = el.getBoundingClientRect()
      const key = r.top + ',' + r.left + ',' + r.width + ',' + r.height
      setRect(r)
      stableTicks = key === lastKey ? stableTicks + 1 : 0
      lastKey = key
      ++tries
      // "Fermo" richiede letture identiche per 400ms consecutivi (4 tick) E
      // un minimo di 500ms di misura totale — non basta che DUE letture
      // coincidano per caso: una pagina i cui dati stanno ancora arrivando
      // dalla rete (es. Store che aspetta il registro) può restare ferma
      // per un attimo a metà caricamento, sembrare "stabile" con una
      // soglia troppo bassa, e poi spostarsi ancora quando arriva il resto
      // (bug reale trovato testando proprio questo caso).
      if (stableTicks >= 4 && tries >= 5) { clearInterval(pollRef.current); return }
      // Tetto di sicurezza (~3s): se non si stabilizza mai, resta comunque
      // visibile l'ultima posizione misurata invece di un tour bloccato.
      if (tries > 30) clearInterval(pollRef.current)
    }
    tryFind()
    pollRef.current = setInterval(tryFind, 100)
  }, [step])

  useEffect(() => {
    if (step.page !== currentPage) { onNavigate(step.page); return }
    if (onStepChange) onStepChange(step)
    locateTarget()
    const onResize = () => locateTarget()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, currentPage])

  const isLast = stepIndex === steps.length - 1
  const next = () => (isLast ? onFinish('completed') : setStepIndex((i) => i + 1))
  const back = () => setStepIndex((i) => Math.max(0, i - 1))
  const skip = () => onFinish('skipped')

  // Popover: sotto il target se c'è spazio, sopra altrimenti; centrato in
  // orizzontale sul target ma mai fuori viewport (clamp). Senza target
  // trovato (rect null), centrato a schermo — mai un tour che sparisce.
  const POPOVER_W = 320
  const PAD = 6 // margine dello spotlight attorno al target reale
  const popoverStyle = (() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow > 220 ? rect.bottom + 12 : Math.max(12, rect.top - 212)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - POPOVER_W / 2), window.innerWidth - POPOVER_W - 12)
    return { top, left }
  })()

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* Overlay a 4 rettangoli — un "buco" esatto intorno al target, o schermo
          intero scurito se il target non è stato trovato. */}
      {rect ? (
        <>
          <div className="fixed bg-black/70 transition-all duration-200" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
          <div className="fixed bg-black/70 transition-all duration-200" style={{ top: rect.bottom + PAD, left: 0, right: 0, bottom: 0 }} />
          <div className="fixed bg-black/70 transition-all duration-200" style={{ top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
          <div className="fixed bg-black/70 transition-all duration-200" style={{ top: rect.top - PAD, left: rect.right + PAD, right: 0, height: rect.height + PAD * 2 }} />
          <div className="fixed pointer-events-none rounded-lg ring-2 ring-accent transition-all duration-200" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}

      <div className="fixed bg-surface-card border border-gray-800 rounded-xl shadow-2xl p-5" style={{ width: POPOVER_W, ...popoverStyle }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Passo {stepIndex + 1} di {steps.length}</span>
          <button onClick={skip} className="text-gray-600 hover:text-ink transition" title="Salta il tour"><Icon name="x" size={14} /></button>
        </div>
        <div className="w-full h-1 bg-gray-800 rounded-full mb-3 overflow-hidden">
          <div className="h-full bg-accent transition-all duration-200" style={{ width: ((stepIndex + 1) / steps.length * 100) + '%' }} />
        </div>
        <div className="text-sm font-semibold text-ink mb-1.5">{step.title}</div>
        <div className="text-xs text-gray-400 leading-relaxed mb-4">{step.body}</div>
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <button onClick={back} className="text-xs text-gray-500 hover:text-ink transition px-2 py-1.5">&larr; Indietro</button>
          )}
          <button onClick={skip} className="text-xs text-gray-500 hover:text-ink transition px-2 py-1.5 ml-auto">Salta</button>
          <button onClick={next} className="text-xs bg-accent hover:opacity-90 text-white font-medium px-3 py-1.5 rounded-lg transition">
            {isLast ? 'Fatto' : 'Avanti'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProductTour
