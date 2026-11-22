import { useEffect, useState } from 'react'

// I valori già usati dei campi di testo con «suggerisci» di un modulo ({ chiave: [valori] }), caricati una volta: servono al menu mentre si scrive
// (es. il creditore di un piano), così lo stesso nome si scrive sempre allo stesso modo. Senza campi «suggerisci» non fa nessuna richiesta.
export default function useSuggerimenti(api, slug, campi) {
  const [valori, setValori] = useState({})
  const chiavi = (campi || []).filter((f) => f && f.suggerisci && f.type === 'text').map((f) => f.key).join(',')
  useEffect(() => {
    if (!slug || !chiavi) return
    let vivo = true
    chiavi.split(',').forEach((k) => {
      api.get('/records/' + slug + '/valori/' + encodeURIComponent(k)).then((v) => { if (vivo && Array.isArray(v)) setValori((p) => ({ ...p, [k]: v })) })
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, chiavi])
  return valori
}
