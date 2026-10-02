import React from 'react'

// UNICA fonte di verità, condivisa davvero tra super-admin/frontend e
// core/frontend (stesso identico shim in entrambi — vedi commento in cima a
// shared/frontend/Icon.jsx per il pattern). Portato qui il 2026-09-06:
// prima esisteva solo in super-admin/frontend/src/components/StatusBadge.jsx,
// e il badge "Verificato" dello Store dei tenant (core/frontend/StorePage.jsx)
// era scritto a mano con un colore diverso (bg-accent, tenant-brandizzato)
// invece di questo (fisso, bg-cp-success/text-cp-success) — segnalato
// dall'utente: "lo store dei tenant non è allineato a quello di core e
// partner portal". "Verificato" è un segnale di fiducia di PIATTAFORMA, non
// deve cambiare colore in base al tenant che lo guarda.
//
// PLATFORM-UI-RESKIN-PLAN.md, Fase 2 — pill di stato, tassonomia esatta del
// brief (CLAUDE_CODE_UI_BRIEF.md, "Badge di stato"): verde per Attivo/
// Verificato/Compatibile/Completato, blu per Aggiornamento, rosso per Errore/
// Sospeso, grigio per Storica. Copre solo il vero concetto di "stato" — i
// tag di categoria/conteggio già sparsi nelle pagine (verticale, moduli
// installati, ecc.) restano come sono: non sono uno stato, forzarli qui
// perderebbe quella distinzione reale.
const TONES = {
  green: 'bg-cp-success-bg text-cp-success',
  blue: 'bg-cp-primary/15 text-cp-primary',
  red: 'bg-cp-danger-bg text-cp-danger',
  gray: 'bg-gray-800 text-gray-500',
  // Non nella tassonomia esplicita del brief (che elenca solo verde/blu/rosso/
  // grigio) ma i suoi stessi token includono --cp-warning/--cp-warning-bg —
  // usato per stati reali "in corso/in attesa" (es. pairing partner pending)
  // che non sono né un vero errore né un vero completato.
  amber: 'bg-cp-warning-bg text-cp-warning',
}

export function StatusBadge({ tone = 'gray', children, className = '', ...rest }) {
  return (
    <span {...rest} className={'inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ' + (TONES[tone] || TONES.gray) + ' ' + className}>
      {children}
    </span>
  )
}

export default StatusBadge
