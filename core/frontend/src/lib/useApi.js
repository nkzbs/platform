import { useState, useCallback } from 'react'
import { API, notifyUnauthorized } from './api'

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
    if (res.ok) return res.json()
    return null
  }, [headers, base])

  const post = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await res.json() }
  }, [headers, base])

  const put = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await res.json() }
  }, [headers, base])

  const patch = useCallback(async (path, body) => {
    const res = await fetch(base + path, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) })
    notifyUnauthorized(res)
    return { ok: res.ok, data: await res.json() }
  }, [headers, base])

  const del = useCallback(async (path) => {
    const res = await fetch(base + path, { method: 'DELETE', headers: headers() })
    notifyUnauthorized(res)
    return { ok: res.ok }
  }, [headers, base])

  return { get, post, put, patch, del, headers }
}

export default useApi
