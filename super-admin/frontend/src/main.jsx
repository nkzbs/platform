import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import '@shared/stile-bento.css' // stile «Bento» (Impostazioni → Aspetto): inerte finché data-stile non è impostato
import { leggiStile, applicaStile } from './lib/stile'

applicaStile(leggiStile()) // prima del primo disegno: niente lampo dello stile sbagliato

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
