import React, { useEffect, useRef, useState } from 'react'
import Icon from '@app/components/Icon'

// Scansione con la fotocamera per il campo 'barcode' (26/10/2026) — usa SOLO
// l'API nativa del browser (`BarcodeDetector`, nessuna libreria esterna):
// shared/ non ha un proprio node_modules e non può risolvere un pacchetto npm
// da sé (stesso motivo per cui Icon.jsx riceve lucide-react già importato dal
// chiamante, vedi quel file) — iniettare una libreria di decodifica qui
// richiederebbe lo stesso meccanismo in entrambe le app per un solo campo,
// non ne vale la pena finché il supporto nativo basta. Dove `BarcodeDetector`
// non c'è (browser vecchio), il campo resta comunque utilizzabile: si scrive
// il codice a mano nell'input di testo, la scansione è solo una scorciatoia.
function BarcodeScanModal({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stopRef = useRef(false)
  const [error, setError] = useState(null)
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  useEffect(() => {
    stopRef.current = false
    if (!supported) return
    let detector
    try {
      detector = new window.BarcodeDetector()
    } catch (e) {
      setError('Scansione non disponibile su questo dispositivo.')
      return
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (stopRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
        const loop = async () => {
          if (stopRef.current || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) { onDetected(codes[0].rawValue); return }
          } catch (e) { /* un frame non leggibile non è un errore, si riprova */ }
          if (!stopRef.current) requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      })
      .catch(() => setError('Fotocamera non raggiungibile — permesso negato o non disponibile.'))

    return () => {
      stopRef.current = true
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [supported])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-lg border border-gray-800 w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-ink text-sm font-medium"><Icon name="barcode" size={15} />Inquadra il codice a barre</div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={16} /></button>
        </div>
        <div className="p-3">
          {!supported && (
            <div className="text-xs text-gray-400 py-6 text-center">Questo browser non supporta la scansione — scrivi il codice a mano.</div>
          )}
          {supported && error && (
            <div className="text-xs text-red-400 py-6 text-center">{error}</div>
          )}
          {supported && !error && (
            <video ref={videoRef} className="w-full rounded-md bg-black aspect-video" muted playsInline />
          )}
        </div>
      </div>
    </div>
  )
}

export default BarcodeScanModal
