// Ponte verso l'UNICA fonte di verità in shared/frontend/Icon.jsx — condivisa
// davvero con core/frontend (stesso identico shim lì). Path relativo (4 livelli)
// è quello corretto su disco (super-admin/frontend/src/components/ -> radice
// repo); dentro il container Docker funziona comunque, perché lì
// /app/src/components/ è a soli 3 livelli da /shared/ e i "../" in eccesso
// oltre la radice del filesystem sono no-op.
// lucide-react iniettato qui (questa app HA il proprio node_modules) — vedi
// il commento in cima a shared/frontend/Icon.jsx per il perché.
import * as lucide from 'lucide-react'
import { createIcon } from '../../../../shared/frontend/Icon.jsx'

export default createIcon(lucide)
