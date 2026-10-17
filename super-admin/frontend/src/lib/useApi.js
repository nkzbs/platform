import { useState, useCallback } from 'react'
import { API, notifyUnauthorized } from './api'

// res.json() lancia se il corpo non è JSON valido (una 404/502 di nginx è HTML, non
// JSON) — senza questo try/catch quel lancio usciva come una promise rifiutata mai
// gestita dal chiamante, quindi un eventuale setLoading(false) dopo l'await non
// veniva mai eseguito: un pulsante restava bloccato su "in corso…" per sempre invece
// di mostrare un errore. Bug reale trovato dal vivo provando una Source dal Builder
// (shared/frontend/builder) contro un endpoint non esistente su questo backend.
async function safeJson(res) {
  try { return await res.json() } catch (e) { return { error: 'Risposta del server non valida (' + res.status + ')' } }
}

// baseUrl opzionale: di default '/api' (stesso comportamento di sempre, per
// ogni pagina già esistente). Il Builder integrato in Super Admin passa un URL
// assoluto (host del tenant scelto) invece del relativo, perché lì il frontend
// non gira sulla stessa origine del backend che deve chiamare.
function useApi(token, baseUrl) {
  const base = baseUrl || API
  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  }), [token])

  const get = useCallback(async (path) => {
    const res = await fetch(base + path, { headers: headers() })
    notifyUnauthorized(res)
    if (res.ok) return safeJson(res)
    return null
  }, [headers, base])

  const post = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await safeJson(res) }
  }, [headers, base])

  const put = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await safeJson(res) }
  }, [headers, base])

  const patch = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await safeJson(res) }
  }, [headers, base])

  const del = useCallback(async (path) => {
    const res = await fetch(base + path, { method: 'DELETE', headers: headers() })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await safeJson(res) }
  }, [headers, base])

  return { get, post, put, patch, del, headers }
}

export default useApi
