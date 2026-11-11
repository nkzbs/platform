'use strict';
// Gli allegati di un tenant dentro il backup: un archivio .tar.gz accanto al database, creato dallo stesso giro (stesso nome, estensione .allegati.tar.gz).
// Per i tenant sul NAS si legge la cartella, per quelli su Linode si scarica dal loro server via SSH (la stessa strada dell'esportazione).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const deps = {
  flusso: (tenant) => require('./tenant-export').deps.allegati(tenant.slug, tenant),
  cartellaNas: (slug) => path.join(process.env.DATA_ROOT || '/data', slug, 'uploads'),
};
const TETTO_BYTE = 2 * 1024 * 1024 * 1024; // oltre 2 GB non si archivia da soli: lo si dice, non si riempie il disco di Super Admin

// Scrive l'archivio in `destino`. Ritorna { file, size_mb } oppure null se il tenant non ha allegati. Se supera il tetto, lancia errore e toglie il file.
async function archivia(tenant, destino) {
  const flusso = await deps.flusso(tenant);
  if (!flusso) return null;
  let letti = 0;
  flusso.on('data', (d) => { letti += d.length; if (letti > TETTO_BYTE) flusso.destroy(new Error('Gli allegati superano 2 GB: non li archivio da solo.')); });
  try { await pipeline(flusso, fs.createWriteStream(destino)); }
  catch (e) { try { fs.unlinkSync(destino); } catch (x) { /* non c'era */ } throw e; }
  return { file: destino, size_mb: Math.round((fs.statSync(destino).size / 1024 / 1024) * 100) / 100 };
}

// Controlla che l'archivio si legga per intero e dice quanti file contiene (senza scrivere nulla).
function verifica(file) {
  return new Promise((resolve) => {
    const p = spawn('tar', ['tzf', file]); let n = 0, resto = '', err = '';
    p.stdout.on('data', (d) => { const t = (resto + d).split('\n'); resto = t.pop(); n += t.filter((x) => x && !x.endsWith('/')).length; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('close', (code) => resolve(code === 0 ? { ok: true, file: n + (resto && !resto.endsWith('/') ? 1 : 0) } : { ok: false, error: 'tar: ' + err.trim().slice(0, 160) }));
  });
}

// Rimette gli allegati dell'archivio nel tenant. Non cancella nulla: i file dell'archivio sovrascrivono quelli con lo stesso nome, quelli in più restano.
async function ripristina(tenant, file) {
  if (tenant.host === 'linode') return require('./server-remoto').ripristinaAllegati(tenant, file);
  const dir = deps.cartellaNas(tenant.slug);
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn('tar', ['xzf', file, '-C', dir]); let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error('Ripristino degli allegati fallito (tar ' + code + '): ' + err.trim().slice(0, 160))));
  });
}

module.exports = { archivia, verifica, ripristina, deps };
