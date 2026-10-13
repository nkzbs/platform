'use strict';
// Il trasporto SSH vero (lib/ssh-client.js, ssh2) contro un server SSH in-process: accesso con password e con chiave, impronta fissata (se cambia ci si ferma), comandi con codice di uscita,
// stdin in streaming, credenziali sbagliate. Il server esegue i comandi con `sh -c` in una cartella temporanea. Eseguire con: node src/ssh-client.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const { spawn } = require('child_process');
const { connect, impronta } = require('./lib/ssh-client');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-home-'));
  const host = utils.generateKeyPairSync('ed25519'), utente = utils.generateKeyPairSync('ed25519');
  const pubUtente = utils.parseKey(utente.public);
  const server = new Server({ hostKeys: [host.private] }, (client) => {
    client.on('error', () => {}); // chi si ferma all'impronta chiude lo scambio delle chiavi: per il server è un errore atteso
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'nima' && ctx.password === 'giusta') return ctx.accept();
      if (ctx.method === 'publickey' && ctx.username === 'nima' && ctx.key.algo === pubUtente.type && ctx.key.data.equals(pubUtente.getPublicSSH())) return ctx.signature ? (pubUtente.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true ? ctx.accept() : ctx.reject()) : ctx.accept();
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (acc, rej, info) => {
        const stream = acc();
        const p = spawn('sh', ['-c', info.command], { cwd: casa, env: { ...process.env, HOME: casa } });
        stream.pipe(p.stdin); p.stdout.pipe(stream, { end: false }); p.stderr.on('data', (d) => stream.stderr.write(d));
        p.on('close', (code) => { stream.exit(code); stream.end(); });
      });
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  const base = { host: '127.0.0.1', port: porta, username: 'nima' };
  const fpVera = impronta(utils.parseKey(host.public).getPublicSSH());

  await test('password giusta: connessione, impronta del server letta, comando con uscita 0', async () => {
    const c = await connect({ ...base, password: 'giusta' }); eq(c.fingerprint, fpVera); const r = await c.run('echo ciao; echo errore 1>&2'); c.close();
    eq([r.code, r.stdout.trim(), r.stderr.trim()], [0, 'ciao', 'errore']);
  });
  await test('chiave privata giusta: ci si entra', async () => {
    const c = await connect({ ...base, privateKey: utente.private }); const r = await c.run('echo ok'); c.close(); eq(r.stdout.trim(), 'ok');
  });
  await test('password sbagliata: errore, niente connessione', async () => {
    let e = null; try { await connect({ ...base, password: 'sbagliata', timeoutMs: 5000 }); } catch (x) { e = x; } ok(e, 'doveva fallire');
  });
  await test('impronta fissata: se combacia si procede, se è diversa ci si ferma PRIMA di mandare le credenziali', async () => {
    const c = await connect({ ...base, password: 'giusta', fingerprint: fpVera }); c.close();
    let e = null; try { await connect({ ...base, password: 'giusta', fingerprint: 'SHA256:altra' }); } catch (x) { e = x; }
    ok(e && e.code === 'fingerprint', 'doveva fermarsi: ' + (e && e.message));
  });
  await test('codice di uscita diverso da zero e stderr', async () => {
    const c = await connect({ ...base, password: 'giusta' }); const r = await c.run('echo boom 1>&2; exit 3'); c.close(); eq([r.code, r.stderr.trim()], [3, 'boom']);
  });
  await test('stdin: testo e flusso (anche grande) arrivano interi; il file scritto è identico', async () => {
    const c = await connect({ ...base, password: 'giusta' });
    await c.run('cat > piccolo.txt', { stdin: 'riga uno\nriga due\n' }); eq(fs.readFileSync(path.join(casa, 'piccolo.txt'), 'utf8'), 'riga uno\nriga due\n');
    const grande = crypto.randomBytes(5 * 1024 * 1024); const f = path.join(os.tmpdir(), 'grande-' + crypto.randomBytes(4).toString('hex')); fs.writeFileSync(f, grande);
    const r = await c.run('cat > grande.bin && wc -c < grande.bin', { stdin: fs.createReadStream(f) }); c.close();
    eq(Number(r.stdout.trim()), grande.length); ok(fs.readFileSync(path.join(casa, 'grande.bin')).equals(grande), 'contenuto diverso'); fs.unlinkSync(f);
  });
  await test('più comandi sulla stessa connessione, in sequenza', async () => {
    const c = await connect({ ...base, password: 'giusta' }); const a = await c.run('echo uno'), b = await c.run('echo due'); c.close(); eq([a.stdout.trim(), b.stdout.trim()], ['uno', 'due']);
  });

  server.close();
  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
