'use strict';

// Bilancio di Verifica / Conto Economico / Stato Patrimoniale su un motore contabile in
// partita doppia generico — non specifico di un tenant, la convenzione dare/avere per
// tipo di conto è universale in qualunque contabilità: Ricavo/Passivo/Capitale sono
// "credit-normal" (saldo = avere - dare), Costo/Attivo sono "debit-normal"
// (saldo = dare - avere). Stessa identica logica che prima viveva duplicata dentro
// ContabilitaGeneralePage.jsx, qui come primitivo puro riusabile da qualunque modulo
// contabile — stesso pattern di reconciliation.js (route risolve le relazioni, questo
// modulo fa solo aritmetica su dati già risolti).
const CREDIT_NORMAL_TYPES = ['Ricavo', 'Passivo', 'Capitale'];

// righe: [{ conto_id, dare, avere }] (già filtrate per movimento confermato dal chiamante)
// conti: [{ id, codice, nome, tipo }]
function computeStatement(righe, conti) {
  const saldi = {};
  righe.forEach((r) => {
    if (r.conto_id == null) return;
    if (!saldi[r.conto_id]) saldi[r.conto_id] = { dare: 0, avere: 0 };
    saldi[r.conto_id].dare += Number(r.dare) || 0;
    saldi[r.conto_id].avere += Number(r.avere) || 0;
  });

  const bilancio = conti
    .map((c) => {
      const s = saldi[c.id] || { dare: 0, avere: 0 };
      return { conto_id: c.id, codice: c.codice, nome: c.nome, tipo: c.tipo, dare: s.dare, avere: s.avere, saldo: s.dare - s.avere };
    })
    .sort((a, b) => String(a.codice || '').localeCompare(String(b.codice || '')));

  const perTipo = (tipo) => bilancio
    .filter((c) => c.tipo === tipo)
    .map((c) => ({
      codice: c.codice,
      nome: c.nome,
      importo: CREDIT_NORMAL_TYPES.includes(tipo) ? (c.avere - c.dare) : (c.dare - c.avere),
    }));

  const ricavi = perTipo('Ricavo');
  const costi = perTipo('Costo');
  const attivo = perTipo('Attivo');
  const passivo = perTipo('Passivo');
  const capitale = perTipo('Capitale');

  const totRicavi = ricavi.reduce((s, r) => s + r.importo, 0);
  const totCosti = costi.reduce((s, r) => s + r.importo, 0);
  const utile = totRicavi - totCosti;
  const totAttivo = attivo.reduce((s, r) => s + r.importo, 0);
  const totPassivo = passivo.reduce((s, r) => s + r.importo, 0);
  const totPatrimonio = capitale.reduce((s, r) => s + r.importo, 0) + utile;
  const pareggio = Math.abs(totAttivo - (totPassivo + totPatrimonio)) < 0.01;

  return {
    bilancio,
    conto_economico: { ricavi, costi, totRicavi, totCosti, utile },
    stato_patrimoniale: { attivo, passivo, capitale, totAttivo, totPassivo, totPatrimonio, utile, pareggio },
  };
}

module.exports = { computeStatement, CREDIT_NORMAL_TYPES };
