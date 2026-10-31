import React from 'react'

// Cerchio profilo condiviso — foto reale se l'utente ne ha caricata una
// (AccountPage.jsx), altrimenti l'iniziale colorata di sempre. Un solo posto per
// questa scelta: Sidebar (dock + pannello "Altro") e AccountPage la usano identica,
// così una foto caricata compare ovunque senza doverla ripetere in tre posti
// (2026-10-31, richiesto dall'utente: "cerchio accanto al nome etc etc").
function Avatar({ user, size = 40, className = '' }) {
  const initial = ((user && (user.display_name || user.username)) || '?').trim().charAt(0).toUpperCase()
  if (user && user.avatar_url) {
    return (
      <img src={user.avatar_url} alt="" className={'rounded-full object-cover flex-shrink-0 ' + className}
        style={{ width: size, height: size }} />
    )
  }
  return (
    <div className={'rounded-full bg-accent/15 text-accent flex items-center justify-center font-semibold flex-shrink-0 ' + className}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.4) }}>
      {initial}
    </div>
  )
}

export default Avatar
