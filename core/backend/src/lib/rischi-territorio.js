'use strict';
// Due fonti pubbliche europee/italiane, gratuite e senza chiave — a differenza di
// lib/openapi-it.js, nessuna credenziale da collegare in Impostazioni. Usate dalla
// valutazione Immobili (routes/records.js) come arricchimento best-effort: se una delle due
// non risponde o non copre quel punto, la valutazione principale resta comunque valida.

// JRC PVGIS (Commissione Europea, re.jrc.ec.europa.eu) — potenziale fotovoltaico. Non dà un
// "kW installabili" (servirebbe la superficie di tetto, che Platform non ha), solo la resa
// annua per kW installato: lasciato così, non trasformato in un investimento stimato inventato.
async function fotovoltaico({ lat, lng }) {
  const url = 'https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=' + lat + '&lon=' + lng + '&peakpower=1&loss=14&outputformat=json';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error('PVGIS non ha risposto (' + res.status + ')'), { status: res.status });
  const data = await res.json();
  const tot = data && data.outputs && data.outputs.totals && data.outputs.totals.fixed;
  if (!tot) throw new Error('PVGIS: risposta senza dati utilizzabili');
  return { kwh_per_kwp_anno: Math.round(tot.E_y), irraggiamento_kwh_mq_anno: Math.round((data.outputs.totals.fixed['H(i)_y'] || 0)) };
}

// ISPRA — zona sismica ufficiale (classificazione 1-4, 1 = rischio più alto) tramite il loro
// servizio ArcGIS pubblico, interrogato per punto. Il rischio idraulico/frane (IdroGEO) non ha
// un endpoint REST equivalente trovato finora — resta fuori, non inventato.
async function zonaSismica({ lat, lng }) {
  const url = 'https://sgi2.isprambiente.it/arcgis/rest/services/servizi/sismicita/MapServer/4/query'
    + '?geometry=' + lng + ',' + lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error('ISPRA non ha risposto (' + res.status + ')'), { status: res.status });
  const data = await res.json();
  const attr = data && Array.isArray(data.features) && data.features[0] && data.features[0].attributes;
  if (!attr) throw new Error('ISPRA: nessuna zona sismica trovata per questo punto');
  return { zona: attr.C_2003, comune: attr.COMUNE };
}

module.exports = { fotovoltaico, zonaSismica };
