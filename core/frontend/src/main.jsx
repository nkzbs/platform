import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import InvitePage from './components/InvitePage'
import './index.css'

// /invito/<token>: la pagina pubblica di un invito, senza login e senza il resto dell'app.
const invito = window.location.pathname.match(/^\/invito\/([A-Za-z0-9_-]+)\/?$/)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {invito ? <InvitePage token={invito[1]} /> : <App />}
  </React.StrictMode>
)
