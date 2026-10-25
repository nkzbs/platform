#!/usr/bin/env node
'use strict';
// Server MCP per Platform (stdio) — richiesto dall'utente il 25/10/2026: "un MCP
// per platform, ha senso?". Ogni strumento (tools.js) chiama l'API reale di
// Platform con il token personale di chi lo esegue (client.js): nessuna logica
// duplicata, nessun bypass dei permessi — un client MCP vale quanto l'utente che
// ha creato il token, come un browser collegato con quello stesso account.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { tools } = require('./tools');

// Converte lo schema semplice di tools.js (solo string/number/object, mai annidato
// oltre un livello: basta per questi strumenti) in una forma zod, quella che il
// server MCP si aspetta per validare gli argomenti PRIMA di chiamare l'handler.
function zodShape(inputSchema) {
  const shape = {};
  for (const [key, def] of Object.entries(inputSchema || {})) {
    let field = def.type === 'number' ? z.number() : def.type === 'object' ? z.record(z.string(), z.any()) : z.string();
    if (def.description) field = field.describe(def.description);
    shape[key] = field.optional();
  }
  return shape;
}

async function main() {
  const server = new McpServer({ name: 'platform', version: require('../package.json').version });

  for (const t of tools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: zodShape(t.inputSchema) },
      async (args) => {
        try {
          return await t.handler(args || {});
        } catch (e) {
          return { content: [{ type: 'text', text: 'Errore: ' + e.message }], isError: true };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error('[platform-mcp]', e.message); process.exit(1); });
