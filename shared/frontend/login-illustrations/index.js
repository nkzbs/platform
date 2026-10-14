// Illustrazioni per la schermata di login (2026-10-14, richiesto dall'utente):
// un disegno diverso a ogni accesso, stesso set per tutti i tenant e per
// Super Admin. Tracciato unico a mano, bianco su trasparente (pensato per il
// tema scuro) — in tema chiaro si inverte via CSS, vedi `.login-illustration`
// in index.css di entrambi i frontend.
import montagnaSole from './montagna-sole.png'
import barcaVela from './barca-vela.png'
import faro from './faro.png'
import albero from './albero.png'
import mongolfiera from './mongolfiera.png'
import mappamondo from './mappamondo.png'
import libro from './libro.png'
import tazzaCaffe from './tazza-caffe.png'
import lampadina from './lampadina.png'
import piantina from './piantina.png'
import cuoreMani from './cuore-mani.png'
import gatto from './gatto.png'
import aereoCarta from './aereo-carta.png'
import onda from './onda.png'
import montagneSole from './montagne-sole.png'
import lunaStelle from './luna-stelle.png'

export const LOGIN_ILLUSTRATIONS = [
  montagnaSole, barcaVela, faro, albero,
  mongolfiera, mappamondo, libro, tazzaCaffe,
  lampadina, piantina, cuoreMani, gatto,
  aereoCarta, onda, montagneSole, lunaStelle,
]

export function randomLoginIllustration() {
  return LOGIN_ILLUSTRATIONS[Math.floor(Math.random() * LOGIN_ILLUSTRATIONS.length)]
}
