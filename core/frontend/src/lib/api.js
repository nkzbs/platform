// L'app parla sempre con '/api' relativo (stesso host, proxy nginx).
export const API = '/api'

const TOKEN_KEY = 'platform_token'
const USER_KEY = 'platform_user'

function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// Un token scaduto/non valido faceva fallire silenziosamente ogni chiamata (401),
// lasciando l'app con sidebar/dati vuoti senza alcuna indicazione del perché — chi
// usava l'app doveva capire da solo che serviva rifare login. Ogni punto che chiama
// l'API (useApi.js e i pochi fetch diretti rimasti) segnala qui un 401, e App.jsx
// ascolta questo evento per fare logout automatico e riportare alla schermata di
// accesso, invece di restare bloccato su una UI vuota e silenziosamente rotta.
function notifyUnauthorized(res) {
  if (res && res.status === 401) {
    window.dispatchEvent(new CustomEvent('platform:unauthorized'))
  }
  return res
}

// I file allegati sono protetti da autenticazione — un <a href> semplice non porta l'header
// Authorization, quindi il download passa da un fetch autenticato che apre un blob locale.
async function openUploadedFile(fileRef, token) {
  if (!fileRef || !fileRef.id) return
  const res = await fetch(API + '/uploads/' + fileRef.id, { headers: { Authorization: 'Bearer ' + token } })
  if (!res.ok) { window.alert('Impossibile aprire il file'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export { openUploadedFile, notifyUnauthorized, setAuth, clearAuth }
