// Illustrazioni per la schermata di login (2026-10-14, richiesto dall'utente):
// un disegno diverso a ogni accesso, stesso set per tutti i tenant e per
// Super Admin. Tracciato unico a mano, bianco su trasparente (pensato per il
// tema scuro) — in tema chiaro si inverte via CSS, vedi `.login-illustration`
// in index.css di entrambi i frontend.
// SVG vettoriali (non più PNG, 2026-10-14 stesso giorno): il primo giro da
// raster, mostrato dal vivo sul telefono, era visibilmente sfocato — il
// pannello di login lo ingrandisce 2-3× oltre la risoluzione del ritaglio
// originale. Ritracciati con potrace da una versione ingrandita 3× del
// foglio sorgente (vedi script usato in sessione, non salvato nel repo):
// nitidi a qualunque dimensione, stesso stile a tratto unico.
import montagnaSole from './montagna-sole.svg'
import barcaVela from './barca-vela.svg'
import faro from './faro.svg'
import albero from './albero.svg'
import mongolfiera from './mongolfiera.svg'
import mappamondo from './mappamondo.svg'
import libro from './libro.svg'
import tazzaCaffe from './tazza-caffe.svg'
import lampadina from './lampadina.svg'
import piantina from './piantina.svg'
import cuoreMani from './cuore-mani.svg'
import gatto from './gatto.svg'
import aereoCarta from './aereo-carta.svg'
import onda from './onda.svg'
import montagneSole from './montagne-sole.svg'
import lunaStelle from './luna-stelle.svg'

export const LOGIN_ILLUSTRATIONS = [
  montagnaSole, barcaVela, faro, albero,
  mongolfiera, mappamondo, libro, tazzaCaffe,
  lampadina, piantina, cuoreMani, gatto,
  aereoCarta, onda, montagneSole, lunaStelle,
]

export function randomLoginIllustration() {
  return LOGIN_ILLUSTRATIONS[Math.floor(Math.random() * LOGIN_ILLUSTRATIONS.length)]
}
