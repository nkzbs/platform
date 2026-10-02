// Ponte ESM verso l'UNICA fonte di verità in shared/schema-v3-core.js (radice
// del repo, condivisa davvero col backend — vedi core/backend/src/schema-v3.js
// per il ponte gemello lato Node, stesso ragionamento su path lì). Vite importa
// questo file nativamente; il percorso relativo (4 livelli, funziona sia in
// locale sia in ogni stage del Dockerfile — dentro il container i "../" in
// eccesso oltre la radice del filesystem sono no-op). Rinomina solo alcune
// funzioni per compatibilità con i nomi già usati in tutto il frontend
// (parseSchemaFrontend, schemaToV3, schemaToV2, genStepId) — cambiarli in tutti
// i punti di chiamata non avrebbe aggiunto nulla, solo churn.
import {
  toV3,
  toV2Lenient,
  parseSchemaNormalized,
  genId,
  getRequiredConnectors,
  getAutomationSteps,
  HIDDEN_CONNECTOR_ACTIONS,
  INTERNAL_ACTIONS,
} from '../../../../shared/schema-v3-core.js'

export const genStepId = genId
export const schemaToV3 = toV3
export const schemaToV2 = toV2Lenient
export const parseSchemaFrontend = parseSchemaNormalized
export { getRequiredConnectors, getAutomationSteps, HIDDEN_CONNECTOR_ACTIONS, INTERNAL_ACTIONS }
