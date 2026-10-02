// Ponte ESM verso l'UNICA fonte di verità in shared/schema-v3-core.js — condivisa
// davvero con core/frontend e core/backend (vedi i commenti lì e core/backend/src/
// schema-v3.js per il ponte gemello lato Node, stesso ragionamento su path lì).
// Vite importa questo file nativamente; il percorso relativo (4 livelli) funziona
// sia in locale sia in ogni stage del Dockerfile — stesso identico shim già in uso
// in core/frontend/src/lib/schema-v3-frontend.js. Fino al 2026-08-07 questo file
// era una copia mantenuta a mano (vedi git history): eliminata insieme al resto
// della duplicazione core/super-admin, non più necessaria ora che questa app
// builda con contesto alla radice del repo e può raggiungere shared/ come core.
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
