'use strict';

// Motore formule a soglia — §1 piano di attacco 1 agosto 2026
// Blocco chiuso ma estensibile: scaglioni N-livelli + 4 tipi di soglia_data.
// Nessuna dipendenza da DB: tutte le funzioni sono pure (validazione + calcolo).
// L'integrazione con formula.js (valutazione dell'espressione `su`) è responsabilità
// del chiamante — separazione deliberata per testabilità isolata.

const SOGLIA_DATA_TIPI = ['giorno_mese', 'range_date', 'giorno_settimana', 'fine_mese_offset'];

// ─── SCAGLIONI ────────────────────────────────────────────────────────────────

function validateScaglioni(scaglioni) {
  const errors = [];
  if (!Array.isArray(scaglioni) || scaglioni.length === 0) {
    return { valid: false, errors: ['scaglioni deve essere un array non vuoto'] };
  }

  const terminali = scaglioni.filter((s) => !('fino' in s));

  if (terminali.length === 0) {
    errors.push('Manca il livello terminale: l\'ultimo scaglione deve essere senza "fino" (tratto aperto)');
  } else if (terminali.length > 1) {
    errors.push(`Trovati ${terminali.length} livelli senza "fino": deve essercene esattamente uno`);
  }

  if (terminali.length === 1 && 'fino' in scaglioni[scaglioni.length - 1]) {
    errors.push('Il livello terminale (senza "fino") deve essere l\'ultimo nell\'array');
  }

  let prevFino = -Infinity;
  scaglioni.forEach((s, i) => {
    if (typeof s.tasso !== 'number' || isNaN(s.tasso)) {
      errors.push(`Scaglione ${i + 1}: "tasso" deve essere un numero`);
    }
    if ('fino' in s) {
      if (typeof s.fino !== 'number' || isNaN(s.fino) || s.fino <= 0) {
        errors.push(`Scaglione ${i + 1}: "fino" deve essere un numero positivo`);
      } else if (s.fino <= prevFino) {
        errors.push(`Scaglione ${i + 1}: "fino" (${s.fino}) deve essere maggiore del "fino" precedente (${prevFino})`);
      } else {
        prevFino = s.fino;
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

// Calcola il totale a scaglioni su un valore numerico.
// Lo schema deve essere già validato da validateScaglioni.
// Restituisce { value, breakdown } dove breakdown descrive il contributo di ogni fascia.
function calcolaScaglioni(valore, scaglioni) {
  let totale = 0;
  const breakdown = [];
  let sogliaPrec = 0;

  for (let i = 0; i < scaglioni.length; i++) {
    const s = scaglioni[i];
    const isTerminale = !('fino' in s);

    if (isTerminale) {
      const imponibile = Math.max(0, valore - sogliaPrec);
      const contributo = imponibile * s.tasso;
      totale += contributo;
      breakdown.push({ da: sogliaPrec, fino: null, tasso: s.tasso, imponibile, contributo });
    } else {
      if (valore <= sogliaPrec) {
        breakdown.push({ da: sogliaPrec, fino: s.fino, tasso: s.tasso, imponibile: 0, contributo: 0 });
      } else {
        const imponibile = Math.min(valore, s.fino) - sogliaPrec;
        const contributo = imponibile * s.tasso;
        totale += contributo;
        breakdown.push({ da: sogliaPrec, fino: s.fino, tasso: s.tasso, imponibile, contributo });
        sogliaPrec = s.fino;
      }
    }
  }

  return { value: totale, breakdown };
}

// ─── SOGLIA_DATA ──────────────────────────────────────────────────────────────

function validateSogliaData(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['soglia_data deve essere un oggetto'] };
  }

  if (!schema.su || typeof schema.su !== 'string' || !schema.su.startsWith('campo:')) {
    errors.push('"su" deve essere un riferimento a un campo (es. campo:data_pagamento)');
  }

  if (!schema.tipo) {
    errors.push('"tipo" è obbligatorio');
  } else if (!SOGLIA_DATA_TIPI.includes(schema.tipo)) {
    errors.push(`"tipo" non riconosciuto: "${schema.tipo}". Valori ammessi: ${SOGLIA_DATA_TIPI.join(', ')}`);
  } else {
    if (!schema.se_vero) errors.push('"se_vero" è obbligatorio');
    if (!schema.se_falso) errors.push('"se_falso" è obbligatorio');

    if (schema.tipo === 'giorno_mese') {
      if (typeof schema.soglia !== 'number' || schema.soglia < 1 || schema.soglia > 31) {
        errors.push('"soglia" deve essere un numero intero tra 1 e 31 per il tipo giorno_mese');
      }
    } else if (schema.tipo === 'range_date') {
      if (typeof schema.inizio_mese !== 'number' || schema.inizio_mese < 1 || schema.inizio_mese > 12) {
        errors.push('"inizio_mese" deve essere un numero tra 1 e 12');
      }
      if (typeof schema.inizio_giorno !== 'number' || schema.inizio_giorno < 1 || schema.inizio_giorno > 31) {
        errors.push('"inizio_giorno" deve essere un numero tra 1 e 31');
      }
      if (typeof schema.fine_mese !== 'number' || schema.fine_mese < 1 || schema.fine_mese > 12) {
        errors.push('"fine_mese" deve essere un numero tra 1 e 12');
      }
      if (typeof schema.fine_giorno !== 'number' || schema.fine_giorno < 1 || schema.fine_giorno > 31) {
        errors.push('"fine_giorno" deve essere un numero tra 1 e 31');
      }
    } else if (schema.tipo === 'giorno_settimana') {
      if (!Array.isArray(schema.giorni) || schema.giorni.length === 0) {
        errors.push('"giorni" deve essere un array non vuoto per il tipo giorno_settimana');
      }
    } else if (schema.tipo === 'fine_mese_offset') {
      if (typeof schema.offset !== 'number' || schema.offset < 1) {
        errors.push('"offset" deve essere un numero intero positivo per il tipo fine_mese_offset');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Nomi italiani per i giorni (domenica=0, come getUTCDay())
const NOMI_GIORNI_SETTIMANA = {
  domenica: 0, lunedi: 1, lunedì: 1,
  martedi: 2, martedì: 2,
  mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4,
  venerdi: 5, venerdì: 5,
  sabato: 6,
};

// Calcola il periodo di competenza per una data rispetto a uno schema soglia_data.
// Lo schema deve essere già validato da validateSogliaData.
// Restituisce { periodo, anno, mese } dove anno/mese sono il periodo di competenza
// risolto in numeri concreti quando periodo è 'mese_corrente', 'mese_successivo' o
// 'mese_precedente'; per altri label restituisce anno/mese della data di input.
function calcolaSogliaData(data, schema) {
  const d = data instanceof Date ? data : new Date(data);
  const anno = d.getUTCFullYear();
  const mese = d.getUTCMonth() + 1;
  const giorno = d.getUTCDate();
  const giornoSettimana = d.getUTCDay();

  let condizione;

  if (schema.tipo === 'giorno_mese') {
    condizione = giorno >= schema.soglia;

  } else if (schema.tipo === 'range_date') {
    // Confronto mese/giorno senza anno — gestisce anche range che attraversano fine anno
    const dataOggi = mese * 100 + giorno;
    const inizio = schema.inizio_mese * 100 + schema.inizio_giorno;
    const fine = schema.fine_mese * 100 + schema.fine_giorno;
    condizione = (inizio <= fine)
      ? (dataOggi >= inizio && dataOggi <= fine)
      : (dataOggi >= inizio || dataOggi <= fine);

  } else if (schema.tipo === 'giorno_settimana') {
    const giorniNorm = schema.giorni.map((g) =>
      typeof g === 'number' ? g : (NOMI_GIORNI_SETTIMANA[g.toLowerCase()] ?? -1)
    );
    condizione = giorniNorm.includes(giornoSettimana);

  } else if (schema.tipo === 'fine_mese_offset') {
    const ultimoGiorno = new Date(Date.UTC(anno, mese, 0)).getUTCDate();
    condizione = (ultimoGiorno - giorno) < schema.offset;
  } else {
    throw new Error(`calcolaSogliaData: tipo non riconosciuto "${schema.tipo}". Valori ammessi: ${SOGLIA_DATA_TIPI.join(', ')}`);
  }

  const periodo = condizione ? schema.se_vero : schema.se_falso;

  let annoRis = anno, meseRis = mese;
  if (periodo === 'mese_successivo') {
    if (mese === 12) { annoRis = anno + 1; meseRis = 1; }
    else { meseRis = mese + 1; }
  } else if (periodo === 'mese_precedente') {
    if (mese === 1) { annoRis = anno - 1; meseRis = 12; }
    else { meseRis = mese - 1; }
  }
  // mese_corrente o label non standard: anno/mese invariati

  return { periodo, anno: annoRis, mese: meseRis };
}

module.exports = {
  SOGLIA_DATA_TIPI,
  validateScaglioni,
  calcolaScaglioni,
  validateSogliaData,
  calcolaSogliaData,
};
