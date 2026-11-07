import { createContext, useContext } from 'react'

// L'identità visiva dell'app scelta in Impostazioni → Aspetto: il logo (dell'app, altrimenti dell'azienda) e l'iniziale del nome quando non c'è un logo. App.jsx la fornisce;
// la leggono i punti che mostrano il marchio senza ricevere props (oggi lo sfondo «liquid glass», dietro ogni pagina e il login), così il nuovo logo compare anche lì.
export const IdentitaAppContext = createContext({ logoUrl: '', letter: undefined })
export const useIdentitaApp = () => useContext(IdentitaAppContext)
