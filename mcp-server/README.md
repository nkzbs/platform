# Platform MCP server

Espone Platform (qualunque tenant: Finance o un altro) come strumenti MCP per un
client come Claude Code o Claude Desktop — stessa API reale dell'app, stessi
permessi dell'utente che ha creato il token. Nessuna logica duplicata: ogni
strumento chiama esattamente la stessa rotta che userebbe il browser.

## 1. Crea un token API

Nell'app Platform (es. `https://finance.platform-core.it`): **Impostazioni → Il
mio account → Token API → Crea un token**. Il valore (`plat_...`) viene mostrato
una volta sola — copialo subito.

## 2. Installa le dipendenze

```bash
cd mcp-server
npm install
```

## 3. Collega il client

**Claude Code** (nel repo, o in qualunque cartella):

```bash
claude mcp add platform --env PLATFORM_URL=https://finance.platform-core.it --env PLATFORM_API_TOKEN=plat_... -- node /percorso/assoluto/mcp-server/src/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "platform": {
      "command": "node",
      "args": ["/percorso/assoluto/mcp-server/src/index.js"],
      "env": {
        "PLATFORM_URL": "https://finance.platform-core.it",
        "PLATFORM_API_TOKEN": "plat_..."
      }
    }
  }
}
```

## Strumenti

- `elenco_moduli`, `schema_modulo` — scoprire cosa c'è prima di leggere/scrivere.
- `lista_record`, `leggi_record` — lettura.
- `crea_record`, `modifica_record` — scrittura vera (stessi permessi/validazioni/automazioni dell'app). Niente "elimina": stessa scelta del bot Telegram.
- `chiedi_ai_dati`, `report_busta_paga`, `debito_casa` — le stesse risposte già disponibili dal bot/dall'app, qui a chiamata diretta.

## Un token = un utente vero

Revocalo da Impostazioni → Il mio account quando non serve più — smette di
funzionare subito, non alla scadenza (non scade mai da solo). Vale quanto la
password di chi l'ha creato: non condividerlo, non committarlo.

## Test

```bash
npm test
```

Avvia un backend Platform reale (DB temporaneo), crea un token vero, lancia
questo stesso server come processo a parte e lo guida con un client MCP vero —
niente di simulato.
