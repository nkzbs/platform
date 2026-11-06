import { createPortal } from 'react-dom'

// Sposta i figli su document.body. Ogni overlay a tutto schermo (position: fixed) va
// avvolto qui: dentro un pannello di vetro (.glass-panel, ha backdrop-filter) un fixed
// resta intrappolato nei confini della card — bug reale visto con Smista e FormDrawer.
export default function Portal({ children }) {
  return createPortal(children, document.body)
}
