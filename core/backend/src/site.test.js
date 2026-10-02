'use strict';
// Sito Web (2026-09-04) — motore a blocchi (site-renderer.js) + route pubbliche/admin
// (routes/site.js). Server reale, DB temporaneo, richieste HTTP vere. Copre: CRUD admin, 404 quando il sito non è
// attivo/la pagina non è pubblicata, il gate lato server sui blocchi PRO (modulo
// non installato -> rifiutato, anche se qualcuno aggira l'editor e chiama l'API
// a mano), e la griglia prodotti che legge record VERI, non finti.

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34572;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'site-test-' + crypto.randomBytes(6).toString('hex') + '.db');

process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'site_test_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'site_test_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'site_test_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-uploads-'));

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; failures.push(name); }
}
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); }
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'atteso true'); }

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return; } catch (e) { /* non ancora in ascolto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server Core non pronto entro ' + timeoutMs + 'ms');
}

async function main() {
  require('./index.js');
  await waitForServer(10000);
  const db = require('./db');

  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }),
  });
  const auth = { Authorization: 'Bearer ' + (await loginRes.json()).token, 'Content-Type': 'application/json' };

  let pageId;

  await test('POST /site-pages crea una pagina in bozza', async () => {
    const res = await fetch(BASE + '/api/site-pages', { method: 'POST', headers: auth, body: JSON.stringify({ slug: 'home', title: 'Home' }) });
    const body = await res.json();
    assertEq(res.status, 201);
    assertEq(body.published, 0);
    pageId = body.id;
  });

  await test('GET /negozio/home -> 404 se il sito non è ancora attivo (site_enabled=0 di default)', async () => {
    const res = await fetch(BASE + '/negozio/home');
    assertEq(res.status, 404);
  });

  await test('GET /negozio/home -> 404 anche a sito attivo, se la pagina non è pubblicata', async () => {
    db.prepare('UPDATE tenant_settings SET site_enabled = 1 WHERE id = 1').run();
    const res = await fetch(BASE + '/negozio/home');
    assertEq(res.status, 404);
  });

  await test('PATCH /site-pages/:id pubblica la pagina con blocchi reali -> GET /negozio/home la rende con title/meta veri', async () => {
    const blocks = [{ type: 'hero', config: { headline: 'Benvenuto', subheadline: 'Sottotitolo di prova' } }];
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, meta_description: 'Una descrizione di prova', blocks_json: blocks }),
    });
    assertEq(patchRes.status, 200);

    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertEq(res.status, 200);
    assertTrue(html.includes('<title>Home'), 'il titolo della pagina deve comparire nel <title>');
    assertTrue(html.includes('Una descrizione di prova'), 'la meta description deve comparire nell\'HTML');
    assertTrue(html.includes('Benvenuto'), 'il contenuto del blocco hero deve comparire');
  });

  await test('cronologia/autosave ("andiamo avanti con Divi"): ogni PATCH che cambia davvero blocks_json crea una revisione, uno che NON lo cambia no', async () => {
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'Versione 1', body: 'x' } }] }),
    });
    const before = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    // Un PATCH che tocca SOLO published (nessun blocks_json) non deve aggiungere rumore.
    await fetch(BASE + '/api/site-pages/' + pageId, { method: 'PATCH', headers: auth, body: JSON.stringify({ published: true }) });
    const afterNoop = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    assertEq(afterNoop.length, before.length, 'un PATCH che non cambia blocks_json non deve creare una nuova revisione');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'Versione 2', body: 'x' } }] }),
    });
    const after = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    assertEq(after.length, before.length + 1, 'un PATCH che cambia davvero blocks_json deve aggiungere esattamente una revisione');
    assertTrue(!!after[0].created_at && after[0].id > before[0].id, 'la più recente deve comparire per prima (ordine newest-first)');
  });

  await test('cronologia: ripristinare una revisione riporta blocks_json a quello stato E crea a sua volta una nuova revisione (ripristino annullabile)', async () => {
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'Da ripristinare', body: 'x' } }] }),
    });
    const revisions = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    const targetRevId = revisions[0].id;
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'Sovrascritta dopo', body: 'x' } }] }),
    });
    const restoreRes = await fetch(BASE + '/api/site-pages/' + pageId + '/revisions/' + targetRevId + '/restore', { method: 'POST', headers: auth });
    assertEq(restoreRes.status, 200);
    const restored = await restoreRes.json();
    assertTrue(JSON.stringify(restored.blocks_json).includes('Da ripristinare'), 'dopo il ripristino la pagina deve avere il contenuto della revisione scelta');
    const res = await fetch(BASE + '/negozio/home');
    assertTrue((await res.text()).includes('Da ripristinare'), 'il ripristino deve riflettersi anche sulla pagina pubblica vera');
    const revisionsAfterRestore = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    assertTrue(revisionsAfterRestore.length > revisions.length, 'il ripristino stesso deve creare una nuova revisione, altrimenti sarebbe irreversibile');
  });

  await test('cronologia: al massimo 20 revisioni per pagina, le più vecchie vengono eliminate', async () => {
    for (let i = 0; i < 23; i++) {
      await fetch(BASE + '/api/site-pages/' + pageId, {
        method: 'PATCH', headers: auth,
        body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'Rev ' + i, body: 'x' } }] }),
      });
    }
    const revisions = await (await fetch(BASE + '/api/site-pages/' + pageId + '/revisions', { headers: auth })).json();
    assertTrue(revisions.length <= 20, 'non devono accumularsi più di 20 revisioni per pagina, oltre è solo rumore');
  });

  await test('popup ("andiamo avanti con Divi"): abilitato con trigger a tempo compare nell\'HTML pubblico con markup+script, spento o senza contenuto non genera nulla', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'hero', config: { headline: 'x' } }],
        popup_json: { enabled: true, trigger: 'delay', delay_seconds: 5, title: 'Iscriviti', body: 'Sconto del 10%', cta_label: 'Vai', cta_url: 'https://example.com' },
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-popup-overlay" id="s-popup"'), 'il markup del popup deve comparire quando abilitato con contenuto reale');
    assertTrue(html.includes('Iscriviti') && html.includes('Sconto del 10%'), 'titolo e testo configurati devono comparire');
    assertTrue(html.includes("setTimeout(show, 5000)"), 'il trigger a tempo deve usare i secondi configurati, convertiti in millisecondi');
    assertTrue(html.includes('sessionStorage'), 'la chiusura deve ricordarsi per la sessione, non riproporsi ad ogni pagina');

    const disabledRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ popup_json: { enabled: false, title: 'Non deve comparire' } }),
    });
    assertEq(disabledRes.status, 200);
    const htmlDisabled = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!htmlDisabled.includes('id="s-popup"'), 'popup disabilitato non deve generare nessun markup nel body (la regola CSS .s-popup-overlay resta comunque nel <style> di base, come per divisore/video/accordion)');
  });

  await test('popup: exit_intent usa mouseleave invece del timer, un trigger non valido viene rifiutato dall\'API', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ popup_json: { enabled: true, trigger: 'exit_intent', title: 'Aspetta!' } }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes("addEventListener('mouseleave'") && !html.includes('setTimeout(show'), 'exit_intent deve emettere SOLO il proprio script, mai anche il ramo del timer (stesso principio del blocco video: un solo markup, non tre con un if runtime)');

    const invalidRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ popup_json: { enabled: true, trigger: 'qualcosa"><script>' } }),
    });
    assertEq(invalidRes.status, 400, 'un trigger fuori allowlist deve essere rifiutato, mai finire alla cieca nello script pubblico');
  });

  await test('popup: senza nessun popup configurato (pagina normale) non compare nessun markup né script extra', async () => {
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ popup_json: null, blocks_json: [{ type: 'hero', config: { headline: 'x' } }] }),
    });
    const html = await (await fetch(BASE + '/negozio/home')).text();
    // Non basta cercare "s-popup": la regola CSS .s-popup-overlay è SEMPRE
    // presente in <style> (stesso principio già seguito per divisore/video/
    // accordion) — qui va verificato il markup/script REALE nel <body>, non
    // il CSS di base.
    assertTrue(!html.includes('id="s-popup"') && !html.includes('sessionStorage'), 'nessuna pagina che non configura un popup deve avere il markup/script reale nel body');
  });

  // Sito Web è funzionalità CORE (2026-09-05, richiesto dall'utente: "il
  // modulo così non è gestibile tramite builder -> fallo diventare
  // funzionalità core" — trovato mentre si eseguiva questa richiesta anche
  // un doppione mai ripulito nel registry, id 204 "Editor Avanzato" + id 205
  // "Sito Web", uniti in un solo modulo). Niente più gate "modulo
  // installato": ogni blocco, incluso quelli un tempo "PRO", è sempre
  // disponibile per ogni tenant, gratis. I due test sotto sostituiscono i
  // vecchi test del gate PRO (accettava/rifiutava in base
  // all'installazione) — ora verificano solo che il blocco funzioni sempre.
  await test('un blocco un tempo "PRO" (galleria) si salva e si vede sempre — nessun gate di installazione, funzionalità core', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'galleria', config: { title: 'Galleria', image_urls: ['a.jpg', 'b.jpg'] } }] }),
    });
    assertEq(patchRes.status, 200);
    // Cerca la SEZIONE resa, non solo la stringa "s-galleria": quella compare anche
    // nel <style> di base (selettore .s-galleria-grid), presente sempre — un match
    // sulla sola sottostringa darebbe un falso positivo indipendentemente dal blocco.
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('<section class="s-reveal s-galleria">'), 'il blocco galleria deve comparire sempre, senza nessuna installazione');
  });

  await test('html_custom con config.head: il contenuto (es. link a un font esterno) finisce nel vero <head>, non dentro <body> (bug reale: "il font è male")', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'html_custom', config: { head: '<link rel="stylesheet" href="https://fonts.example/font.css">', html: '<p>Corpo custom</p>' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    const bodyStart = html.indexOf('<body'); // non '<body>': il tag porta data-s-page-slug (blocco 'form', 2026-09-05)
    const linkPos = html.indexOf('fonts.example/font.css');
    assertTrue(linkPos > -1 && linkPos < headEnd, 'il link al font deve stare nel <head>, prima di </head>');
    assertTrue(linkPos < bodyStart, 'il link al font non deve finire dentro <body>');
  });

  await test('blocchi scuri consecutivi si fondono (solo il primo/ultimo di una serie ha angoli/margine, mai quelli in mezzo)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'hero', dark: true, config: { headline: 'Uno' } },
          { type: 'testo', dark: true, config: { title: 'Due', body: 'x' } },
          { type: 'cta', dark: true, config: { title: 'Tre' } },
          { type: 'testo', config: { title: 'Quattro (chiaro)', body: 'x' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // Cerca 'class="s-reveal s-hero' non 'class="s-hero': il tag radice ora
    // porta anche 's-reveal' (comparsa allo scroll, 2026-09-05) come PRIMA
    // classe. Serve comunque il prefisso 'class="', non solo 's-hero': quella
    // sottostringa esiste anche nel <style> di base (selettori .s-hero{...},
    // .s-hero-split, ecc.), che viene PRIMA del body — un match sulla sola
    // sottostringa troverebbe il CSS, non il tag reso.
    const heroSection = html.slice(html.indexOf('class="s-reveal s-hero'), html.indexOf('class="s-reveal s-hero') + 90);
    assertTrue(heroSection.includes('s-dark-top') && !heroSection.includes('s-dark-bottom'), 'il primo blocco della serie scura ha solo l\'angolo in alto');
    // Il blocco in MEZZO ("Due") non ha né s-dark-top né s-dark-bottom.
    const testoSection = html.slice(html.indexOf('class="s-reveal s-testo'), html.indexOf('class="s-reveal s-testo') + 90);
    assertTrue(!testoSection.includes('s-dark-top') && !testoSection.includes('s-dark-bottom'), 'un blocco scuro in mezzo alla serie non ha angoli — deve fondersi con i vicini');
    // L'ULTIMO della serie ("Tre", cta) ha s-dark-bottom ma non s-dark-top.
    const ctaSection = html.slice(html.indexOf('class="s-reveal s-cta'), html.indexOf('class="s-reveal s-cta') + 90);
    assertTrue(ctaSection.includes('s-dark-bottom') && !ctaSection.includes('s-dark-top'), 'l\'ultimo blocco della serie scura ha solo l\'angolo in basso');
  });

  await test('una pagina con un solo blocco html_custom NON riceve l\'H1 automatico di fallback (bug reale trovato su Nico Caffè 1:1)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'html_custom', config: { html: '<header>Nav vera del design custom</header>' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Nav vera del design custom'), 'il contenuto custom deve comparire');
    // L'H1 di fallback è "<section><h1>{titolo pagina}</h1></section>" — quel titolo
    // ("Home", impostato all'inizio di questa suite) non deve MAI comparire quando
    // c'è un html_custom: sovrapporlo al design reale è esattamente il bug trovato.
    assertTrue(!html.includes('<section><h1>Home</h1></section>'), 'nessun H1 automatico sopra un design html_custom completo');
  });

  await test('griglia_prodotti legge record VERI dal modulo indicato, non dati finti', async () => {
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 2, ?)")
      .run('Prodotti Test', 'prodotti_site_test', 'box', '#2563EB', JSON.stringify({
        version: 3, steps: [
          { id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' },
          { id: 'f2', block_type: 'field', key: 'prezzo', label: 'Prezzo', type: 'currency' },
        ],
      }));
    db.prepare('INSERT INTO records (module_slug, data, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('prodotti_site_test', JSON.stringify({ nome: 'Prodotto di prova', prezzo: 42.5 }));

    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'griglia_prodotti', config: { title: 'Catalogo', source_module_slug: 'prodotti_site_test', campo_nome: 'nome', campo_prezzo: 'prezzo' } }],
      }),
    });
    assertEq(patchRes.status, 200);

    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Prodotto di prova'), 'deve comparire il nome reale del record');
    assertTrue(html.includes('42.50'), 'deve comparire il prezzo reale del record');
  });

  await test('block.hidden nasconde il blocco dal rendering senza cancellarne la configurazione', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'hero', config: { headline: 'Visibile' } },
          { type: 'cta', hidden: true, config: { title: 'Nascosta', cta_label: 'x', cta_url: '#' } },
        ],
      }),
    });
    const saved = await patchRes.json();
    assertEq(saved.blocks_json.length, 2, 'il blocco nascosto resta salvato, non viene rimosso');

    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Visibile'), 'il blocco non nascosto deve comparire');
    assertTrue(!html.includes('Nascosta'), 'il blocco nascosto non deve comparire nell\'HTML pubblico');
  });

  await test('GET /negozio/sitemap.xml include solo le pagine pubblicate', async () => {
    await fetch(BASE + '/api/site-pages', { method: 'POST', headers: auth, body: JSON.stringify({ slug: 'bozza-non-pubblicata', title: 'Bozza' }) });
    const res = await fetch(BASE + '/negozio/sitemap.xml');
    const xml = await res.text();
    assertTrue(xml.includes('/negozio/home'), 'la pagina pubblicata deve essere nella sitemap');
    assertTrue(!xml.includes('/negozio/bozza-non-pubblicata'), 'una pagina non pubblicata non deve comparire nella sitemap');
  });

  await test('GET /__root_public rende la home con il tasto login, quando il sito è attivo e pubblicato', async () => {
    const res = await fetch(BASE + '/__root_public');
    const html = await res.text();
    assertEq(res.status, 200);
    assertTrue(html.includes('s-login-btn'), 'deve comparire il tasto login');
    assertTrue(html.includes("/api/auth/login"), 'il modale deve chiamare la vera route di login');
  });

  await test('il tasto Accedi flottante sta sempre in basso a destra (bug reale: in alto si sovrapponeva al CTA di una nav reale)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'header', config: { site_name: 'Prova' } }, { type: 'hero', config: { headline: 'Titolo' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/__root_public');
    const html = await res.text();
    const btnStyleMatch = html.match(/id="s-login-btn"[^>]*style="([^"]*)"/);
    assertTrue(!!btnStyleMatch, 'il tasto login deve esistere');
    assertTrue(btnStyleMatch[1].includes('bottom:16px'), 'il tasto login deve stare in basso, mai in alto dove potrebbe sovrapporsi a una nav');
  });

  await test('header e footer si rendono con link/colonne reali (bug reale: mancavano del tutto nel motore a blocchi)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'header', config: { site_name: 'Prova SRL', nav_links: [{ label: 'Chi siamo', url: '#chi-siamo' }], cta_label: 'Parliamo', cta_url: '#contatti' } },
          { type: 'hero', config: { headline: 'Titolo' } },
          { type: 'footer', config: { site_name: 'Prova SRL', tagline: 'Slogan di prova', columns: [{ title: 'Naviga', links: [{ label: 'Chi siamo', url: '#chi-siamo' }] }], copyright_text: '© 2026 Prova SRL' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('<header class="s-header">'), 'deve comparire un vero elemento <header>');
    assertTrue(html.includes('Chi siamo') && html.includes('#chi-siamo'), 'il link di navigazione deve comparire con il suo indirizzo reale');
    assertTrue(html.includes('<footer class="s-footer">'), 'deve comparire un vero elemento <footer>');
    assertTrue(html.includes('Slogan di prova') && html.includes('© 2026 Prova SRL'), 'slogan e copyright del footer devono comparire');
  });

  await test('font_style "editorial" carica Fraunces/Inter nel vero <head>, con la foto hero a piena pagina e overlay scuro', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true, font_style: 'editorial',
        blocks_json: [{ type: 'hero', config: { headline: 'Prova', image_url: 'https://example.com/foto.jpg' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    const fontLinkPos = html.indexOf('fonts.googleapis.com/css2?family=Fraunces');
    assertTrue(fontLinkPos > -1 && fontLinkPos < headEnd, 'il link a Fraunces/Inter deve stare nel <head>');
    // 2026-09-06, confronto diretto con l'artifact vero mostrato dall'utente
    // ("la foto di sfondo non va bene, deve essere messa a sinistra unica
    // colonna"): la foto è un elemento proprio confinato alla colonna
    // sinistra (.s-hero-photo-el), non più uno sfondo a piena pagina della
    // section con un gradiente che ne rivela solo una fetta.
    assertTrue(html.includes('class="s-reveal s-hero s-hero-photo') && html.includes('class="s-hero-photo-el" style="background-image:url(\'https://example.com/foto.jpg\')"'), 'un hero con foto deve renderla come colonna propria a sinistra, non come sfondo a piena pagina della section');
    // 2026-09-06, segnalato dall'utente ("i bordi delle immagini sono
    // ancora da tagliare"): confrontando l'artifact, la foto dell'hero
    // arriva a filo dal basso della sezione — un riquadro aspect-ratio:4/5
    // centrato verticalmente (il comportamento precedente) lasciava un
    // bordo vuoto visibile sopra e sotto. bottom:0 sempre a filo; top NON
    // più 0 (2026-09-06, ulteriore segnalazione: "il bordo in alto deve
    // andare sotto il menu" — l'header è fixed/overlay e fuori dal
    // flusso, quindi top:0 mandava la foto fin sotto l'header invece di
    // iniziare sotto di lui).
    assertTrue(html.includes('.s-hero-photo-el{position:absolute;left:24px;top:80px;bottom:0;width:var(--s-hero-photo-w);background-size:cover'), 'la foto dell\'hero deve riempire l\'altezza della sezione fino in fondo (bottom:0) ma iniziare sotto l\'header fisso (top:80px, non 0)');
  });

  await test('le pagine pubbliche hanno una CSP che permette Google Fonts (bug reale: font dichiarato ma mai caricato, document.fonts vuoto)', async () => {
    const res1 = await fetch(BASE + '/negozio/home');
    const csp1 = res1.headers.get('content-security-policy') || '';
    assertTrue(csp1.includes('fonts.googleapis.com'), '/negozio deve permettere il foglio di stile di Google Fonts');
    assertTrue(csp1.includes('fonts.gstatic.com'), '/negozio deve permettere i file font veri (.woff2) di Google Fonts');

    const res2 = await fetch(BASE + '/__root_public');
    const csp2 = res2.headers.get('content-security-policy') || '';
    assertTrue(csp2.includes('fonts.googleapis.com') && csp2.includes('fonts.gstatic.com'), 'stessa CSP anche sulla root pubblica');
  });

  await test('GET /__root_public -> 404 se non c\'è una pagina "home" pubblicata (permette a nginx di ripiegare sulla SPA)', async () => {
    db.prepare("UPDATE site_pages SET published = 0 WHERE slug = 'home'").run();
    const res = await fetch(BASE + '/__root_public');
    assertEq(res.status, 404);
    db.prepare("UPDATE site_pages SET published = 1 WHERE slug = 'home'").run();
  });

  await test('POST /site-pages/preview renderizza una bozza MAI salvata, con lo stesso motore della pagina pubblica', async () => {
    const before = db.prepare("SELECT blocks_json FROM site_pages WHERE slug = 'home'").get().blocks_json;
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'Bozza mai salvata', blocks_json: [{ type: 'testo', config: { title: 'Titolo bozza vivo', body: 'corpo' } }] }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('Titolo bozza vivo'), 'l\'anteprima deve renderizzare il contenuto della bozza inviata');
    const after = db.prepare("SELECT blocks_json FROM site_pages WHERE slug = 'home'").get().blocks_json;
    assertEq(after, before, 'l\'anteprima non deve scrivere nulla nel DB, nemmeno sulla pagina home esistente');
  });

  await test('POST /site-pages/preview accetta sempre un blocco un tempo "PRO" (galleria) — funzionalità core, nessun gate', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'galleria', config: { image_urls: ['x.jpg'] } }] }),
    });
    assertEq(res.status, 200);
  });

  await test('POST /site-pages/preview rende editabili (contenteditable) i campi di testo di hero e testo, con lo script di sync nel body', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'Titolo hero', subheadline: 'Sottotitolo' } },
          { type: 'testo', config: { title: 'Titolo testo', body: 'Corpo' } },
        ],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('data-sw-block="0" data-sw-field="headline"'), 'hero.headline deve avere gli attributi di editing con l\'indice reale del blocco');
    assertTrue(body.html.includes('data-sw-block="1" data-sw-field="title"'), 'testo.title deve avere gli attributi di editing con l\'indice reale del blocco');
    assertTrue(body.html.includes("addEventListener('input'"), 'lo script di sincronizzazione col genitore deve essere presente');
  });

  await test('POST /site-pages/preview: gli indici di editing restano corretti anche con un blocco nascosto in mezzo (bug reale trovato scrivendo la feature)', async () => {
    // Il blocco nascosto (indice 1) NON compare nel rendering — prima della
    // correzione, il blocco 'testo' successivo (indice REALE 2) avrebbe preso
    // erroneamente l'indice 1 (posizione nella sequenza visibile, non in
    // blocks_json), scrivendo l'edit sul blocco sbagliato.
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'Hero' } },
          { type: 'cta', hidden: true, config: { title: 'Nascosto' } },
          { type: 'testo', config: { title: 'Titolo dopo il nascosto', body: 'x' } },
        ],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('data-sw-block="2" data-sw-field="title"'), 'il blocco testo deve mantenere il suo indice reale (2), non quello nella sequenza visibile (1)');
    assertTrue(!body.html.includes('data-sw-block="1"'), 'il blocco nascosto non deve comparire affatto nel rendering, quindi nessun edit può puntare al suo indice');
  });

  await test('POST /site-pages/preview: click-to-edit copre anche i campi dentro array (timeline.steps, valori.items) con percorso punteggiato', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'timeline', config: { title: 'Passi', steps: [{ titolo: 'Uno', testo: 'a' }, { titolo: 'Due', testo: 'b' }] } },
          { type: 'valori', config: { title: 'Valori', items: [{ eyebrow: 'X', titolo: 'Y', testo: 'z' }] } },
          { type: 'cta', config: { title: 'Parliamone' } },
          { type: 'header', config: { site_name: 'Il mio sito' } },
          { type: 'footer', config: { site_name: 'Il mio sito', tagline: 'Slogan', copyright_text: '© 2026' } },
        ],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('data-sw-block="0" data-sw-field="steps.1.titolo"'), 'il secondo passo della timeline deve avere il proprio percorso punteggiato (indice 1)');
    assertTrue(body.html.includes('data-sw-block="1" data-sw-field="items.0.eyebrow"'), 'il primo item dei valori deve avere il proprio percorso punteggiato');
    assertTrue(body.html.includes('data-sw-block="2" data-sw-field="title"'), 'il titolo della CTA deve essere editabile');
    assertTrue(body.html.includes('data-sw-block="3" data-sw-field="site_name"'), 'il nome sito dell\'header deve essere editabile');
    assertTrue(body.html.includes('data-sw-block="4" data-sw-field="copyright_text"'), 'il copyright del footer deve essere editabile');
  });

  await test('POST /site-pages/preview: click-to-edit copre le etichette dei link di nav_links (header) e delle colonne (footer, percorso a 3 livelli)', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Chi siamo', url: '#a' }] } },
          { type: 'footer', config: { site_name: 'X', columns: [{ title: 'Naviga', links: [{ label: 'Home', url: '#' }, { label: 'Contatti', url: '#c' }] }] } },
        ],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('data-sw-block="0" data-sw-field="nav_links.0.label"'), 'l\'etichetta del link di nav deve essere editabile');
    assertTrue(body.html.includes('data-sw-block="1" data-sw-field="columns.0.title"'), 'il titolo della colonna footer deve essere editabile');
    assertTrue(body.html.includes('data-sw-block="1" data-sw-field="columns.0.links.1.label"'), 'il secondo link della colonna (indice 1, percorso a 3 livelli) deve essere editabile con l\'indice giusto');
    assertTrue(body.html.includes("tagName === 'A'"), 'lo script di sync deve bloccare la navigazione sui link editabili (sono <a> reali)');
  });

  await test('block.anchor_id aggiunge un id reale al blocco (bug reale: la nav dell\'header puntava a id inesistenti, i link non facevano nulla)', async () => {
    // Pagina PUBBLICATA vera (non /preview, mai editable) — l'id deve
    // funzionare esattamente dove serviva davvero: la nav di un visitatore
    // reale, non l'anteprima admin (che aggiunge markup di drag/edit in
    // più, irrilevante per questo test specifico).
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'testo', anchor_id: 'chi-siamo', config: { title: 'Chi siamo', body: 'x' } },
          { type: 'cta', anchor_id: 'contatti', config: { title: 'Parliamo' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const body = await res.text();
    assertEq(res.status, 200);
    assertTrue(body.includes('<section id="chi-siamo" class="s-reveal s-testo">'), 'l\'id deve finire nel tag di apertura del blocco testo, sulla pagina pubblica reale');
    assertTrue(body.includes('<section id="contatti" class="s-reveal s-cta">'), 'stesso comportamento per un altro tipo di blocco (cta)');
    assertTrue(!body.includes('id=""'), 'un blocco senza anchor_id non deve ricevere un id vuoto');
  });

  await test('le sezioni sono più larghe del mockup originale (1400px, richiesto dall\'utente: "amplia la larghezza dei blocchi al margine della pagina"), mai il vecchio 960px', async () => {
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('max-width:1400px'), 'le sezioni devono usare 1400px — più largo anche del mockup originale (1200px), su richiesta esplicita');
    assertTrue(!html.includes('max-width:960px') && !html.includes('max-width:1200px'), 'i vecchi valori più stretti non devono più comparire');
  });

  await test('POST /site-pages/preview: ogni blocco ha una maniglia di drag reale nel canvas, con l\'indice giusto, mai su una pagina pubblica vera', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }, { type: 'testo', config: { title: 'Due', body: 'x' } }],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-drag-idx="0"'), 'la maniglia del primo blocco deve avere l\'indice reale 0');
    assertTrue(previewBody.html.includes('data-sw-drag-idx="1"'), 'la maniglia del secondo blocco deve avere l\'indice reale 1');
    assertTrue(previewBody.html.includes('data-sw-block-root="0"') && previewBody.html.includes('data-sw-block-root="1"'), 'ogni sezione deve essere un bersaglio di drop identificabile');
    assertTrue(previewBody.html.includes("addEventListener('dragstart'"), 'lo script di sync deve gestire il drag reale, non solo il testo');

    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(!pubHtml.includes('sw-drag-handle'), 'la pagina pubblica vera non deve MAI avere maniglie di drag — solo l\'anteprima admin');
  });

  await test('POST /site-pages/preview: ogni blocco di primo livello ha una toolbar reale nel canvas (sposta/duplica/elimina), con l\'indice giusto, mai su una pagina pubblica vera ("avanti con Divi" — canvas WYSIWYG)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'Uno' } },
          { type: 'riga', config: { columns: [{ width: 100, blocks: [{ type: 'testo', config: { title: 'Annidato', body: 'x' } }] }] } },
        ],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-action="move-up" data-sw-block-idx="0"'), 'il blocco 0 deve avere il pulsante sposta-su con l\'indice reale');
    assertTrue(previewBody.html.includes('data-sw-action="select" data-sw-block-idx="0"'), 'canvas WYSIWYG fase A: il blocco 0 deve avere anche il pulsante seleziona (evidenzia nella sidebar)');
    assertTrue(previewBody.html.includes('data-sw-action="duplicate" data-sw-block-idx="0"') && previewBody.html.includes('data-sw-action="delete" data-sw-block-idx="0"'), 'lo stesso blocco deve avere anche duplica ed elimina');
    assertTrue(previewBody.html.includes("addEventListener('click'") && previewBody.html.includes('block-action'), 'lo script di sync deve gestire il click della toolbar, non solo il drag');
    // Canvas WYSIWYG fase C (2026-09-05, "avanti savoia!"): un blocco
    // annidato ORA ha anche lui la toolbar, col suo percorso composto reale
    // — prima di questo pezzo restava escluso, vedi test dedicato più sotto
    // per la copertura completa (drag+toolbar+riordino annidato).
    assertTrue(previewBody.html.includes('data-sw-action="duplicate" data-sw-block-idx="1.c0.b0"'), 'un blocco annidato in una colonna deve avere anche lui la toolbar, col percorso composto (la riga è il blocco 1, dopo l\'hero)');

    const pubRes2 = await fetch(BASE + '/negozio/home');
    const pubHtml2 = await pubRes2.text();
    assertTrue(!pubHtml2.includes('sw-block-toolbar') && !pubHtml2.includes('sw-block-btn'), 'la pagina pubblica vera non deve MAI avere la toolbar — solo l\'anteprima admin');
  });

  await test('canvas WYSIWYG fase B: icona cliccabile, rimuovi/aggiungi voce per "valori" e "timeline", mai sulla pagina pubblica vera', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'valori', config: { title: 'v', items: [{ titolo: 'a', testo: 'b', icon: 'trophy' }] } },
          { type: 'timeline', config: { title: 't', steps: [{ titolo: 'c', testo: 'd' }] } },
        ],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-icon-block="0" data-sw-icon-field="items.0.icon" data-sw-icon-value="trophy"'), 'l\'icona esistente della voce valori deve essere cliccabile col valore reale');
    assertTrue(previewBody.html.includes('data-sw-array-action="remove" data-sw-array-block="0" data-sw-array-field="items" data-sw-array-idx="0"'), 'la voce valori deve avere il pulsante rimuovi con l\'indice giusto');
    assertTrue(previewBody.html.includes('data-sw-array-action="add" data-sw-array-block="0" data-sw-array-field="items"'), 'il blocco valori deve avere il pulsante aggiungi voce');
    // Non basta cercare "sw-icon-placeholder": la regola CSS .sw-icon-placeholder
    // è SEMPRE presente in <style> quando editable (stesso principio di
    // divisore/video/popup) — va verificato l'elemento reale, non il CSS.
    assertTrue(!previewBody.html.includes('<span class="sw-icon-placeholder"'), 'la voce valori ha già un\'icona, non deve comparire il placeholder "+ icona"');
    assertTrue(previewBody.html.includes('data-sw-array-action="remove" data-sw-array-block="1" data-sw-array-field="steps" data-sw-array-idx="0"'), 'il passo timeline deve avere il pulsante rimuovi con l\'indice giusto');
    assertTrue(previewBody.html.includes('data-sw-array-action="add" data-sw-array-block="1" data-sw-array-field="steps"'), 'il blocco timeline deve avere il pulsante aggiungi passo');
    assertTrue(previewBody.html.includes("type: 'icon-click'") && previewBody.html.includes("type: 'array-item-action'"), 'lo script di sync deve gestire sia il click icona sia le azioni sugli array');

    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(!pubHtml.includes('sw-array-add') && !pubHtml.includes('sw-array-remove') && !pubHtml.includes('data-sw-icon-block'), 'nessuno di questi controlli deve comparire sulla pagina pubblica vera');
  });

  await test('canvas WYSIWYG fase B: un blocco "valori"/"timeline" con zero voci resta invisibile sulla pagina pubblica, ma in editing mostra comunque il pulsante "+ Aggiungi" (altrimenti un blocco appena creato non avrebbe modo di ricevere la prima voce dal canvas)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'valori', config: { title: 'v', items: [] } }, { type: 'timeline', config: { title: 't', steps: [] } }],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-array-action="add" data-sw-array-block="0" data-sw-array-field="items"') && previewBody.html.includes('data-sw-array-action="add" data-sw-array-block="1" data-sw-array-field="steps"'), 'con zero voci, in editing deve comunque comparire il pulsante aggiungi per entrambi i tipi');

    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'valori', config: { title: 'v', items: [] } }] }),
    });
    assertEq(patchRes.status, 200);
    const pubHtml = await (await fetch(BASE + '/negozio/home')).text();
    // Non basta cercare "s-valori": la regola CSS .s-valori-grid è SEMPRE
    // presente in <style> (stesso principio già seguito per divisore/video/
    // popup), e il tag reale porta anche il prefisso "s-reveal " aggiunto
    // da withReveal — va verificato il tag <section> reale così com'è
    // renderizzato, non un frammento del CSS di base.
    assertTrue(!pubHtml.includes('class="s-reveal s-valori"'), 'sulla pagina pubblica vera un blocco valori senza voci resta invisibile, come sempre');
  });

  await test('POST /site-pages/preview: le immagini sono cliccabili nel canvas, e nessun campo con classe propria finisce con due attributi class= (bug reale trovato aggiungendo questa feature)', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'x', image_url: 'https://x/foto.jpg' } },
          { type: 'header', config: { site_name: 'X' } },
        ],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    assertTrue(body.html.includes('data-sw-img-block="0" data-sw-img-field="image_url"'), 'l\'immagine hero deve essere cliccabile con l\'indice reale del blocco');
    assertTrue(body.html.includes("addEventListener('click'") && body.html.includes('image-click'), 'lo script di sync deve gestire il click sulle immagini');
    // Bug reale: header.site_name (data-sw-field) finisce su un <a class="s-header-brand">
    // che ha GIÀ una classe — un secondo class="..." sullo stesso tag è HTML non valido.
    assertTrue(!/class="[^"]*"[^>]*class="/.test(body.html), 'nessun tag deve avere due attributi class= (HTML non valido)');
  });

  await test('POST /site-pages/preview: gli URL dei link (nav_links, colonne footer) hanno un\'icona dedicata cliccabile nel canvas, mai sulla pagina pubblica vera', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Chi siamo', url: '#a' }] } },
          { type: 'footer', config: { site_name: 'X', columns: [{ title: 'Naviga', links: [{ label: 'Home', url: '#' }] }] } },
        ],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-url-block="0" data-sw-url-field="nav_links.0.url"'), 'l\'icona per l\'URL del link di nav deve avere il percorso reale');
    assertTrue(previewBody.html.includes('data-sw-url-block="1" data-sw-url-field="columns.0.links.0.url"'), 'stesso comportamento per un link dentro una colonna del footer (percorso a 3 livelli)');
    assertTrue(previewBody.html.includes("type: 'url-click'"), 'lo script di sync deve gestire il click sull\'icona URL');
    assertTrue(!/class="[^"]*"[^>]*class="/.test(previewBody.html), 'ancora nessun tag con due attributi class= (stesso bug da non reintrodurre)');

    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(!pubHtml.includes('sw-url-edit'), 'la pagina pubblica vera non deve MAI avere l\'icona di modifica URL');
  });

  await test('blocco "riga": due colonne affiancate, ciascuna con la larghezza reale e il proprio contenuto, sulla pagina pubblica vera', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{
          type: 'riga',
          config: { columns: [
            { width: 70, blocks: [{ type: 'testo', config: { title: 'Colonna larga', body: 'x' } }] },
            { width: 30, blocks: [{ type: 'immagine', config: { image_url: 'https://x/a.jpg' } }] },
          ] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertEq(res.status, 200);
    assertTrue(html.includes('class="s-riga-col" style="flex:0 0 70%;max-width:70%"'), 'la prima colonna deve avere la larghezza reale configurata (70%), non un valore fisso');
    assertTrue(html.includes('class="s-riga-col" style="flex:0 0 30%;max-width:30%"'), 'stesso comportamento per la seconda colonna (30%)');
    assertTrue(html.includes('Colonna larga'), 'il contenuto del blocco testo dentro la prima colonna deve comparire davvero');
    assertTrue(html.includes('https://x/a.jpg'), 'il contenuto del blocco immagine dentro la seconda colonna deve comparire davvero');
  });

  await test('blocco "riga": header/footer non sono ammessi come figli, anche aggirando l\'editor e scrivendo l\'API a mano', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{
          type: 'riga',
          config: { columns: [{ width: 100, blocks: [
            { type: 'header', config: { site_name: 'Non deve comparire' } },
            { type: 'testo', config: { title: 'Sì invece', body: 'x' } },
          ] }] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(!html.includes('Non deve comparire'), 'un header annidato dentro una colonna non deve essere renderizzato (guard difensivo in renderRiga)');
    assertTrue(html.includes('Sì invece'), 'un blocco normale nella stessa colonna deve comunque comparire');
  });

  await test('blocco "riga": una riga può contenere un\'altra riga (nesting, "guardati Elementor e Divi")', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{
          type: 'riga',
          config: { columns: [{ width: 100, blocks: [
            { type: 'riga', config: { columns: [
              { width: 60, blocks: [{ type: 'testo', config: { title: 'Riga annidata sinistra', body: 'x' } }] },
              { width: 40, blocks: [{ type: 'testo', config: { title: 'Riga annidata destra', body: 'x' } }] },
            ] } },
          ] }] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertEq(res.status, 200);
    assertTrue(html.includes('Riga annidata sinistra') && html.includes('Riga annidata destra'), 'entrambe le colonne della riga annidata a 2 livelli devono comparire');
    assertTrue(html.includes('style="flex:0 0 60%;max-width:60%"') && html.includes('style="flex:0 0 40%;max-width:40%"'), 'le larghezze reali della riga annidata devono essere rispettate, non un valore fisso');
  });

  await test('blocco "riga": un annidamento oltre MAX_RIGA_DEPTH viene troncato (guard anti-ricorsione patologica), non fa esplodere il server', async () => {
    let nested = { type: 'testo', config: { title: 'Fondo', body: 'x' } };
    for (let i = 0; i < 6; i++) {
      nested = { type: 'riga', config: { columns: [{ width: 100, blocks: [nested] }] } };
    }
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [nested] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    assertEq(res.status, 200, 'un annidamento di 6 righe (oltre il tetto di 4) non deve far fallire la pagina pubblica');
    const html = await res.text();
    assertTrue(!html.includes('Fondo'), 'il contenuto oltre il tetto di profondità viene troncato, non renderizzato');
  });

  await test('blocco annidato in colonna: uno style_override diventa una regola scoperta al SUO percorso, distinta da quella della riga che lo contiene', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'testo', config: { title: 'Prima', body: 'x' } },
          { type: 'riga', config: { columns: [
            { width: 50, blocks: [{ type: 'testo', config: { title: 'Colonna A', body: 'x' }, style_overrides: { background: '#111' } }] },
            { width: 50, blocks: [{ type: 'testo', config: { title: 'Colonna B', body: 'x' } }] },
          ] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('data-s-blk="1.c0.b0"'), 'il blocco annidato deve avere un percorso composto, non il solo indice della riga (1) che condividerebbe con l\'altro figlio');
    assertTrue(html.includes('style="background:#111"'), 'lo stile del blocco annidato deve comparire davvero');
    assertTrue((html.match(/background:#111/g) || []).length === 1, 'solo il blocco annidato con lo style_override, non anche il suo vicino nella stessa riga');
  });

  await test('blocco annidato in colonna: override tablet/mobile genera la regola @media al percorso composto giusto', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'riga', config: { columns: [{ width: 100, blocks: [
            { type: 'testo', config: { title: 'x', body: 'y' }, style_overrides: { mobile: { padding: '4px' } } },
          ] }] } },
        ],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('@media (max-width:640px){[data-s-blk="0.c0.b0"]{padding:4px !important}}'), 'la regola responsive per il blocco annidato deve usare il suo percorso composto, non l\'indice piatto della riga');
  });

  await test('blocco annidato in colonna: compare "s-reveal" sulla pagina pubblica come un blocco di primo livello, e (canvas WYSIWYG fase C) ha ora anche maniglia di drag e toolbar col percorso composto giusto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'riga', config: { columns: [{ width: 100, blocks: [{ type: 'testo', config: { title: 'Annidato reveal', body: 'x' } }] }] } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(pubHtml.includes('s-reveal') && pubHtml.includes('Annidato reveal'), 'il blocco annidato deve comparire allo scroll come uno di primo livello');
    assertTrue(!pubHtml.includes('sw-drag-handle') && !pubHtml.includes('sw-block-toolbar'), 'la pagina pubblica vera non deve MAI avere maniglie/toolbar, annidato o no');
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'riga', config: { columns: [{ width: 100, blocks: [{ type: 'testo', config: { title: 'Annidato preview', body: 'x' } }] }] } }],
      }),
    });
    const previewBody = await previewRes.json();
    // Fase C (2026-09-05, "avanti savoia!"): un blocco annidato ora HA la
    // maniglia di drag e la toolbar, col suo percorso composto reale —
    // prima di questo pezzo restava gestito solo dalle frecce nel form.
    assertTrue(previewBody.html.includes('data-sw-drag-idx="0.c0.b0"'), 'il blocco annidato deve avere una maniglia di drag col percorso composto');
    assertTrue(previewBody.html.includes('data-sw-block-root="0.c0.b0"'), 'il blocco annidato deve essere un bersaglio di drop col percorso composto');
    assertTrue(previewBody.html.includes('data-sw-action="delete" data-sw-block-idx="0.c0.b0"'), 'il blocco annidato deve avere anche la toolbar (elimina) col percorso composto');
  });

  await test('canvas WYSIWYG fase D: zone "+" tra i blocchi di primo livello, con l\'indice reale di inserimento, mai sulla pagina pubblica vera', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'Uno' } },
          { type: 'testo', config: { title: 'Due', body: 'x' } },
        ],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-insert-at="0"'), 'deve esserci una zona "+" prima del primo blocco');
    assertTrue(previewBody.html.includes('data-sw-insert-at="1"'), 'deve esserci una zona "+" tra i due blocchi (inserisce prima del secondo)');
    assertTrue(previewBody.html.includes('data-sw-insert-at="2"'), 'deve esserci una zona "+" dopo l\'ultimo blocco (inserisce in fondo)');
    assertTrue(previewBody.html.includes("type: 'open-block-picker'"), 'lo script di sync deve gestire il click sul "+"');

    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(!pubHtml.includes('sw-insert-zone') && !pubHtml.includes('sw-insert-btn'), 'la pagina pubblica vera non deve MAI avere le zone "+" — solo l\'anteprima admin');
  });

  await test('canvas WYSIWYG fase D: un blocco nascosto in mezzo non sposta le posizioni di inserimento delle zone "+" (usa l\'indice reale, non quello della sequenza visibile)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'Uno' } },
          { type: 'testo', config: { title: 'Nascosto', body: 'x' }, hidden: true },
          { type: 'testo', config: { title: 'Tre', body: 'x' } },
        ],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    // Il blocco nascosto (indice reale 1) non compare, ma la zona "+" tra
    // "Uno" (0) e "Tre" (indice reale 2) deve puntare a 2, non a 1 (che
    // inserirebbe proprio dove sta il blocco nascosto, sovrascrivendolo).
    assertTrue(previewBody.html.includes('data-sw-insert-at="2"'), 'la zona "+" tra i due blocchi visibili deve usare l\'indice reale (2), non quello della sequenza visibile (1)');
  });

  await test('canvas WYSIWYG fase D: zone "+" anche dentro una colonna, col percorso composto giusto', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{
          type: 'riga',
          config: { columns: [{ width: 100, blocks: [{ type: 'testo', config: { title: 'Annidato', body: 'x' } }] }] },
        }],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(previewBody.html.includes('data-sw-insert-at="0.c0.b0"'), 'deve esserci una zona "+" prima del blocco annidato, col percorso composto');
    assertTrue(previewBody.html.includes('data-sw-insert-at="0.c0.b1"'), 'deve esserci una zona "+" dopo il blocco annidato (fondo colonna), col percorso composto');
  });

  await test('canvas WYSIWYG fase D (bug reale trovato scrivendo questo pezzo): icona/aggiungi/rimuovi voce di un blocco "valori" ANNIDATO in una colonna porta il percorso completo, non il campo nudo', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{
          type: 'riga',
          config: { columns: [{ width: 100, blocks: [{ type: 'valori', config: { title: 'v', items: [{ titolo: 'a', testo: 'b', icon: 'trophy' }] } }] }] },
        }],
      }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    // Prima di questo fix, data-sw-array-field sarebbe stato "items" nudo
    // (senza il prefisso columns.0.blocks.0.config.) — il popup avrebbe
    // scritto un "items" fantasma direttamente sul config della RIGA
    // (che non ce l'ha) invece di raggiungere il vero array annidato.
    assertTrue(previewBody.html.includes('data-sw-array-field="columns.0.blocks.0.config.items"'), 'il campo deve portare il percorso completo dentro la riga, non "items" nudo');
    assertTrue(previewBody.html.includes('data-sw-icon-field="columns.0.blocks.0.config.items.0.icon"'), 'stesso principio per il campo icona');
  });

  await test('blocco "riga": un blocco un tempo "PRO" annidato in colonna si vede sempre — funzionalità core, nessun gate', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{
          type: 'riga',
          config: { columns: [{ width: 100, blocks: [{ type: 'testimonianze', config: { items: [{ testo: 'Testimonianza annidata', autore: 'x' }] } }] }] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Testimonianza annidata'), 'un blocco un tempo "PRO" annidato in una colonna deve comparire sempre');
  });

  await test('POST /site-pages/preview: un campo di testo dentro una colonna di "riga" è editabile con il percorso composto corretto (columns.N.blocks.M.config.campo)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'hero', config: { headline: 'x' } },
          { type: 'riga', config: { columns: [{ width: 100, blocks: [{ type: 'testo', config: { title: 'Titolo colonna', body: 'x' } }] }] } },
        ],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('data-sw-block="1" data-sw-field="columns.0.blocks.0.config.title"'), 'il blocco riga è il secondo (indice reale 1) — il campo del figlio deve scrivere nel suo config nidificato, non alla radice');
  });

  await test('POST /site-pages/preview: la maniglia di ridimensionamento colonne compare solo TRA colonne (N-1 maniglie per N colonne), mai sulla pagina pubblica vera', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'riga', config: { columns: [
          { width: 33, blocks: [] }, { width: 33, blocks: [] }, { width: 34, blocks: [] },
        ] } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    const handleCount = (body.html.match(/class="sw-col-resize"/g) || []).length;
    assertEq(handleCount, 2, '3 colonne devono avere esattamente 2 maniglie (una per confine), mai una dopo l\'ultima colonna');
    assertTrue(body.html.includes("addEventListener('mousedown'"), 'lo script di sync deve gestire il drag di ridimensionamento colonne');

    const pubRes = await fetch(BASE + '/negozio/home');
    const pubHtml = await pubRes.text();
    assertTrue(!pubHtml.includes('sw-col-resize'), 'la pagina pubblica vera non deve MAI avere maniglie di ridimensionamento');
    assertTrue(!/class="[^"]*"[^>]*class="/.test(body.html), 'ancora nessun tag con due attributi class= (stesso bug da non reintrodurre)');
  });

  await test('blocco "form": i campi dichiarati diventano input HTML reali con nome/tipo/obbligatorietà corretti, sulla pagina pubblica vera', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{
          type: 'form',
          config: { title: 'Prenota una prova', fields: [
            { key: 'nome', label: 'Nome', type: 'text', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'note', label: 'Note', type: 'textarea', required: false },
          ], submit_label: 'Invia richiesta' },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('<input type="text" name="nome" required/>'), 'campo obbligatorio testo: input reale con name e required');
    assertTrue(html.includes('<input type="email" name="email" required/>'), 'campo email: type reale, non generico "text"');
    assertTrue(html.includes('<textarea name="note"></textarea>'), 'campo facoltativo: nessun attributo required');
    assertTrue(html.includes('data-s-page-slug="home"'), 'il body deve portare lo slug reale della pagina (usato dal JS di invio per costruire l\'URL)');
    assertTrue(html.includes("addEventListener('submit'"), 'lo script di invio deve essere incluso quando la pagina ha un blocco form');
  });

  await test('POST /negozio/:slug/leads: un invio valido crea un lead reale (solo i campi dichiarati, mai chiavi arbitrarie) + una notifica interna', async () => {
    const before = db.prepare('SELECT COUNT(*) as c FROM site_leads').get().c;
    const res = await fetch(BASE + '/negozio/home/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { nome: 'Mario Rossi', email: 'mario@x.it', note: 'Prova', campo_non_dichiarato: 'iniezione' } }),
    });
    const body = await res.json();
    assertEq(res.status, 201);
    const lead = db.prepare('SELECT * FROM site_leads ORDER BY id DESC LIMIT 1').get();
    const data = JSON.parse(lead.data_json);
    assertEq(db.prepare('SELECT COUNT(*) as c FROM site_leads').get().c, before + 1, 'deve essere stata inserita esattamente una riga');
    assertEq(data.nome, 'Mario Rossi');
    assertEq(data.email, 'mario@x.it');
    assertTrue(!('campo_non_dichiarato' in data), 'una chiave non dichiarata nel blocco form non deve mai finire salvata (whitelist server-side)');
    const notif = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 1').get();
    assertTrue(notif.message.includes('Mario Rossi') || notif.message.includes('mario@x.it'), 'la notifica deve riportare un riferimento reale al lead, non un messaggio generico');
    assertEq(JSON.stringify(JSON.parse(notif.roles)), JSON.stringify(['admin']), 'la notifica di un lead è per gli admin, non per ogni ruolo');
  });

  await test('POST /negozio/:slug/leads: 404 se la pagina non ha nessun blocco form, o se il sito/pagina non esistono', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'hero', config: { headline: 'x' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res1 = await fetch(BASE + '/negozio/home/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { x: 'y' } }) });
    assertEq(res1.status, 404);
    const res2 = await fetch(BASE + '/negozio/pagina-inesistente/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { x: 'y' } }) });
    assertEq(res2.status, 404);
  });

  await test('POST /negozio/:slug/leads: con due form nella stessa pagina, block_anchor sceglie quello giusto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [
          { type: 'form', anchor_id: 'form-a', config: { fields: [{ key: 'campo_a', label: 'A', type: 'text', required: true }] } },
          { type: 'form', anchor_id: 'form-b', config: { fields: [{ key: 'campo_b', label: 'B', type: 'text', required: true }] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block_anchor: 'form-b', data: { campo_a: 'non deve salvarsi', campo_b: 'sì' } }),
    });
    assertEq(res.status, 201);
    const lead = db.prepare('SELECT * FROM site_leads ORDER BY id DESC LIMIT 1').get();
    const data = JSON.parse(lead.data_json);
    assertEq(data.campo_b, 'sì');
    assertTrue(!('campo_a' in data), 'block_anchor deve selezionare SOLO i campi del form giusto, anche se un altro form sulla stessa pagina ha una chiave con lo stesso nome inviata per errore');
  });

  await test('header/footer: un logo SVG opzionale compare prima del nome sito, FUORI dal tag contenteditable (mai a rischio di essere cancellato editando il testo)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'header', config: { site_name: 'X', logo_svg: '<svg data-test="logo"></svg>' } },
          { type: 'footer', config: { site_name: 'X', logo_svg: '<svg data-test="logo2"></svg>' } },
        ],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('<span class="s-header-logo"><svg data-test="logo"></svg></span>'), 'il logo header deve comparire com\'è, prima del nome sito');
    assertTrue(/<span class="s-header-logo">.*?<\/span><a class="s-header-brand"/.test(body.html), 'il logo deve essere un fratello dell\'<a>, non annidato dentro il tag contenteditable');
    assertTrue(body.html.includes('<span class="s-footer-logo"><svg data-test="logo2"></svg></span>'), 'stesso comportamento per il footer');
    assertTrue(!/class="[^"]*"[^>]*class="/.test(body.html), 'ancora nessun tag con due attributi class= (stesso bug da non reintrodurre)');
  });

  await test('IT/EN: senza nessun campo _en compilato, il tasto non compare da nessuna parte (mai un pulsante che non farebbe niente)', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Chi siamo', url: '#a' }] } }, { type: 'hero', config: { headline: 'Titolo' } }],
      }),
    });
    const body = await res.json();
    assertEq(res.status, 200);
    // 'class="s-lang-toggle"', non solo 's-lang-toggle': il selettore CSS
    // ('.s-lang-toggle{...}') è sempre nel foglio di stile di ogni pagina,
    // compilato o no il tasto — un controllo sulla sola sottostringa darebbe
    // sempre falso positivo.
    assertTrue(!body.html.includes('class="s-lang-toggle"'), 'nessun tasto IT/EN renderizzato senza contenuto tradotto');
    assertTrue(!body.html.includes('data-i18n-en'), 'nessun attributo di traduzione senza contenuto tradotto');
  });

  await test('IT/EN: con un campo _en compilato ovunque nella pagina (anche annidato in nav_links), il tasto compare nell\'header e i dati di traduzione sono corretti', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'header', config: { site_name: 'Nico Caffè', nav_links: [{ label: 'Chi siamo', url: '#a', label_en: 'About us' }] } },
          { type: 'hero', config: { headline: 'Buongiorno', headline_en: 'Good morning', cta_label: 'Scopri', cta_url: '#x' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-lang-toggle"'), 'il tasto IT/EN deve comparire in header quando qualunque blocco ha un campo _en, non solo l\'header stesso');
    assertTrue(html.includes('<button type="button" data-lang="it" class="active">IT</button>'), 'IT deve partire attivo di default');
    assertTrue(html.includes('data-i18n-en="About us"'), 'la traduzione di un\'etichetta nav_links annidata deve arrivare nell\'HTML reale');
    assertTrue(html.includes('data-i18n-en="Good morning"'), 'la traduzione dell\'headline deve arrivare nell\'HTML reale');
    assertTrue(html.includes("addEventListener('click', function(){ applyLang"), 'lo script IT/EN deve essere incluso quando la pagina ha contenuto tradotto');
    assertTrue(!html.includes('data-i18n-en="Scopri"'), 'un campo senza _en compilato (cta_label qui) non deve avere l\'attributo di traduzione');
  });

  await test('IT/EN: il corpo multi-paragrafo del blocco "testo" porta sia l\'inglese sia l\'italiano grezzo, per poter ricostruire i paragrafi in entrambe le direzioni', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: { body: 'Primo paragrafo.\n\nSecondo paragrafo.', body_en: 'First paragraph.\n\nSecond paragraph.' } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('data-i18n-multi="1"'), 'il corpo multi-paragrafo deve essere marcato per la ricostruzione dei <p>, non uno scambio testuale semplice');
    assertTrue(body.html.includes('data-i18n-rich="1"'), 'il body ora passa sempre per il sanificatore rich (fase 3), va marcato come tale per lo swap via innerHTML');
    assertTrue(body.html.includes('data-i18n-it-raw="<p>Primo paragrafo.</p><p>Secondo paragrafo.</p>"'), 'il testo italiano deve arrivare già impacchettato in <p> (sanificato, non taggato) per poter fare innerHTML diretto in entrambe le direzioni');
    assertTrue(body.html.includes('data-i18n-en="<p>First paragraph.</p><p>Second paragraph.</p>"'), 'il testo inglese deve avere lo stesso trattamento, stessi paragrafi avvolti in <p>');
  });

  await test('caso reale Nico Caffè: header/footer nativi con logo+IT/EN+nav, form su "prova", tutto insieme si pubblica e rende senza errori', async () => {
    const headerLogo = '<svg viewBox="0 0 24 24"><defs><linearGradient id="nicoLogoHeader" x1="2" y1="2" x2="22" y2="22"><stop offset="0" stop-color="#F3DFA2"/><stop offset="1" stop-color="#7A6528"/></linearGradient></defs><path d="M4 8h12" stroke="url(#nicoLogoHeader)"/></svg>';
    const blocks_json = [
      { type: 'header', config: {
        site_name: 'Nico Caffè', logo_svg: headerLogo,
        nav_links: [
          { label: 'Chi siamo', url: '#chi-siamo', label_en: 'About us' },
          { label: 'Miscele', url: '#miscele', label_en: 'Blends' },
        ],
        cta_label: 'Parliamo', cta_label_en: "Let's talk", cta_url: '#contatti',
      } },
      { type: 'hero', config: { headline: 'Non vendiamo caffè.', headline_en: "We don't sell coffee.", cta_label: 'Scopri', cta_url: '#miscele' } },
      { type: 'testo', anchor_id: 'chi-siamo', config: { title: 'Due imprenditori', body: 'Para uno.\n\nPara due.' } },
      { type: 'griglia_prodotti', anchor_id: 'miscele', config: { title: 'Le miscele', source_module_slug: 'prodotti', campo_nome: 'nome' } },
      { type: 'form', anchor_id: 'prova', config: {
        title: 'Richiedete una prova', intro: 'Vi mandiamo un campione',
        fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }],
        submit_label: 'Invia richiesta',
      } },
      { type: 'cta', anchor_id: 'contatti', config: { title: 'Parliamo del vostro locale', cta_label: 'Contattaci', cta_url: 'mailto:x@x.it' } },
      { type: 'footer', config: {
        site_name: 'Nico Caffè', tagline: 'Artigianalmente Espresso', tagline_en: 'Handcrafted Espresso',
        columns: [{ title: 'Naviga', links: [{ label: 'Chi siamo', url: '#chi-siamo' }] }],
        copyright_text: '© 2026 Nico Caffè.', copyright_text_en: '© 2026 Nico Caffè. (EN)',
      } },
    ];
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, { method: 'PATCH', headers: auth, body: JSON.stringify({ published: true, blocks_json }) });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    assertEq(res.status, 200);
    const html = await res.text();
    assertTrue(html.includes('class="s-lang-toggle"'), 'il tasto IT/EN deve comparire (header e hero hanno campi _en)');
    assertTrue(html.includes('Nico Caffè') && html.includes('Parliamo') && html.includes('Richiedete una prova'), 'il contenuto reale deve arrivare nella pagina pubblica');
    assertTrue(html.includes('<form class="s-form-el"'), 'il form sulla sezione "prova" deve essere un vero form HTML');
    assertTrue(!/class="[^"]*"[^>]*class="/.test(html), 'nessun tag con due attributi class= su tutta la pagina reale');
    // griglia_prodotti non compare qui: nessun record reale per
    // source_module_slug='prodotti' in questo DB di test (renderGrigliaProdotti
    // ritorna '' senza dati, comportamento pre-esistente, non di questa
    // feature) — verificato solo sugli anchor dei blocchi che rendono davvero.
    assertTrue(html.includes('id="chi-siamo"') && html.includes('id="prova"') && html.includes('id="contatti"'), 'gli anchor_id reali devono restare al loro posto sui blocchi che rendono contenuto');
  });

  await test('IT/EN: timeline e valori supportano traduzioni per titolo sezione e per ogni voce dell\'array (steps/items)', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [
          { type: 'timeline', config: { title: 'Il viaggio', title_en: 'The journey', steps: [{ titolo: 'La raccolta', testo: 'x', titolo_en: 'The harvest', testo_en: 'y' }] } },
          { type: 'valori', config: { title: 'Origini', title_en: 'Origins', items: [{ eyebrow: 'Brasile', titolo: 'Brasile', testo: 'x', eyebrow_en: 'Brazil', titolo_en: 'Brazil', testo_en: 'y' }] } },
        ],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('data-i18n-en="The journey"') && body.html.includes('data-i18n-en="The harvest"') && body.html.includes('data-i18n-en="y"'), 'timeline: titolo sezione + titolo/testo del passo devono avere la traduzione');
    assertTrue(body.html.includes('data-i18n-en="Origins"') && body.html.includes('data-i18n-en="Brazil"'), 'valori: titolo sezione + eyebrow/titolo della voce devono avere la traduzione');
    // Il tasto IT/EN vive nel blocco header (unico posto dove ha senso
    // metterlo) — questa pagina non ne ha uno, quindi non deve comparire:
    // hasI18n riguarda i DATI di traduzione, non il pulsante in sé.
    assertTrue(!body.html.includes('class="s-lang-toggle"'), 'senza un blocco header in pagina, nessun posto dove mettere il tasto — corretto che non compaia');
  });

  await test('bug reale (segnalato dall\'utente: "da pc buono" implicava non da mobile): sotto 800px compare un vero menu hamburger con nav/IT-EN/CTA, non il vuoto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        blocks_json: [{ type: 'header', config: {
          site_name: 'X',
          nav_links: [{ label: 'Chi siamo', url: '#a', label_en: 'About us' }],
          cta_label: 'Parliamo', cta_label_en: "Let's talk", cta_url: '#c',
        } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-header-mobile-toggle"'), 'deve esistere un bottone hamburger reale, non solo la nav desktop che sparisce sotto 800px');
    assertTrue(html.includes('class="s-mobile-menu" id="sMobileMenu-0">'), 'il menu mobile deve avere un id univoco basato sull\'indice reale del blocco');
    assertTrue(/<div class="s-mobile-menu"[^>]*>[^<]*<a href="#a"/.test(html), 'il link di navigazione deve essere raggiungibile dentro il menu mobile, non perso');
    assertTrue(html.includes("data-lang=\"it\"") && html.split('data-lang="it"').length === 3, 'il tasto IT/EN deve comparire SIA nell\'header desktop SIA nel menu mobile (2 copie)');
    assertTrue(!html.includes('s-mobile-menu s-open'), 'il menu deve partire chiuso, mai aperto di default');
  });

  await test('menu mobile: assente se l\'header non ha nessun link di navigazione (nessun bottone che aprirebbe un menu vuoto)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'header', config: { site_name: 'X', nav_links: [] } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // 'class="s-header-mobile-toggle"', non solo la sottostringa: il
    // selettore CSS è sempre nel foglio di stile, stesso principio già
    // seguito per il test equivalente su s-lang-toggle.
    assertTrue(!html.includes('class="s-header-mobile-toggle"'), 'nessun bottone hamburger renderizzato senza link di navigazione da mostrare');
  });

  await test('email lead: senza connessione "email_resend" configurata, il lead si salva comunque ed email_status resta "simulato" (mai un invio finto)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'form', config: { fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }] } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { nome: 'Senza email' } }) });
    assertEq(res.status, 201);
    const lead = db.prepare('SELECT * FROM site_leads ORDER BY id DESC LIMIT 1').get();
    assertEq(lead.email_status, 'simulato');
  });

  await test('email lead: con la connessione "email_resend" e l\'indirizzo di notifica configurati, parte una vera richiesta HTTP a Resend con i dati corretti', async () => {
    // Mock selettivo di fetch: intercetta SOLO le chiamate verso api.resend.com
    // (mai una vera email durante i test), lascia passare tutte le altre —
    // incluse quelle che questo stesso file usa per parlare col server di
    // test. Ripristinato subito dopo, in un finally, per non contaminare gli
    // altri test.
    const realFetch = global.fetch;
    let capturedUrl = null, capturedBody = null, capturedAuth = null;
    global.fetch = (url, opts) => {
      if (String(url).startsWith('https://api.resend.com')) {
        capturedUrl = url; capturedBody = JSON.parse(opts.body); capturedAuth = opts.headers.Authorization;
        return Promise.resolve({ ok: true, status: 200 });
      }
      return realFetch(url, opts);
    };
    try {
      db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('email_resend', 1, ?) ON CONFLICT(integration_id) DO UPDATE SET credentials = excluded.credentials")
        .run(JSON.stringify({ api_key: 'FAKE_KEY', from_email: 'notifiche@nicocaffe.it' }));
      const settingsRes = await fetch(BASE + '/api/site-pages/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ lead_notification_email: 'admin@nicocaffe.it' }) });
      assertEq((await settingsRes.json()).lead_notification_email, 'admin@nicocaffe.it', 'GET/PATCH settings deve leggere/scrivere davvero lead_notification_email');

      const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
        method: 'PATCH', headers: auth,
        body: JSON.stringify({ published: true, blocks_json: [{ type: 'form', config: { fields: [{ key: 'nome', label: 'Nome e cognome', type: 'text', required: true }] } }] }),
      });
      assertEq(patchRes.status, 200);
      const res = await fetch(BASE + '/negozio/home/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { nome: 'Mario Rossi' } }) });
      assertEq(res.status, 201);

      assertEq(capturedUrl, 'https://api.resend.com/emails', 'deve chiamare davvero l\'endpoint reale di Resend');
      assertEq(capturedAuth, 'Bearer FAKE_KEY', 'deve usare la vera API key salvata nella connessione, non una finta');
      assertEq(capturedBody.from, 'notifiche@nicocaffe.it');
      assertEq(JSON.stringify(capturedBody.to), JSON.stringify(['admin@nicocaffe.it']));
      assertTrue(capturedBody.html.includes('Nome e cognome') && capturedBody.html.includes('Mario Rossi'), 'il corpo dell\'email deve avere l\'etichetta del campo (non solo la chiave tecnica) e il valore inviato');

      const lead = db.prepare('SELECT * FROM site_leads ORDER BY id DESC LIMIT 1').get();
      assertEq(lead.email_status, 'inviata', 'con una risposta 200 da Resend, l\'esito salvato deve essere "inviata"');
    } finally {
      global.fetch = realFetch;
      db.prepare("DELETE FROM connections WHERE integration_id = 'email_resend'").run();
    }
  });

  await test('email lead: se Resend risponde con un errore, il lead resta salvato ed email_status riflette il fallimento reale (mai "inviata" se non è vero)', async () => {
    const realFetch = global.fetch;
    global.fetch = (url, opts) => {
      if (String(url).startsWith('https://api.resend.com')) return Promise.resolve({ ok: false, status: 422 });
      return realFetch(url, opts);
    };
    try {
      db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('email_resend', 1, ?) ON CONFLICT(integration_id) DO UPDATE SET credentials = excluded.credentials")
        .run(JSON.stringify({ api_key: 'FAKE_KEY', from_email: 'x@x.it' }));
      await fetch(BASE + '/api/site-pages/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ lead_notification_email: 'admin@x.it' }) });
      const res = await fetch(BASE + '/negozio/home/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { nome: 'X' } }) });
      assertEq(res.status, 201, 'un fallimento di Resend non deve mai far fallire la risposta al visitatore — il lead è comunque salvato');
      const lead = db.prepare('SELECT * FROM site_leads ORDER BY id DESC LIMIT 1').get();
      assertEq(lead.email_status, 'errore');
    } finally {
      global.fetch = realFetch;
      db.prepare("DELETE FROM connections WHERE integration_id = 'email_resend'").run();
    }
  });

  await test('comparsa allo scroll: sulla pagina pubblica vera i blocchi di contenuto sono marcati "s-reveal", header/footer no, e lo script/il fallback <noscript> ci sono', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'header', config: { site_name: 'X' } }, { type: 'hero', config: { headline: 'x' } }, { type: 'footer', config: { site_name: 'X' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-reveal s-hero'), 'un blocco di contenuto normale deve avere la classe s-reveal');
    assertTrue(!html.includes('class="s-reveal s-header') && !/<header[^>]*class="[^"]*s-reveal/.test(html), 'l\'header (chrome sempre visibile) non deve avere s-reveal');
    assertTrue(!/<footer[^>]*class="[^"]*s-reveal/.test(html), 'il footer (chrome sempre visibile) non deve avere s-reveal');
    assertTrue(html.includes('new IntersectionObserver'), 'lo script osservatore deve essere incluso sulla pagina pubblica vera');
    assertTrue(html.includes('<noscript><style>.s-reveal{opacity:1 !important'), 'senza JS (o per un crawler che non lo esegue) il contenuto deve restare SEMPRE visibile — motore SEO-first');
  });

  await test('animazioni reali per blocco ("guardati Elementor e Divi", oltre il fade-in generico): left/right/zoom aggiungono una classe modificatrice, "none" disattiva del tutto la comparsa allo scroll', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'testo', config: { title: 'Sinistra', body: 'x' }, style_overrides: { animation: 'left' } },
          { type: 'testo', config: { title: 'Zoom', body: 'x' }, style_overrides: { animation: 'zoom' } },
          { type: 'testo', config: { title: 'Sempre visibile', body: 'x' }, style_overrides: { animation: 'none' } },
          { type: 'testo', config: { title: 'Predefinito', body: 'x' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-reveal s-reveal-left '), 'animation:"left" deve aggiungere la classe modificatrice, non sostituire s-reveal');
    assertTrue(html.includes('class="s-reveal s-reveal-zoom '), 'stesso comportamento per "zoom"');
    const noneIdx = html.indexOf('Sempre visibile');
    const noneTagStart = html.lastIndexOf('<section', noneIdx);
    const noneOwnTag = html.slice(noneTagStart, noneIdx);
    assertTrue(!/class="[^"]*s-reveal/.test(noneOwnTag), 'animation:"none" non deve avere NESSUNA classe s-reveal sul PROPRIO tag, il blocco resta sempre visibile');
    const defaultIdx = html.indexOf('Predefinito');
    const defaultTagStart = html.lastIndexOf('<section', defaultIdx);
    const defaultOwnTag = html.slice(defaultTagStart, defaultIdx);
    assertTrue(/class="s-reveal /.test(defaultOwnTag) && !/s-reveal-/.test(defaultOwnTag), 'senza animation esplicita il comportamento resta quello di sempre (solo s-reveal, nessuna classe modificatrice)');
  });

  await test('animazioni per blocco: un valore non nell\'allowlist viene ignorato (mai una classe CSS arbitraria in output, stesso principio delle icone)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'y' }, style_overrides: { animation: 'qualcosa"><script>' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-reveal ') && !html.includes('s-reveal-qualcosa'), 'un valore non riconosciuto deve ricadere sul comportamento predefinito, mai comparire alla cieca in una classe');
  });

  await test('comparsa allo scroll: MAI nell\'anteprima admin (ctx.editable) — l\'iframe si ricarica spesso mentre si modifica, un fade-in ripetuto sarebbe solo fastidioso', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'x' } }] }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    // 'class="s-reveal', non solo 's-reveal': la REGOLA CSS (.s-reveal{...})
    // è sempre nel foglio di stile di ogni pagina (stesso principio già
    // seguito per i test equivalenti su s-lang-toggle/s-header-mobile-toggle)
    // — quello che non deve mai esserci in anteprima è la classe APPLICATA
    // a un elemento, e lo script che la attiva.
    assertTrue(!body.html.includes('class="s-reveal'), 'nessun blocco deve avere la classe s-reveal applicata nell\'anteprima admin');
    assertTrue(!body.html.includes('new IntersectionObserver'), 'nessuno script di reveal nell\'anteprima admin');
  });

  await test('bug reale (segnalato subito dall\'utente: pagina completamente vuota dopo il fix precedente): lo sfondo scuro a piena larghezza non deve espandersi in verticale, solo in orizzontale', async () => {
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // Il box-shadow 100vmax da solo si espande in OGNI direzione — con più
    // sezioni scure impilate copre di vernice tutto il contenuto sopra.
    // clip-path:inset(0 -100vmax) taglia l'espansione ai bordi VERI
    // superiore/inferiore dell'elemento (0), lasciandola libera solo ai lati
    // (inset negativo). Deve esserci SEMPRE insieme al box-shadow, mai l'uno
    // senza l'altro.
    assertTrue(html.includes('box-shadow:0 0 0 100vmax #1c1917;clip-path:inset(0 -100vmax)'), 'il clip-path che impedisce alla vernice di coprire il contenuto sopra/sotto deve essere sempre presente insieme al box-shadow');
  });

  await test('blocco "form": titolo/introduzione e il box del form sono centrati sulla pagina (richiesto dall\'utente: "anche il form io lo centrerei")', async () => {
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('.s-form{text-align:center}'), 'titolo e introduzione del blocco form devono essere centrati');
    // 2026-09-06, confronto diretto col mockup: il box è diventato una card
    // chiara (crema) con padding/ombra propri — max-width cresciuto da 480 a
    // 520px per ospitare il padding interno senza stringere i campi.
    assertTrue(html.includes('.s-form-el{max-width:520px;margin:0 auto;text-align:left'), 'il box del form deve essere centrato nella pagina (margin:0 auto), coi campi al suo interno allineati a sinistra per restare leggibili');
  });

  await test('bug reale (segnalato dall\'utente: "dopo header e prima di footer c\'è una linea bianca"): s-dark-top/s-dark-bottom non devono avere margine', async () => {
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // header/footer sono SEMPRE scuri di loro (CSS fisso, non seguono
    // block.dark) ma darkClass() non lo sa — il primo/ultimo blocco scuro
    // della pagina riceve SEMPRE s-dark-top/s-dark-bottom, anche quando
    // l'elemento vero sopra/sotto è già scuro. Un margine lì scoprirebbe il
    // bianco della pagina esattamente in quel punto — le classi restano,
    // ma senza alcun margine.
    assertTrue(!/\.s-dark-top\{margin/.test(html), 's-dark-top non deve avere alcun margine');
    assertTrue(!/\.s-dark-bottom\{margin/.test(html), 's-dark-bottom non deve avere alcun margine');
  });

  await test('font_style "dm_serif": carica DM Serif Display/DM Sans veri nel vero <head> (scelto dall\'utente confrontando 4 coppie reali sullo sfondo scuro del sito)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, font_style: 'dm_serif', blocks_json: [{ type: 'hero', config: { headline: 'x' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    const linkPos = html.indexOf('family=DM+Serif+Display');
    assertTrue(linkPos > -1 && linkPos < headEnd, 'il link ai font DM Serif Display/DM Sans deve stare nel vero <head>');
    assertTrue(html.includes("'DM Serif Display', Georgia, serif") && html.includes("'DM Sans', -apple-system, sans-serif"), 'headingFont/bodyFont devono usare i font reali, non solo un nome scritto in CSS');
  });

  await test('bug reale (segnalato dall\'utente confrontando col mockup testo per testo: "a me non pare"): occhiello + introduzione ora esistono su hero/testo/cta/timeline/valori/form', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'hero', config: { eyebrow: 'Un occhiello hero', headline: 'x', cta_label: 'Primo', cta_url: '#a', cta_label2: 'Secondo', cta_url2: '#b' } },
          { type: 'timeline', config: { eyebrow: 'Un occhiello timeline', title: 'Viaggio', intro: 'Un\'introduzione', steps: [{ titolo: 'x', testo: 'y' }] } },
          { type: 'valori', config: { eyebrow: 'Un occhiello valori', title: 'Origini', intro: 'Altra introduzione', items: [{ titolo: 'x', testo: 'y' }] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue((html.match(/class="s-eyebrow"/g) || []).length === 3, 'ogni sezione con un occhiello compilato deve renderizzarlo (3 sezioni in questo test)');
    assertTrue(html.includes('Un occhiello hero') && html.includes('Un occhiello timeline') && html.includes('Un occhiello valori'), 'il testo reale dell\'occhiello deve comparire per ciascuna sezione');
    assertTrue(html.includes('class="s-section-intro"') && html.includes('Un\'introduzione') && html.includes('Altra introduzione'), 'timeline e valori devono renderizzare il paragrafo introduttivo');
    assertTrue(html.includes('class="s-btn s-btn-ghost"') && html.includes('>Secondo<'), 'l\'hero deve avere un secondo pulsante (stile fantasma) quando configurato');
  });

  await test('blocco "form": occhiello e introduzione hanno anche la traduzione EN (gap trovato durante l\'audit dei testi col mockup)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'form', config: {
          eyebrow: 'Provala', eyebrow_en: 'Try it', title: 'x', title_en: 'y', intro: 'z', intro_en: 'w',
          fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }],
        } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('data-i18n-en="Try it"') && html.includes('data-i18n-en="y"') && html.includes('data-i18n-en="w"'), 'occhiello, titolo e introduzione del form devono avere tutti la traduzione se compilata');
  });

  await test('bug reale (audit testi 2026-09-05): "cta" e "griglia_prodotti" avevano occhiello/introduzione mancanti rispetto al mockup', async () => {
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 3, ?)")
      .run('Prodotti CTA Test', 'prodotti_cta_test', 'box', '#2563EB', JSON.stringify({
        version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }],
      }));
    db.prepare('INSERT INTO records (module_slug, data, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('prodotti_cta_test', JSON.stringify({ nome: 'Miscela A', attivo: 'true' }));
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'cta', config: { eyebrow: 'Un occhiello cta', title: 'x', intro: 'Introduzione cta', cta_label: 'Vai', cta_url: '#a' } },
          { type: 'griglia_prodotti', config: { eyebrow: 'Un occhiello prodotti', title: 'y', intro: 'Introduzione prodotti', source_module_slug: 'prodotti_cta_test', campo_nome: 'nome', filter_field: 'attivo', filter_value: 'true' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue((html.match(/class="s-eyebrow"/g) || []).length === 2, 'sia cta che griglia_prodotti devono renderizzare il proprio occhiello');
    assertTrue(html.includes('Un occhiello cta') && html.includes('Un occhiello prodotti'), 'il testo reale dell\'occhiello deve comparire per entrambe le sezioni');
    assertTrue((html.match(/class="s-section-intro"/g) || []).length === 2 && html.includes('Introduzione cta') && html.includes('Introduzione prodotti'), 'sia cta che griglia_prodotti devono renderizzare il paragrafo introduttivo');
  });

  await test('mix visivo (2026-09-05, richiesto dall\'utente confrontando due mockup): timeline e valori renderizzano un\'icona reale in un cerchio, quando configurata', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'timeline', config: { title: 't', steps: [{ titolo: 'x', testo: 'y', icon: 'leaf' }] } },
          { type: 'valori', config: { title: 'v', items: [{ titolo: 'a', testo: 'b', icon: 'trophy' }, { titolo: 'c', testo: 'd' }] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-timeline-marker"><svg'), 'il marker della timeline deve contenere l\'svg dell\'icona, non solo il numero, quando configurata');
    assertTrue(html.includes('class="s-valore-icon"'), 'la card valori con icona deve avere il cerchio icona');
    assertTrue((html.match(/class="s-valore-icon"/g) || []).length === 1, 'solo la voce con icon configurata deve avere il cerchio, non tutte');
  });

  await test('un nome icona non nell\'allowlist viene ignorato (mai un\'icona non riconosciuta renderizzata alla cieca)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'timeline', config: { title: 't', steps: [{ titolo: 'x', testo: 'y', icon: 'nome-a-caso' }] } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-timeline-marker">1<'), 'senza un\'icona valida deve ricadere sul numero del passo, come prima');
  });

  await test('bug reale (richiesto dall\'utente 2026-09-05: "l\'elenco prodotti ora è il magazzino... mantieni la possibilità di inserire i prodotti del magazzino a scelta del cliente"): griglia_prodotti accetta un elenco manuale quando nessun modulo è collegato', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'griglia_prodotti', config: {
          title: 'Le nostre miscele',
          items: [
            { nome: 'Perfezione Artigianale', descrizione: 'Equilibrio classico.', prezzo: 12.5 },
            { nome: 'Capolavoro del Tostatore', descrizione: 'Struttura decisa.' },
          ],
        } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Perfezione Artigianale') && html.includes('Capolavoro del Tostatore'), 'l\'elenco manuale deve renderizzare i prodotti scritti a mano, senza nessun modulo collegato');
    assertTrue(html.includes('€ 12.50'), 'il prezzo scritto a mano deve comparire quando presente');
  });

  await test('griglia_prodotti: quando un modulo reale è collegato, i suoi dati vincono sempre sull\'elenco manuale (mai dati finti quando ne esistono di veri)', async () => {
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, sort_order, schema_json) VALUES (?, ?, ?, ?, 1, 4, ?)")
      .run('Prodotti Precedenza Test', 'prodotti_precedenza_test', 'box', '#2563EB', JSON.stringify({
        version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }],
      }));
    db.prepare('INSERT INTO records (module_slug, data, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('prodotti_precedenza_test', JSON.stringify({ nome: 'Prodotto reale del modulo' }));
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'griglia_prodotti', config: {
          title: 'x', source_module_slug: 'prodotti_precedenza_test', campo_nome: 'nome',
          items: [{ nome: 'Prodotto manuale che NON deve comparire' }],
        } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('Prodotto reale del modulo'), 'il modulo collegato deve renderizzare i suoi record veri');
    assertTrue(!html.includes('Prodotto manuale che NON deve comparire'), 'l\'elenco manuale non deve comparire quando un modulo reale è collegato');
  });

  await test('mix visivo (materiale mockup 2026-09-05): la card "valori" renderizza una foto quando configurata (es. origini con foto reale)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'valori', config: { title: 'Origini', items: [
          { titolo: 'Brasile', testo: 'x', immagine: 'https://example.com/brasile.jpg' },
          { titolo: 'Perù', testo: 'y' },
        ] } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-valore-photo" src="https://example.com/brasile.jpg"'), 'la voce con immagine configurata deve renderizzare la foto');
    assertTrue((html.match(/class="s-valore-photo"/g) || []).length === 1, 'solo la voce con immagine deve avere la foto, non tutte');
  });

  await test('mix visivo (richiesto dall\'utente: "non puoi farlo uguale a questo punto?"): la timeline ha layout orizzontale con badge numerato e cerchio foto/icona', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'timeline', config: { title: 't', steps: [
          { titolo: 'La raccolta', testo: 'x', immagine: 'https://example.com/raccolta.jpg' },
          { titolo: 'Il trasporto', testo: 'y', icon: 'truck' },
        ] } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-timeline-num">1<') && html.includes('class="s-timeline-num">2<'), 'ogni passo deve avere il badge numerato separato dal cerchio');
    assertTrue(html.includes('class="s-timeline-photo" src="https://example.com/raccolta.jpg"'), 'il passo con immagine deve renderizzare la foto nel cerchio, non l\'icona/numero');
  });

  await test('blocco "testo": photo_overlay sceglie il layout della foto, non block.dark (bug reale segnalato dall\'utente con screenshot: "chi siamo" scuro voleva comunque la foto in riquadro)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'testo', dark: true, config: { title: 'Mission', body: 'x', image_url: 'https://example.com/mission.jpg', photo_overlay: true } },
          { type: 'testo', dark: true, config: { title: 'Chi siamo', body: 'y', image_url: 'https://example.com/chisiamo.jpg' } },
          { type: 'testo', config: { title: 'Altro', body: 'z', image_url: 'https://example.com/altro.jpg' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // "s-reveal " precede sempre le altre classi (comparsa allo scroll,
    // stesso principio già seguito per gli altri match esatti su class=).
    assertTrue(html.includes('class="s-reveal s-testo s-testo-photo-bg') && html.includes("url('https://example.com/mission.jpg')"), 'con photo_overlay:true, la foto deve essere a piena pagina con overlay, come la mission nel mockup reale');
    assertTrue(html.includes('class="s-reveal s-testo s-testo-img s-dark') && html.includes('<img class="s-testo-photo" src="https://example.com/chisiamo.jpg"'), 'scuro MA senza photo_overlay deve restare in riquadro affiancato (con i colori del tema scuro comunque applicati) — non dedurre il layout dal tema');
    assertTrue(html.includes('class="s-reveal s-testo s-testo-img"') && html.includes('<img class="s-testo-photo" src="https://example.com/altro.jpg"'), 'chiaro senza photo_overlay resta in riquadro affiancato, comportamento invariato');
  });

  await test('mix visivo ("lo voglio uguale", 2026-09-05): scritta a mano decorativa su hero/footer, font Playfair Display caricato solo se richiesto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true, font_style: 'playfair',
        blocks_json: [
          { type: 'hero', config: { headline: 'x', handwritten: 'Più di un caffè.' } },
          { type: 'footer', config: { site_name: 'y', copyright_text: '© 2026', handwritten: 'La qualità che senti.' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    assertTrue(html.indexOf('family=Playfair+Display') > -1 && html.indexOf('family=Playfair+Display') < headEnd, 'font_style "playfair" deve caricare Playfair Display nel vero <head>');
    assertTrue(html.indexOf('family=Caveat') > -1 && html.indexOf('family=Caveat') < headEnd, 'la scritta a mano deve caricare il font Caveat nel vero <head>, solo perché è stata usata');
    assertTrue((html.match(/class="s-handwritten"/g) || []).length === 2 && html.includes('Più di un caffè.') && html.includes('La qualità che senti.'), 'sia hero che footer devono renderizzare la propria scritta a mano quando configurata');
  });

  await test('senza nessuna scritta a mano configurata, il font Caveat non viene mai caricato (niente font extra non richiesti)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'hero', config: { headline: 'x' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(!html.includes('family=Caveat'), 'nessuna scritta a mano configurata -> nessun link al font Caveat');
  });

  await test('mix visivo (file .html "struttura da usare", 2026-09-05): nav su due righe, griglia valori a icone in riquadro a 4 colonne, prodotto come banner con freccia', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'header', config: { site_name: 'x', nav_links: [{ label: 'Chi siamo', url: '#a' }, { label: 'Contatti', url: '#b', sub: true }] } },
          { type: 'valori', config: { title: 'Perché sceglierci', items: [{ titolo: 'Costanza', testo: 'x', icon: 'trophy' }, { titolo: 'Cura', testo: 'y', icon: 'heart' }] } },
          { type: 'griglia_prodotti', config: { title: 'Le nostre miscele', items: [{ nome: 'Caffè', immagine: 'https://example.com/caffe.jpg' }] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-header-nav-sub"') && html.includes('>Contatti<'), 'un link con sub:true deve avere la classe per la riga secondaria');
    assertTrue(!html.includes('class="s-header-nav-sub">Chi siamo<'), 'un link senza sub non deve avere quella classe');
    assertTrue(html.includes('s-valori-grid s-valori-grid-inline') && (html.match(/class="s-valore s-valore-inline"/g) || []).length === 2, 'una griglia valori tutta a icone deve avere il riquadro a 4 colonne');
    // 2026-09-06, confronto diretto col mockup incollato dall'utente in
    // chat ("nell'artifact sono box diversi"): la card banner con foto a
    // sfondo e freccia veniva da un file .html DIVERSO di questa stessa
    // sessione precedente ("struttura da usare"), non dal mockup reale —
    // lì la foto è un elemento proprio in cima alla card, non uno sfondo.
    assertTrue(html.includes('<div class="s-prodotto-photo"><img src="https://example.com/caffe.jpg"'), 'la card prodotto con foto deve avere un elemento foto proprio in cima, non uno sfondo dell\'intera card');
  });

  await test('blocco "testo" con photo_overlay può avere una nota laterale breve', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', dark: true, config: { title: 'x', body: 'y', image_url: 'https://example.com/z.jpg', aside: 'Rispetto per le origini.', photo_overlay: true } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('class="s-testo-aside"') && html.includes('Rispetto per le origini.'), 'la nota laterale deve renderizzarsi quando configurata');
  });

  await test('POST /site-pages/preview: si può trascinare un blocco NUOVO dal pannello (fuori dall\'iframe) direttamente in un punto del canvas, non solo aggiungerlo in fondo', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const previewBody = await previewRes.json();
    assertEq(previewRes.status, 200);
    // Il payload deve viaggiare nel vero dataTransfer (setData/getData), non
    // in una variabile JS condivisa — il pannello che trascina il blocco
    // nuovo vive nel documento genitore, fuori da questo iframe.
    assertTrue(previewBody.html.includes("setData('text/plain'"), 'il drag della maniglia deve scrivere nel dataTransfer nativo, leggibile anche da un drag iniziato fuori dall\'iframe');
    assertTrue(previewBody.html.includes("indexOf('new-block:')") && previewBody.html.includes("type: 'insert-block'"), 'il drop deve riconoscere un blocco nuovo trascinato dal pannello e mandare un messaggio distinto dal riordino');
  });

  await test('stile per singolo blocco ("guardati Elementor e Divi"): padding/sfondo/allineamento/colore per un blocco specifico, senza toccarne altri', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'testo', config: { title: 'x', body: 'y' }, style_overrides: { background: '#eee', padding: '10px', text_align: 'center', color: '#111' } },
          { type: 'testo', config: { title: 'z', body: 'w' } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('style="background:#eee;padding:10px;text-align:center;color:#111"'), 'gli override configurati devono comparire tutti insieme nello style del blocco');
    assertTrue((html.match(/\sstyle="background:#eee/g) || []).length === 1, 'solo il primo blocco deve avere quello stile, non anche il secondo');
  });

  await test('stile per singolo blocco: si somma a uno stile già esistente (es. hero con foto a sfondo), non lo sostituisce', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'hero', config: { headline: 'x', image_url: 'https://example.com/f.jpg' }, style_overrides: { padding: '5px' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes("url('https://example.com/f.jpg')") && html.includes('padding:5px'), 'lo style già presente (background-image) e l\'override (padding) devono convivere nello stesso attributo');
    assertTrue((html.match(/\sstyle="/g) || []).length === 1 || !html.includes('style="padding:5px" style='), 'mai due attributi style= sullo stesso tag');
  });

  await test('nuovi tipi di blocco ("guardati Elementor e Divi"): divisore, video (YouTube/Vimeo/file), FAQ ad accordion', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'divisore', config: { spaziatura: 'grande' } },
          { type: 'video', config: { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Come nasce una miscela' } },
          { type: 'video', config: { video_url: 'https://esempio.it/video.mp4' } },
          { type: 'accordion', config: { title: 'Domande frequenti', items: [{ domanda: 'Spedite in tutta Italia?', risposta: 'Sì, in 24-48h.' }] } },
        ],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    assertTrue(html.includes('s-divisore" style="height:96px"'), 'il divisore deve avere l\'altezza scelta');
    assertTrue(html.includes('src="https://www.youtube.com/embed/dQw4w9WgXcQ"'), 'un URL YouTube deve diventare un vero iframe embed');
    assertTrue(html.includes('<video src="https://esempio.it/video.mp4" controls>'), 'un file video diretto deve diventare un tag <video> nativo');
    assertTrue(html.includes('<summary') && html.includes('Spedite in tutta Italia?') && html.includes('Sì, in 24-48h.'), 'la FAQ deve renderizzare domanda e risposta con <details>/<summary> nativi (funziona senza JS)');
  });

  await test('blocco "video": un URL non riconosciuto non genera nessun player finto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'video', config: { video_url: 'https://esempio.it/pagina-qualunque' } }] }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    // "s-video-frame" compare comunque nel CSS del <head> a prescindere —
    // stesso principio già seguito per gli altri match esatti su class=,
    // qui va cercato il tag renderizzato, non la regola CSS.
    assertTrue(!html.includes('class="s-video"') && !html.includes('s-video s-dark'), 'un URL non riconosciuto non deve produrre nessuna sezione video');
  });

  await test('stile per singolo blocco: valori diversi per tablet/mobile ("vai su tutto" — l\'anteprima responsive ora può anche cambiare, non solo mostrare)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'y' }, style_overrides: { background: '#fff', tablet: { padding: '20px' }, mobile: { text_align: 'center', color: '#f00' } } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const res = await fetch(BASE + '/negozio/home');
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    const mediaPos = html.indexOf('@media (max-width:900px)');
    assertTrue(mediaPos > -1 && mediaPos < headEnd, 'la regola tablet deve stare nel vero <head>, non nel body');
    assertTrue(html.includes('@media (max-width:900px){[data-s-blk="0"]{padding:20px !important}}'), 'la regola tablet deve avere !important, per vincere sull\'override di base inline');
    assertTrue(html.includes('@media (max-width:640px){[data-s-blk="0"]{text-align:center !important;color:#f00 !important}}'), 'la regola mobile deve combinare tutti i suoi campi in una sola regola');
    assertTrue(html.includes('data-s-blk="0"') && html.includes('style="background:#fff"'), 'il tag radice deve avere sia il selettore stabile che lo style di base');
  });

  await test('Theme Builder ("settimane di riprogettazione" scelto dall\'utente): senza Tema condiviso il comportamento resta ESATTAMENTE quello di sempre (header inline in blocks_json)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'header', config: { site_name: 'Inline' } }, { type: 'testo', config: { title: 'x', body: 'y' } }] }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('Inline'), 'senza Tema, l\'header inline della pagina deve comparire come sempre');
  });

  await test('Theme Builder: GET/PATCH /site-pages/theme salva header/footer condivisi, validando il type', async () => {
    const getBefore = await (await fetch(BASE + '/api/site-pages/theme', { headers: auth })).json();
    assertEq(getBefore.header, null, 'nessun Tema configurato all\'inizio -> header null');
    const badRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ header: { type: 'footer', config: {} } }),
    });
    assertEq(badRes.status, 400, 'un header con type sbagliato deve essere rifiutato');
    const okRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ header: { type: 'header', config: { site_name: 'Tema Condiviso' } }, footer: { type: 'footer', config: { site_name: 'Tema Condiviso' } } }),
    });
    assertEq(okRes.status, 200);
    const okBody = await okRes.json();
    assertEq(okBody.header.config.site_name, 'Tema Condiviso');
    assertEq(okBody.footer.config.site_name, 'Tema Condiviso');
  });

  await test('Theme Builder: l\'header/footer condiviso compare su una pagina che NON lo definisce, e un blocco header inline residuo viene ignorato (mai duplicato)', async () => {
    await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        header: { type: 'header', config: { site_name: 'Header Condiviso', nav_links: [{ label: 'Chi siamo', url: '#chi-siamo' }] } },
        footer: { type: 'footer', config: { site_name: 'Footer Condiviso', copyright_text: '© Condiviso' } },
      }),
    });
    // Pagina SENZA nessun blocco header/footer proprio.
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'testo', config: { title: 'Solo contenuto', body: 'x' } }] }),
    });
    const html1 = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html1.includes('Header Condiviso') && html1.includes('Footer Condiviso'), 'il Tema condiviso deve comparire anche su una pagina che non definisce il proprio header/footer');

    // Stessa pagina, ma con un blocco header INLINE ancora presente (residuo).
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'header', config: { site_name: 'Inline Residuo' } }, { type: 'testo', config: { title: 'x', body: 'y' } }] }),
    });
    const html2 = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html2.includes('Header Condiviso') && !html2.includes('Inline Residuo'), 'il Tema condiviso ha sempre la priorità, l\'header inline residuo va ignorato, mai reso due volte');
    assertTrue((html2.match(/<header/g) || []).length === 1, 'un solo tag <header> renderizzato, mai due');

    // Pulizia per non influenzare i test successivi.
    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ header: null, footer: null }) });
  });

  await test('Theme Builder: la migrazione volontaria "adotta da questa pagina" copia il blocco nel Tema e lo rimuove da OGNI pagina, non solo da quella di partenza', async () => {
    const secondPageRes = await fetch(BASE + '/api/site-pages', { method: 'POST', headers: auth, body: JSON.stringify({ slug: 'seconda', title: 'Seconda' }) });
    const secondPage = await secondPageRes.json();
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'header', config: { site_name: 'Header da migrare' } }, { type: 'testo', config: { title: 'x', body: 'y' } }] }),
    });
    await fetch(BASE + '/api/site-pages/' + secondPage.id, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'header', config: { site_name: 'Header vecchio sulla seconda pagina' } }] }),
    });
    const adoptRes = await fetch(BASE + '/api/site-pages/theme/adopt-from/' + pageId, {
      method: 'POST', headers: auth, body: JSON.stringify({ kind: 'header' }),
    });
    assertEq(adoptRes.status, 200);
    const theme = await (await fetch(BASE + '/api/site-pages/theme', { headers: auth })).json();
    assertEq(theme.header.config.site_name, 'Header da migrare', 'il Tema deve avere il config del blocco della pagina di partenza');

    const page1 = await (await fetch(BASE + '/api/site-pages/' + pageId, { headers: auth })).json();
    assertTrue(!page1.blocks_json.some((b) => b.type === 'header'), 'il blocco header inline deve essere stato rimosso dalla pagina di partenza');
    const page2 = await (await fetch(BASE + '/api/site-pages/' + secondPage.id, { headers: auth })).json();
    assertTrue(!page2.blocks_json.some((b) => b.type === 'header'), 'il blocco header inline deve essere stato rimosso ANCHE dalla seconda pagina, non solo da quella di partenza');

    // Pulizia.
    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ header: null, footer: null }) });
    await fetch(BASE + '/api/site-pages/' + secondPage.id, { method: 'DELETE', headers: auth });
  });

  await test('Theme Builder: adottare un kind senza quel blocco nella pagina scelta restituisce 404, non un\'adozione silenziosa di niente', async () => {
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ blocks_json: [{ type: 'testo', config: { title: 'x', body: 'y' } }] }),
    });
    const res = await fetch(BASE + '/api/site-pages/theme/adopt-from/' + pageId, {
      method: 'POST', headers: auth, body: JSON.stringify({ kind: 'footer' }),
    });
    assertEq(res.status, 404, 'una pagina senza blocco footer non può "adottarlo" verso il Tema');
  });

  await test('Design-token globali ("abbiamo Divi?" — fase 1): senza token configurati nessun output CSS in più; con token configurati, :root compare nel vero <head> e un blocco può riferirli con var(--sw-X)', async () => {
    const noTokenHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!noTokenHtml.includes(':root{--sw-'), 'senza token configurati non deve comparire nessuna variabile CSS in più');

    const badRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ design_tokens: { colore_a_caso: '#fff' } }),
    });
    assertEq(badRes.status, 400, 'una chiave non tra i 4 ruoli fissi deve essere rifiutata');

    const okRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ design_tokens: { primary: '#2563EB', secondary: '#f59e0b' } }),
    });
    assertEq(okRes.status, 200);
    const okBody = await okRes.json();
    assertEq(okBody.design_tokens.primary, '#2563EB');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'testo', config: { title: 'x', body: 'y' }, style_overrides: { background: 'var(--sw-primary)' } }] }),
    });
    const html = await (await fetch(BASE + '/negozio/home')).text();
    const headEnd = html.indexOf('</head>');
    const rootPos = html.indexOf(':root{--sw-primary:#2563EB;--sw-secondary:#f59e0b}');
    assertTrue(rootPos > -1 && rootPos < headEnd, 'le variabili CSS devono comparire nel vero <head>, con i valori reali configurati');
    assertTrue(html.includes('style="background:var(--sw-primary)"'), 'un blocco deve poter riferire il token invece di un hex letterale, lo stesso campo stringa di sempre');

    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ design_tokens: null }) });
  });

  await test('Content-binding dinamico ("abbiamo Divi?" — fase 2, "un valore di un modulo in QUALSIASI campo di testo"): un token {{bind:...}} in un campo qualunque viene sostituito col dato reale e corrente', async () => {
    db.prepare('INSERT INTO records (module_slug, data, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('anagrafica_bind_test', JSON.stringify({ telefono: '02 1234567', indirizzo: 'Via Roma 1' }));
    const recordId = db.prepare("SELECT id FROM records WHERE module_slug = 'anagrafica_bind_test'").get().id;

    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', config: { title: 'Chiamaci al {{bind:anagrafica_bind_test:' + recordId + ':telefono}}', body: 'Ci trovi in {{bind:anagrafica_bind_test:' + recordId + ':indirizzo}}.' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('Chiamaci al 02 1234567'), 'il token nel titolo deve essere sostituito col valore reale e corrente del record');
    assertTrue(html.includes('Ci trovi in Via Roma 1.'), 'stesso meccanismo per un secondo token in un campo diverso dello stesso blocco');
    assertTrue(!html.includes('{{bind:'), 'nessun token grezzo deve mai comparire sulla pagina pubblica vera');

    // Il valore VERO, non una copia statica: cambiare il record cambia la pagina.
    db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify({ telefono: '02 7654321', indirizzo: 'Via Roma 1' }), recordId);
    const html2 = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html2.includes('Chiamaci al 02 7654321'), 'il token deve leggere il valore CORRENTE ad ogni rendering, mai una copia congelata al momento del salvataggio');
  });

  await test('Content-binding dinamico: un token che punta a un record o campo inesistente mostra un segnaposto visibile, mai un vuoto silenzioso', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'Valore: {{bind:modulo_inesistente:999999:campo}}' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('⚠ dato mancante'), 'un record inesistente deve mostrare un segnaposto visibile, mai sparire silenziosamente (nasconderebbe un problema reale)');
  });

  await test('Formattazione di testo ("abbiamo Divi?" — fase 3): grassetto/corsivo/link riconosciuti, resto sempre testo sanificato', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: {
          title: 'x',
          body: 'Testo <strong>grassetto</strong> e <em>corsivo</em>, un <a href="https://example.it">link</a>, anche <b>b</b> e <i>i</i> vecchio stile.',
        } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('<strong>grassetto</strong>'), 'il grassetto va riconosciuto');
    assertTrue(body.html.includes('<em>corsivo</em>'), 'il corsivo va riconosciuto');
    assertTrue(body.html.includes('<a href="https://example.it" target="_blank" rel="noopener noreferrer">link</a>'), 'il link va riconosciuto e reso sicuro (target/rel)');
    assertTrue(body.html.includes('<strong>b</strong>') && body.html.includes('<em>i</em>'), '<b>/<i> vecchio stile vanno normalizzati a <strong>/<em>');
  });

  await test('Formattazione di testo: un tag non in whitelist (es. <script>) finisce come testo letterale, mai eseguito', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'Prova <script>alert(1)</script> fine.' } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(!body.html.includes('<script>alert(1)</script>'), 'uno script scritto a mano nel campo non deve mai comparire come tag eseguibile');
    assertTrue(body.html.includes('&lt;script&gt;'), 'deve comparire come testo letterale escapato');
  });

  await test('Formattazione di testo: un href con schema non permesso (es. javascript:) ricade su "#"', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'Un <a href="javascript:alert(1)">link cattivo</a> qui.' } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(!body.html.includes('javascript:'), 'lo schema javascript: non deve mai comparire nell\'output');
    assertTrue(body.html.includes('<a href="#" target="_blank" rel="noopener noreferrer">link cattivo</a>'), 'uno schema non permesso ricade su "#", mai un link rotto o pericoloso');
  });

  await test('Formattazione di testo: il content-binding funziona anche dentro un campo rich (eredita gratis da escapeHtml)', async () => {
    db.prepare('INSERT INTO records (module_slug, data, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('anagrafica_bind_rich_test', JSON.stringify({ nome: 'Mario Rossi' }));
    const recordId = db.prepare("SELECT id FROM records WHERE module_slug = 'anagrafica_bind_rich_test'").get().id;
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: { title: 'x', body: `Cliente: <strong>{{bind:anagrafica_bind_rich_test:${recordId}:nome}}</strong>` } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('<strong>Mario Rossi</strong>'), 'il token di binding dentro un tag riconosciuto deve risolversi al dato reale, non restare letterale');
  });

  await test('Formattazione di testo: il toggle IT/EN su un campo rich usa innerHTML (data-i18n-rich), non più la ricostruzione a paragrafi testuali', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'x',
        blocks_json: [{ type: 'testo', config: { title: 'x', body: 'Testo <strong>forte</strong>.', body_en: 'Bold <strong>text</strong>.' } }],
      }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('data-i18n-rich="1"'), 'un body con formattazione deve essere marcato rich per lo swap via innerHTML');
    assertTrue(body.html.includes('<p>Testo <strong>forte</strong>.</p>'), 'il markup IT va preservato dentro il <p> reale in pagina');
    assertTrue(body.html.includes('data-i18n-en="<p>Bold <strong>text</strong>.</p>"'), 'la versione EN deve portare lo stesso markup sanificato, non testo semplice');
    assertTrue(body.html.includes("el.dataset.i18nRich"), 'lo script di swap deve controllare il flag rich per usare innerHTML invece di textContent');
  });

  await test('Multi-selezione di blocchi ("abbiamo Divi?" — fase 4): il pulsante "seleziona" propaga Ctrl/Cmd+click al genitore', async () => {
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const body = await previewRes.json();
    assertEq(previewRes.status, 200);
    assertTrue(body.html.includes('Ctrl/Cmd+click per selezionarne più di uno'), 'il titolo del pulsante deve suggerire la selezione multipla, altrimenti resta scoperta');
    assertTrue(body.html.includes('multi: !!(e.ctrlKey || e.metaKey)'), 'il click sulla toolbar deve propagare lo stato di Ctrl/Cmd al genitore, non solo azione e indice');
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 1: scroll-progress bar, spenta di default, opt-in di Tema', async () => {
    const offHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!offHtml.includes('<div class="s-scroll-progress"'), 'senza averla attivata nel Tema non deve comparire nessuna barra');
    assertTrue(!offHtml.includes("getElementById('s-scroll-progress')"), 'senza averla attivata non deve nemmeno essere iniettato lo script');

    const patchRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ scroll_progress: true }),
    });
    assertEq(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assertEq(patchBody.scroll_progress, true, 'il Tema deve riflettere il valore appena salvato');

    const onHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(onHtml.includes('<div class="s-scroll-progress" id="s-scroll-progress"></div>'), 'attivata nel Tema, la barra deve comparire sulla pagina pubblica vera');
    assertTrue(onHtml.includes("getElementById('s-scroll-progress')"), 'lo script che aggiorna la barra deve essere presente');

    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const previewBody = await previewRes.json();
    assertTrue(!previewBody.html.includes('<div class="s-scroll-progress"'), 'mai in anteprima/editing, anche col Tema attivo — l\'iframe ricarica spesso, sarebbe solo rumore');

    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ scroll_progress: false }) });
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 2: header trasparente-poi-opaco sull\'hero, opt-in per blocco', async () => {
    const offRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'header', config: { site_name: 'X' } }, { type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const offBody = await offRes.json();
    assertTrue(!/<header class="[^"]*s-header-overlay[^"]*"/.test(offBody.html), 'senza il flag, comportamento identico a sempre (nessuna classe overlay sull\'header — il CSS della classe resta comunque sempre nel foglio di stile condiviso, stesso principio di scroll_progress)');
    assertTrue(!offBody.html.includes("querySelector('.s-header-overlay')"), 'senza nessun header overlay in pagina, lo script non deve nemmeno essere iniettato');

    const onRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'header', config: { site_name: 'X', overlay_su_hero: true } }, { type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const onBody = await onRes.json();
    assertTrue(onBody.html.includes('class="s-header s-header-overlay"'), 'col flag attivo la classe overlay deve comparire sull\'header');
    assertTrue(!onBody.html.includes("querySelector('.s-header-overlay')"), 'mai in anteprima/editing, stesso principio di scroll-progress — l\'iframe non ha motivo di "sbloccare" lo sfondo mentre si edita');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'header', config: { site_name: 'X', overlay_su_hero: true } }, { type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const pubHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(pubHtml.includes('class="s-header s-header-overlay"'), 'sulla pagina pubblica vera la classe overlay deve comparire');
    assertTrue(pubHtml.includes("querySelector('.s-header-overlay')"), 'sulla pagina pubblica vera lo script che aggiunge/rimuove s-header-scrolled deve essere presente');
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 3: hero Ken Burns, opt-in e solo con una foto impostata', async () => {
    const noImgRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', ken_burns: true } }] }),
    });
    const noImgBody = await noImgRes.json();
    assertTrue(!/<section class="[^"]*s-hero-kenburns[^"]*"/.test(noImgBody.html), 'senza una foto impostata, il flag non deve avere alcun effetto (niente da animare) — il CSS della classe resta comunque sempre nel foglio di stile condiviso');

    const offRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', image_url: 'https://x/y.jpg' } }] }),
    });
    const offBody = await offRes.json();
    assertTrue(!/<section class="[^"]*s-hero-kenburns[^"]*"/.test(offBody.html), 'con foto ma senza il flag, comportamento identico a sempre');

    const onRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', image_url: 'https://x/y.jpg', ken_burns: true } }] }),
    });
    const onBody = await onRes.json();
    assertTrue(onBody.html.includes('s-hero-photo') && onBody.html.includes('s-hero-kenburns'), 'con foto e flag attivo, la classe kenburns deve comparire insieme a s-hero-photo');
  });

  await test('blocco "configuratore" ("il pezzo più grande", confronto 1:1 col mockup — fase 4): senza step O senza esiti il blocco non compare, nemmeno in editing (stesso comportamento di renderForm con fields=[])', async () => {
    const noStepsRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'configuratore', config: { title: 'Quiz', steps: [], esiti: [{ key: 'Uno', nome: 'Uno' }] } }] }),
    });
    const noStepsBody = await noStepsRes.json();
    assertTrue(!/<section class="s-configuratore"/.test(noStepsBody.html), 'senza step, il blocco resta invisibile anche con esiti configurati (il CSS della classe resta comunque sempre nel foglio di stile condiviso)');

    const noEsitiRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'configuratore', config: { title: 'Quiz', steps: [{ question: 'Domanda?', options: [{ label: 'Opzione', scores: { Uno: 1 } }] }], esiti: [] } }] }),
    });
    const noEsitiBody = await noEsitiRes.json();
    assertTrue(!/<section class="s-configuratore"/.test(noEsitiBody.html), 'senza esiti, il blocco resta invisibile anche con step configurati');
  });

  await test('blocco "configuratore": con step ed esiti configurati, il markup porta domande/opzioni/punteggi/esiti reali (SEO — non generati solo da JS), e lo script è incluso solo quando serve', async () => {
    const blocks_json = [{
      type: 'configuratore',
      config: {
        title: 'Trova la tua miscela', eyebrow: 'Quiz',
        esiti: [
          { key: 'Perfezione', nome: 'Perfezione', descrizione: 'Equilibrata', immagine: 'https://x/p.jpg', cta_label: 'Scopri', cta_target: '#miscele' },
          { key: 'Capolavoro', nome: 'Capolavoro', descrizione: 'Intensa' },
        ],
        steps: [
          { question: 'Che corpo preferite?', options: [
            { label: 'Leggero', scores: { Perfezione: 2 } },
            { label: 'Intenso', scores: { Capolavoro: 2 } },
          ] },
          { question: 'Che note cercate?', options: [
            { label: 'Dolci', scores: { Perfezione: 1 } },
          ] },
        ],
      },
    }];
    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', blocks_json }),
    });
    const html = (await previewRes.json()).html;
    assertTrue(html.includes('class="s-configuratore"'), 'la sezione del blocco deve comparire');
    assertTrue(html.includes('<h4>Che corpo preferite?</h4>'), 'il testo della prima domanda deve comparire come vero contenuto HTML (SEO), non generato solo da JS');
    assertTrue(html.includes('<h4>Che note cercate?</h4>'), 'la seconda domanda deve comparire già nel markup, non solo dopo un click');
    assertTrue(/data-step="2"[^>]*hidden/.test(html), 'lo step successivo al primo deve partire nascosto (hidden), mostrato solo dal click');
    assertTrue(html.includes('data-scores="{&quot;Perfezione&quot;:2}"'), 'i punteggi di un\'opzione devono essere nel markup come JSON, leggibile dallo script client');
    assertTrue(html.includes('&quot;key&quot;:&quot;Perfezione&quot;') && html.includes('&quot;immagine&quot;:&quot;https://x/p.jpg&quot;'), 'i dati reali di un esito (incluso il collegamento a un\'immagine vera) devono essere nel blob JSON del box, non inventati lato client');
    assertTrue(html.includes('<span class="s-config-dot s-config-dot-active" data-dot="1">') && html.includes('data-dot="2">'), 'i pallini di avanzamento devono essere tanti quanti gli step, il primo attivo');
    assertTrue(html.includes("JSON.parse(box.dataset.sConfigEsiti"), 'lo script del configuratore deve essere incluso quando la pagina ha davvero questo blocco');

    const noConfigRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const noConfigHtml = (await noConfigRes.json()).html;
    assertTrue(!noConfigHtml.includes("JSON.parse(box.dataset.sConfigEsiti"), 'senza nessun blocco configuratore in pagina, lo script non deve nemmeno essere iniettato');
  });

  await test('blocco "configuratore": IT/EN su domanda e opzione, stesso meccanismo data-i18n-en già in uso ovunque nel motore', async () => {
    const blocks_json = [{
      type: 'configuratore',
      config: {
        title: 'Quiz',
        esiti: [{ key: 'Uno', nome: 'Uno' }],
        steps: [{ question: 'Domanda?', question_en: 'Question?', options: [{ label: 'Opzione', label_en: 'Option', scores: { Uno: 1 } }] }],
      },
    }];
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', blocks_json }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('data-i18n-en="Question?"'), 'la domanda deve portare la traduzione EN come attributo, riletto dallo script i18n condiviso');
    assertTrue(html.includes('data-i18n-en="Option"'), 'anche l\'opzione deve portare la propria traduzione EN');
  });

  await test('blocco "ticker" (confronto 1:1 col mockup — fase 5): striscia puramente CSS (nessuno script), testi duplicati per il loop senza soluzione di continuità, invisibile senza testi', async () => {
    const emptyRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'ticker', config: { items: [] } }] }),
    });
    const emptyHtml = (await emptyRes.json()).html;
    assertTrue(!/<div class="s-ticker"/.test(emptyHtml), 'senza testi configurati, il blocco resta invisibile (il CSS della classe resta comunque sempre nel foglio di stile condiviso)');

    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'ticker', config: { items: ['Perfezione Artigianale', 'Capolavoro del Tostatore'] } }] }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('class="s-ticker"'), 'con testi configurati, la striscia deve comparire');
    const occurrences = html.split('<span>Perfezione Artigianale</span>').length - 1;
    assertEq(occurrences, 2, 'ogni testo deve essere duplicato UNA volta esatta (loop CSS al 50%, mai una sola copia che lascerebbe un vuoto visibile a fine giro)');
    assertTrue(html.includes('s-ticker-dot'), 'i testi devono essere separati da un separatore visivo, come nel mockup');
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 5: scroll-spy nav, attivo solo se l\'header ha un link "#ancora" reale, mai in anteprima', async () => {
    const noSpyRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Esterno', url: 'https://altrosito.it' }] } }] }),
    });
    const noSpyHtml = (await noSpyRes.json()).html;
    assertTrue(!noSpyHtml.includes("getAttribute('href').slice(1)"), 'senza nessun link che comincia per "#", lo script di scroll-spy non deve nemmeno essere iniettato (un link esterno non è un\'ancora di pagina)');

    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Chi siamo', url: '#chi-siamo' }] } }] }),
    });
    const previewHtml = (await previewRes.json()).html;
    assertTrue(!previewHtml.includes("getAttribute('href').slice(1)"), 'mai in anteprima/editing — stesso principio già seguito per scroll-progress/header overlay/reveal');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'header', config: { site_name: 'X', nav_links: [{ label: 'Chi siamo', url: '#chi-siamo' }] } },
          { type: 'testo', config: { title: 'Chi siamo', body: 'Testo' }, anchor_id: 'chi-siamo' },
        ],
      }),
    });
    const pubHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(pubHtml.includes("getAttribute('href').slice(1)"), 'sulla pagina pubblica vera, con un link "#" reale nell\'header, lo script di scroll-spy deve essere incluso');
    assertTrue(pubHtml.includes('id="chi-siamo"'), 'il blocco di destinazione deve portare davvero l\'id puntato dal link (anchor_id, già esistente per ogni blocco)');
    // 2026-09-06, bug reale segnalato dall'utente ("vedi il menu che
    // evidenzia la voce sbagliata?"): tornando in cima alla pagina dopo
    // aver superato una sezione, il link restava evidenziato perché lo
    // script toglieva 's-nav-active' solo quando un'ALTRA sezione
    // diventava attiva, mai quando si usciva da TUTTE (nessuna
    // intersecante). La correzione traccia un elenco di sezioni
    // correntemente intersecanti e lo aggiorna sia in entrata che in
    // uscita — verifichiamo che il ramo "solo entrata" (bug) sia sparito.
    assertTrue(!pubHtml.includes('if (!entry.isIntersecting) return;'), 'lo script di scroll-spy non deve più ignorare gli eventi di USCITA da una sezione (bug: la voce di nav restava evidenziata anche tornando in cima alla pagina)');
    assertTrue(pubHtml.includes('active.splice(i, 1)'), 'lo script di scroll-spy deve rimuovere una sezione dall\'elenco delle attive quando la si lascia, non solo aggiungerla quando la si raggiunge');
  });

  await test('blocco "statistiche" (confronto 1:1 col mockup — fase 6): il numero VERO è sempre nel markup (mai "0" — SEO/no-JS), lo script lo anima solo quando serve', async () => {
    const emptyRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'statistiche', config: { items: [] } }] }),
    });
    const emptyHtml = (await emptyRes.json()).html;
    assertTrue(!emptyHtml.includes('class="s-statistiche"'), 'senza numeri configurati, il blocco resta invisibile');

    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'statistiche', config: { items: [
        { valore: 100, suffisso: '%', etichetta: 'Materie prime tracciate', etichetta_en: 'Traced raw materials' },
        { valore: 3, etichetta: 'Miscele su misura' },
      ] } }] }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('data-counter-target="100"') && html.includes('data-counter-suffix="%"'), 'il target e il suffisso reali devono essere nel markup, letti dallo script client');
    assertTrue(html.includes('>100%</b>'), 'il testo VISIBILE deve essere già il valore vero, non "0" — un crawler o un browser senza JS non deve vedere un numero finto');
    assertTrue(html.includes('>3</b>'), 'un numero senza suffisso resta un numero nudo, nessun "undefined" aggiunto');
    assertTrue(html.includes('Materie prime tracciate'), 'l\'etichetta reale deve comparire');
    assertTrue(!html.includes("querySelectorAll('.s-stat-value[data-counter-target]')"), 'mai in anteprima/editing — stesso principio già seguito per scroll-progress/header overlay/scroll-spy');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'statistiche', config: { items: [{ valore: 100, suffisso: '%', etichetta: 'Materie prime tracciate' }] } }],
      }),
    });
    const pubHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(pubHtml.includes("querySelectorAll('.s-stat-value[data-counter-target]')"), 'sulla pagina pubblica vera, con un blocco statistiche in pagina, lo script dei contatori deve essere incluso');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const noStatHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!noStatHtml.includes("querySelectorAll('.s-stat-value[data-counter-target]')"), 'senza nessun blocco statistiche in pagina, lo script non deve nemmeno essere iniettato');
  });

  await test('blocco "statistiche": IT/EN sull\'etichetta, stesso meccanismo data-i18n-en già in uso ovunque nel motore', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'statistiche', config: { items: [{ valore: 100, suffisso: '%', etichetta: 'Materie prime tracciate', etichetta_en: 'Traced raw materials' }] } }] }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('data-i18n-en="Traced raw materials"'), 'l\'etichetta deve portare la traduzione EN come attributo, riletto dallo script i18n condiviso');
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 7: parallax leggero su scroll, opt-in e solo con una foto impostata, mai in anteprima', async () => {
    const noImgRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', parallax: true } }] }),
    });
    const noImgHtml = (await noImgRes.json()).html;
    assertTrue(!noImgHtml.includes('s-hero-parallax'), 'senza una foto impostata, il flag non deve avere alcun effetto (niente da spostare)');

    const offRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', image_url: 'https://x/y.jpg' } }] }),
    });
    const offHtml = (await offRes.json()).html;
    assertTrue(!offHtml.includes('s-hero-parallax'), 'con foto ma senza il flag, comportamento identico a sempre');

    const previewOnRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', image_url: 'https://x/y.jpg', parallax: true } }] }),
    });
    const previewOnHtml = (await previewOnRes.json()).html;
    assertTrue(previewOnHtml.includes('s-hero-parallax'), 'con foto e flag attivo, la classe deve comparire sulla section anche in anteprima');
    assertTrue(!previewOnHtml.includes('backgroundPositionY'), 'mai in anteprima/editing — stesso principio già seguito per scroll-progress/header overlay/scroll-spy/contatori');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [
          { type: 'hero', config: { headline: 'Uno', image_url: 'https://x/y.jpg', parallax: true } },
          { type: 'immagine', config: { image_url: 'https://x/z.jpg', parallax: true } },
        ],
      }),
    });
    const pubHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(pubHtml.includes('backgroundPositionY'), 'sulla pagina pubblica vera, lo script del parallax deve essere incluso');
    assertTrue(pubHtml.includes('class="s-immagine-parallax"'), 'il blocco immagine con parallax attivo deve portare la sua classe sull\'<img>, indipendente dall\'hero');
  });

  await test('Confronto 1:1 col mockup di riferimento — fase 8 (ultima): effetti hover desktop-only, spenti di default, opt-in di Tema, mai in anteprima', async () => {
    const offHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!offHtml.includes("matchMedia('(hover: hover) and (pointer: fine)')"), 'senza averli attivati nel Tema, lo script degli effetti hover non deve nemmeno essere iniettato');

    const patchRes = await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ hover_effects: true }),
    });
    assertEq(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assertEq(patchBody.hover_effects, true, 'il Tema deve riflettere il valore appena salvato');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'hero', config: { headline: 'Uno' }, dark: true }] }),
    });
    const onHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(onHtml.includes("matchMedia('(hover: hover) and (pointer: fine)')"), 'attivati nel Tema, lo script deve comparire sulla pagina pubblica vera, col check esplicito su mouse fine PRIMA di agganciare qualunque listener');
    assertTrue(onHtml.includes("querySelectorAll('.s-dark')") && onHtml.includes("querySelectorAll('.s-prodotto')") && onHtml.includes("querySelectorAll('.s-btn')"), 'i tre effetti (spotlight/tilt/magnetico) devono essere tutti presenti nello stesso script');

    const previewRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno' } }] }),
    });
    const previewBody = await previewRes.json();
    assertTrue(!previewBody.html.includes("matchMedia('(hover: hover) and (pointer: fine)')"), 'mai in anteprima/editing, anche col Tema attivo — nessun cursore reale con cui questi effetti abbiano senso lì');

    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ hover_effects: false }) });
  });

  await test('blocco con occhiello: swoosh decorativo spento di default (nessun <span> in più, output identico a sempre), opt-in di Tema, funziona anche in anteprima', async () => {
    const offRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', eyebrow: 'Occhiello' } }] }),
    });
    const offHtml = (await offRes.json()).html;
    assertTrue(offHtml.includes('<span class="s-eyebrow"'), 'l\'eyebrow deve comunque comparire');
    assertTrue(!offHtml.includes('<span class="s-eyebrow-wrap">') && !offHtml.includes('<svg class="s-swoosh"'), 'senza il Tema attivo, nessun wrapper o SVG in più — output identico a sempre per chi non usa la funzionalità (il CSS delle classi resta comunque sempre nel foglio di stile condiviso, stesso principio di scroll_progress)');

    await fetch(BASE + '/api/site-pages/theme', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ eyebrow_swoosh: true }),
    });
    const onRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'hero', config: { headline: 'Uno', eyebrow: 'Occhiello' } }] }),
    });
    const onHtml = (await onRes.json()).html;
    assertTrue(onHtml.includes('s-eyebrow-wrap') && onHtml.includes('class="s-swoosh"'), 'col Tema attivo, l\'eyebrow deve essere avvolto e seguito dallo swoosh SVG');
    assertTrue(onHtml.includes('<span class="s-eyebrow"'), 'lo span originale dell\'eyebrow non deve sparire, solo essere avvolto');

    await fetch(BASE + '/api/site-pages/theme', { method: 'PATCH', headers: auth, body: JSON.stringify({ eyebrow_swoosh: false }) });
  });

  await test('blocco "timeline": bookend iniziale/finale (confronto 1:1 col mockup — trovato solo confrontando il contenuto vero riga per riga), invisibili senza foto', async () => {
    const noBookendRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'timeline', config: { steps: [{ titolo: 'Uno', testo: 'Testo' }] } }] }),
    });
    const noBookendHtml = (await noBookendRes.json()).html;
    assertTrue(!noBookendHtml.includes('<div class="s-timeline-bookend">'), 'senza foto configurata, nessun cerchio vuoto');

    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'timeline', config: {
        steps: [{ titolo: 'Uno', testo: 'Testo' }],
        bookend_start: { immagine: 'https://x/start.jpg', testo: 'Il chicco, all\'origine' },
        bookend_end: { immagine: 'https://x/end.jpg', testo: 'La tazzina, dal cliente' },
      } }] }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('src="https://x/start.jpg"') && html.includes('Il chicco, all\'origine'), 'il bookend iniziale deve comparire con foto e didascalia vere');
    assertTrue(html.includes('src="https://x/end.jpg"') && html.includes('La tazzina, dal cliente'), 'il bookend finale deve comparire con foto e didascalia vere');
    assertTrue(html.indexOf('start.jpg') < html.indexOf('<div class="s-timeline-track">') && html.indexOf('<div class="s-timeline-track">') < html.indexOf('end.jpg'), 'il bookend iniziale deve stare PRIMA della traccia, quello finale DOPO');
  });

  await test('blocco "cta": gold_bg (confronto 1:1 col mockup — il CTA finale ha uno sfondo a gradiente oro unico, non il solito scuro/chiaro binario) usa il gradiente derivato dall\'accent color', async () => {
    const offRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'cta', dark: true, config: { title: 'Uno' } }] }),
    });
    const offHtml = (await offRes.json()).html;
    assertTrue(offHtml.includes('class="s-cta s-dark'), 'senza gold_bg, comportamento identico a sempre (classe scura normale)');
    assertTrue(!/<section class="[^"]*s-cta-gold/.test(offHtml), 'senza gold_bg, mai la classe gold sulla sezione (il CSS resta comunque nel foglio di stile condiviso, stesso principio di scroll_progress/overlay_su_hero)');

    const onRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'cta', dark: true, config: { title: 'Uno', gold_bg: true } }] }),
    });
    const onHtml = (await onRes.json()).html;
    assertTrue(onHtml.includes('class="s-cta s-cta-gold"'), 'con gold_bg, la sezione deve avere la classe gold, mai quella scura anche se il blocco ha ancora dark:true');
    assertTrue(onHtml.includes('.s-cta-gold::before{') && onHtml.includes('background:var(--s-accent-grad)'), 'il CSS deve definire il bleed a piena pagina col gradiente derivato dall\'accent color, non un colore fisso');
  });

  await test('blocco "cta" gold_bg seguito da un "form": l\'oro continua sotto, niente stacco netto sul crema di pagina (confronto 1:1 col mockup — lì è un blocco unico)', async () => {
    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [
        { type: 'cta', config: { title: 'Uno', gold_bg: true } },
        { type: 'form', config: { fields: [{ key: 'nome', label: 'Nome', type: 'text' }] } },
      ] }),
    });
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('.s-cta-gold + .s-form{') && html.includes('.s-cta-gold + .s-form::before{'), 'il CSS deve continuare lo sfondo oro sul form immediatamente successivo a un cta gold_bg');
    const ctaIdx = html.indexOf('s-cta s-cta-gold');
    const formIdx = html.lastIndexOf('s-form"');
    assertTrue(ctaIdx !== -1 && formIdx !== -1, 'entrambe le sezioni devono comparire sulla pagina pubblica vera');
    const ctaCloseIdx = html.indexOf('</section>', ctaIdx) + '</section>'.length;
    const formSectionStart = html.lastIndexOf('<section', formIdx);
    const between = html.slice(ctaCloseIdx, formSectionStart);
    assertTrue(!between.includes('<section'), 'sulla pagina pubblica vera il form deve essere il fratello DIRETTO del cta nell\'HTML, non separato da altre sezioni in mezzo (altrimenti il selettore CSS adiacente non lo aggancia)');
  });

  await test('blocco "form": width:\'half\' accoppia due campi corti in una riga (confronto 1:1 col mockup — segnalato dall\'utente: "due colonne, due cazzo di colonne")', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{
          type: 'form',
          config: { title: 'x', fields: [
            { key: 'nome', label: 'Nome', type: 'text', width: 'half' },
            { key: 'attivita', label: 'Attività', type: 'text', required: false, width: 'half' },
            { key: 'email', label: 'Email', type: 'email', width: 'half' },
            { key: 'telefono', label: 'Telefono', type: 'text', required: false, width: 'half' },
            { key: 'messaggio', label: 'Messaggio', type: 'textarea' },
          ] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    const rows = html.match(/<div class="s-form-row">.*?<\/div>/gs) || [];
    assertTrue(rows.length === 2, 'due campi \'half\' consecutivi vanno accoppiati in una riga condivisa: due coppie qui, quindi due righe');
    assertTrue(rows[0].includes('name="nome"') && rows[0].includes('name="attivita"'), 'la prima riga deve contenere esattamente nome e attività, nell\'ordine dichiarato');
    assertTrue(rows[1].includes('name="email"') && rows[1].includes('name="telefono"'), 'la seconda riga deve contenere esattamente email e telefono');
    const afterRows = html.slice(html.lastIndexOf('name="telefono"'));
    assertTrue(!afterRows.slice(0, afterRows.indexOf('name="messaggio"')).includes('s-form-row'), 'il campo "messaggio" (senza width:half) resta a piena larghezza, fuori da qualunque riga accoppiata');
  });

  await test('blocco "form": un campo width:\'half\' spaiato (l\'ultimo, dispari) resta a piena larghezza, mai una colonna vuota accanto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{
          type: 'form',
          config: { title: 'x', fields: [
            { key: 'nome', label: 'Nome', type: 'text', width: 'half' },
          ] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!html.includes('<div class="s-form-row">'), 'un solo campo half senza un altro half accanto non deve mai finire in una riga a due colonne (metà vuota)');
    assertTrue(html.includes('<input type="text" name="nome" required/>'), 'il campo deve comunque comparire, a piena larghezza');
  });

  await test('blocco "testo": stats inline (confronto 1:1 col mockup — segnalato dall\'utente: "va sotto tazzina"): i contatori stanno dentro la stessa colonna di testo, non in un blocco separato sotto', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{
          type: 'testo', config: {
            title: 'x', body: 'tazzina dopo tazzina.', image_url: 'https://example.com/mission.jpg',
            stats: [{ valore: 100, suffisso: '%', etichetta: 'Materie prime tracciate' }],
          },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    const colIdx = html.indexOf('class="s-testo-col"');
    const statsIdx = html.indexOf('class="s-statistiche s-statistiche-inline"', colIdx);
    const photoIdx = html.indexOf('<img class="s-testo-photo"');
    assertTrue(colIdx !== -1 && statsIdx !== -1 && photoIdx !== -1 && colIdx < statsIdx && statsIdx < photoIdx, 'i contatori devono stare DENTRO .s-testo-col (prima della foto, che è fuori dalla colonna), non dopo in una sezione a parte');
    assertTrue(html.includes('>100%</b>'), 'il valore vero deve essere nel markup');
    assertTrue(html.includes("querySelectorAll('.s-stat-value[data-counter-target]')"), 'lo script contatori va incluso anche quando le statistiche vivono dentro un blocco testo, non solo dentro un blocco statistiche a sé');
  });

  await test('blocco "griglia_prodotti": dettagli/nota per card (confronto 1:1 col mockup — "nell\'artifact sono box diversi"), opzionali e generici', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{
          type: 'griglia_prodotti', config: { title: 'x', items: [
            { nome: 'Perfezione', categoria: 'Artigianalmente Espresso', dettagli: 'Brasile · Perù', descrizione: 'Equilibrio classico.', nota: 'Macinatura su richiesta', immagine: 'https://example.com/p.jpg' },
          ] },
        }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('<div class="s-prodotto-dettagli"') && html.includes('>Brasile · Perù<'), 'dettagli deve comparire come riga breve sotto il titolo, quando compilato');
    assertTrue(html.includes('<div class="s-prodotto-meta">') && html.includes('>Macinatura su richiesta<'), 'nota deve comparire nella riga in fondo alla card, quando compilata');
  });

  await test('blocco "griglia_prodotti": senza dettagli/nota, nessun elemento vuoto in più (comportamento identico a sempre per chi non li usa)', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'griglia_prodotti', config: { title: 'x', items: [{ nome: 'Caffè' }] } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!html.includes('<div class="s-prodotto-dettagli"') && !html.includes('<div class="s-prodotto-meta">'), 'senza dettagli/nota/prezzo configurati, nessun elemento vuoto deve comparire (il CSS resta comunque nel foglio di stile condiviso)');
  });

  await test('blocco "testo": titolo con <em> (confronto 1:1 col mockup — "vedi anche il titolo? va sistemato con dimensione e colore") prende il colore accento sulla parte in corsivo', async () => {
    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        published: true,
        blocks_json: [{ type: 'testo', config: { title: 'Il nostro obiettivo non è vendere caffè, ma\n<em>costruire un prodotto su misura.</em>', body: 'x' } }],
      }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('Il nostro obiettivo non è vendere caffè, ma<br><em>costruire un prodotto su misura.</em>'), 'il titolo deve portare sia il testo normale sia la parte in <em>, con \\n convertito in <br>');
    assertTrue(html.includes('.s-testo h2 em{') && html.includes('color:var(--s-accent)'), 'il CSS deve dare alla parte in <em> il colore accento, non lasciarla del colore normale del titolo');
  });

  await test('blocco "testo" vuoto (bug reale segnalato dall\'utente: "se aggiungo componenti nel live composer non si crea il nuovo blocco") mostra un placeholder SOLO in anteprima/editing, mai sulla pagina pubblica', async () => {
    // Indagine dal vivo: il blocco viene inserito correttamente (verificato
    // passo-passo nel canvas reale) — il problema era che un blocco "testo"
    // con titolo e corpo entrambi vuoti non ha ALCUN contenuto visibile
    // (niente <h2>, un <p></p> vuoto), sembrando un click a vuoto.
    const emptyRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'testo', config: {} }] }),
    });
    const emptyHtml = (await emptyRes.json()).html;
    assertTrue(emptyHtml.includes('class="s-empty-block-hint"'), 'un blocco testo senza titolo né corpo deve mostrare il placeholder in anteprima');

    const filledRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'testo', config: { body: 'Un corpo vero' } }] }),
    });
    const filledHtml = (await filledRes.json()).html;
    assertTrue(!filledHtml.includes('class="s-empty-block-hint"'), 'un blocco testo con del contenuto reale non deve mostrare il placeholder');

    await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'testo', config: {} }] }),
    });
    const publicHtml = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(!publicHtml.includes('s-empty-block-hint'), 'il placeholder non deve MAI comparire sulla pagina pubblica vera, nemmeno per un blocco lasciato vuoto per errore');
  });

  await test('blocco "timeline": riempimento oro allo scroll (confronto 1:1 col mockup — segnalato dall\'utente: "questo blocco ha una animazione nell\'artifact che non vedo")', async () => {
    const onRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'timeline', config: { steps: [{ titolo: 'Uno', testo: 'Testo' }] } }] }),
    });
    const onBody = await onRes.json();
    assertTrue(!onBody.html.includes('<div class="s-timeline-fill">'), 'mai in anteprima/editing — l\'iframe non scrolla mai abbastanza perché l\'animazione abbia senso, stesso principio di parallax/scroll-spy (il CSS resta comunque nel foglio di stile condiviso)');

    const patchRes = await fetch(BASE + '/api/site-pages/' + pageId, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ published: true, blocks_json: [{ type: 'timeline', config: { steps: [{ titolo: 'Uno', testo: 'Testo' }] } }] }),
    });
    assertEq(patchRes.status, 200);
    const html = await (await fetch(BASE + '/negozio/home')).text();
    assertTrue(html.includes('<div class="s-timeline-fill"></div>'), 'sulla pagina pubblica vera deve esserci l\'elemento reale da animare (un ::before non è raggiungibile da querySelector)');
    assertTrue(html.includes("querySelectorAll('.s-timeline-track')") && html.includes("fill.style.height"), 'lo script che anima il riempimento deve essere incluso quando la pagina ha un blocco timeline con passi');

    const noStepsRes = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'timeline', config: { steps: [] } }] }),
    });
    const noStepsHtml = (await noStepsRes.json()).html;
    assertTrue(!noStepsHtml.includes("querySelectorAll('.s-timeline-track')"), 'senza passi il blocco non compare affatto, lo script non deve essere iniettato');
  });

  await test('blocco "configuratore": la regola [hidden] deve vincere su display:flex (bug reale, segnalato dall\'utente con screenshot: "rifai il quiz" mostrava risultato e prima domanda insieme)', async () => {
    const res = await fetch(BASE + '/api/site-pages/preview', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', blocks_json: [{ type: 'configuratore', config: {
        steps: [{ domanda: 'Uno?', opzioni: [{ testo: 'A', punteggi: { x: 1 } }] }],
        esiti: [{ key: 'x', nome: 'X', descrizione: 'y' }],
      } }] }),
    });
    const html = (await res.json()).html;
    assertTrue(html.includes('.s-config-result{display:flex') && html.includes('.s-config-result[hidden]{display:none}'), 'display:flex da solo vince sempre su [hidden] (stessa origine/priorità dell\'autore): serve la regola [hidden] esplicita, altrimenti impostare hidden=true via JS non nasconde nulla');
  });

  console.log(`\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  if (failed) { console.log('Falliti: ' + failures.join(', ')); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('Errore fatale nella suite:', e); process.exit(1); });
