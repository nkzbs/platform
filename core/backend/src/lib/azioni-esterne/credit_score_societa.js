'use strict';
// Adattatore «credit_score_societa»: semaforo di affidabilità di una società dalla partita IVA (Risk di OpenAPI.it, risposta immediata).
//   campi: { codice (partita IVA o codice fiscale), tipo_soggetto }   esito: { esito, data }   livello: 'start' (semaforo a 3 classi) | 'advanced' (con rating e fido), predefinito start.
const openapiIt = require('../openapi-it');
const DOM = 'risk';
const livello = (config) => (config.livello === 'advanced' ? 'advanced' : 'start');
const scopi = (config) => [['GET', '/IT-creditscore-' + livello(config)]];
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });

async function disponibile({ config }) {
  const a = await openapiIt.servizioAttivo('creditscore_' + livello(config), DOM, scopi(config));
  return a.ok ? a : { ok: false, motivo: 'serve il servizio Risk di OpenAPI.it (credit score società). ' + a.motivo };
}

async function esegui({ dati, config }) {
  const C = config.campi || {}, E = config.esito || {};
  if (/person|fisic/i.test(String(dati[C.tipo_soggetto] || ''))) throw err('Il credit score è per le società: per una persona usa «Verifica del soggetto e solvibilità».');
  const codice = String(dati[C.codice] || '').replace(/\s+/g, '').toUpperCase();
  if (!/^\d{11}$/.test(codice) && !/^[A-Z0-9]{16}$/.test(codice)) throw err('Serve la partita IVA (11 cifre) o il codice fiscale della società.');
  const r = await openapiIt.chiama({ dominio: DOM, percorso: '/IT-creditscore-' + livello(config) + '/' + encodeURIComponent(codice), scopi: scopi(config) });
  const d = (r && r.data) || {};
  const parti = ['Semaforo: ' + (d.risk_score || 'non disponibile')];
  if (d.rating) parti.push('rating ' + d.rating);
  if (d.operational_credit_limit) parti.push('fido operativo ' + d.operational_credit_limit + ' €');
  if (d.risk_score_description) parti.push(String(d.risk_score_description).slice(0, 160));
  const oggi = new Date().toISOString().slice(0, 10);
  const patch = {};
  if (E.esito) patch[E.esito] = parti.join(' · ') + (d.organization_name ? ' — ' + d.organization_name : '');
  if (E.data) patch[E.data] = oggi;
  if (config.risultato_in) patch[config.risultato_in] = { ...d, data: oggi };
  return { patch, risposta: d, audit: { risk_score: d.risk_score, rating: d.rating } };
}

module.exports = { nome: 'credit_score_societa', servizioPer: ({ config }) => 'risk_creditscore_' + livello(config), disponibile, esegui };
