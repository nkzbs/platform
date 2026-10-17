'use strict';
// Motore di esecuzione delle Sources scriptabili (source-engine.js). Nessun server HTTP
// reale qui — solo il motore puro: isolamento, timeout, forma del risultato. Le route
// che lo usano (ricerca/importazione da una fonte) sono testate altrove con un server
// reale. Eseguire con: node src/source-engine.test.js

const http = require('http');
const { runSourceScript } = require('./source-engine');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

async function main() {
  console.log('\n--- esecuzione di base ---');
  await test('app.result(oggetto) torna come result, ok true', async () => {
    const r = await runSourceScript('app.result({ titolo: "Ciao", numero: 42 })', {});
    assertEq(r.ok, true); assertEq(r.result, { titolo: 'Ciao', numero: 42 });
  });
  await test('app.query arriva allo script', async () => {
    const r = await runSourceScript('app.result({ eco: app.query })', { query: 'cerca questo' });
    assertEq(r.result, { eco: 'cerca questo' });
  });
  await test('app.params arriva allo script', async () => {
    const r = await runSourceScript('app.result(app.params)', { params: { isbn: '123' } });
    assertEq(r.result, { isbn: '123' });
  });
  await test('app.log raccoglie i messaggi, restituiti in logs', async () => {
    const r = await runSourceScript('app.log("uno"); app.log({due: 2}); app.result({})', {});
    assertEq(r.logs.length, 2); assertTrue(r.logs[0] === 'uno'); assertTrue(/due/.test(r.logs[1]));
  });

  console.log('\n--- errori dello script (mai un\'eccezione del motore) ---');
  await test('niente app.result(...) chiamato -> ok false, errore esplicito', async () => {
    const r = await runSourceScript('let x = 1 + 1;', {});
    assertEq(r.ok, false); assertTrue(/app\.result/.test(r.error));
  });
  await test('app.fail() -> ok false', async () => {
    const r = await runSourceScript('app.fail();', {});
    assertEq(r.ok, false);
  });
  await test('un errore JS non gestito (eccezione nello script) -> ok false, non lancia', async () => {
    const r = await runSourceScript('throw new Error("rotto apposta");', {});
    assertEq(r.ok, false); assertTrue(/rotto apposta/.test(r.error));
  });
  await test('errore di sintassi -> ok false, "Errore di sintassi"', async () => {
    const r = await runSourceScript('questo non è( javascript valido', {});
    assertEq(r.ok, false); assertTrue(/sintassi/.test(r.error));
  });

  console.log('\n--- isolamento ---');
  await test('process non è raggiungibile dallo script', async () => {
    const r = await runSourceScript('app.result({ tipo: typeof process })', {});
    assertEq(r.result, { tipo: 'undefined' });
  });
  await test('require non è raggiungibile dallo script', async () => {
    const r = await runSourceScript('app.result({ tipo: typeof require })', {});
    assertEq(r.result, { tipo: 'undefined' });
  });

  console.log('\n--- timeout ---');
  await test('un ciclo sincrono infinito viene interrotto (non blocca il processo)', async () => {
    const r = await runSourceScript('while(true){}', {});
    assertEq(r.ok, false); assertTrue(/tempo/.test(r.error));
  });

  console.log('\n--- app.request (server HTTP locale reale, nessuna dipendenza esterna) ---');
  const server = http.createServer((req, res) => {
    if (req.url === '/echo-header') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ x: req.headers['x-mia-chiave'] || null }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, metodo: req.method }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  await test('una richiesta GET reale funziona, il JSON si legge con .json()', async () => {
    const r = await runSourceScript(`
      let res = await app.request('${base}/').send();
      app.result({ success: res.success, status: res.statusCode, metodo: res.json().metodo });
    `, {});
    assertEq(r.ok, true);
    assertEq(r.result, { success: true, status: 200, metodo: 'GET' });
  });
  await test('addHeaderValue arriva davvero nella richiesta', async () => {
    const r = await runSourceScript(`
      let req = app.request('${base}/echo-header');
      req.addHeaderValue('segreto123', 'X-Mia-Chiave');
      let res = await req.send();
      app.result(res.json());
    `, {});
    assertEq(r.ok, true); assertEq(r.result, { x: 'segreto123' });
  });
  await test('method = POST cambia davvero il metodo della richiesta', async () => {
    const r = await runSourceScript(`
      let req = app.request('${base}/');
      req.method = 'POST';
      let res = await req.send();
      app.result(res.json());
    `, {});
    assertEq(r.result.metodo, 'POST');
  });

  server.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite source-engine fallita ad avviarsi:', e); process.exit(1); });
