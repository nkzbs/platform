'use strict';
// Cosa cambia sul record quando torna il documento firmato (blocco `document_action` con
// `delivery: 'firma'`). Funzione pura: nessun database, nessun nome di campo scritto qui — i campi
// sono quelli che il modulo ha dichiarato nel Builder (consensi, data della firma, versione del
// documento, scadenza di conservazione dei dati).

function aggiungiMesi(isoData, mesi) {
  const [a, m, g] = isoData.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + mesi, g));
  // 31 gennaio + 1 mese = «31 febbraio» → il mese sarebbe scivolato avanti: si torna all'ultimo giorno del mese giusto.
  if (d.getUTCDate() !== g) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// consensi: { campo: true|false } come spuntati sul foglio firmato. Solo i campi dichiarati dal
// documento si possono toccare: il resto della richiesta viene ignorato.
function calcolaAggiornamento(azione, consensi, oggi) {
  const patch = {};
  const dichiarati = (azione.consents || []).map((c) => c.field).filter(Boolean);
  for (const campo of dichiarati) {
    if (consensi && Object.prototype.hasOwnProperty.call(consensi, campo)) patch[campo] = consensi[campo] === true;
  }
  if (azione.signed_date_field) patch[azione.signed_date_field] = oggi;
  if (azione.version_field && azione.version) patch[azione.version_field] = String(azione.version);
  if (azione.retention_field && Number(azione.retention_months) > 0) patch[azione.retention_field] = aggiungiMesi(oggi, Math.floor(Number(azione.retention_months)));
  return patch;
}

const TIPO_FIRMATO = (azione) => azione.signed_type || azione.key + '_firmato';

module.exports = { calcolaAggiornamento, aggiungiMesi, TIPO_FIRMATO };
