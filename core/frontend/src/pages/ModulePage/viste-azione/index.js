// Le VISTE con cui mostrare l'esito di un'azione esterna (campo `vista` del blocco `external_action`). Una vista per ogni servizio che ne ha una; la scheda del record non conosce i nomi.
import { vistaValutazioneImmobiliare } from './valutazione_immobiliare'

export const VISTE_AZIONE = { valutazione_immobiliare: vistaValutazioneImmobiliare }
