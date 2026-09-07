#!/usr/bin/env node
/**
 * Regenerates the machine-readable descriptions of the hosted server:
 *
 *   tools.json    the tools/list reply, verbatim, plus the serverInfo that
 *                 initialize returns. A plain structured snapshot of the API.
 *   openapi.json  an OpenAPI 3.1 document for the single JSON-RPC endpoint,
 *                 with one request schema per tool so the arguments of every
 *                 tools/call are typed rather than free-form.
 *
 * Both are derived from the live endpoint rather than typed by hand, so the
 * way to update them is to run this again, not to edit them. Point it at a
 * staging server with OCTURA_MCP_URL.
 *
 *   node scripts/build-discovery.mjs
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENDPOINT = process.env.OCTURA_MCP_URL || 'https://octurasolutions.com/mcp'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function rpc(method, params, id) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`)
  return body.result
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'octura-mcp-server/build-discovery', version: '1.0.0' },
}, 1)
const { tools } = await rpc('tools/list', {}, 2)
tools.sort((a, b) => a.name.localeCompare(b.name))

const url = new URL(ENDPOINT)

/** "odoo-roi-calculator" -> "OdooRoiCalculator", "ask_octura" -> "AskOctura" */
const pascal = (s) => s.split(/[-_]/).map(w => w[0].toUpperCase() + w.slice(1)).join('')

const schemas = {
  JsonRpcId: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  JsonRpcError: {
    type: 'object',
    required: ['jsonrpc', 'id', 'error'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { oneOf: [{ $ref: '#/components/schemas/JsonRpcId' }, { type: 'null' }] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: { code: { type: 'integer' }, message: { type: 'string' }, data: {} },
      },
    },
  },
  InitializeRequest: {
    type: 'object',
    required: ['jsonrpc', 'id', 'method', 'params'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      method: { const: 'initialize' },
      params: {
        type: 'object',
        required: ['protocolVersion', 'capabilities', 'clientInfo'],
        properties: {
          protocolVersion: { type: 'string', examples: [init.protocolVersion] },
          capabilities: { type: 'object' },
          clientInfo: {
            type: 'object',
            required: ['name', 'version'],
            properties: { name: { type: 'string' }, version: { type: 'string' } },
          },
        },
      },
    },
  },
  InitializeResult: {
    type: 'object',
    required: ['jsonrpc', 'id', 'result'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      result: {
        type: 'object',
        properties: {
          protocolVersion: { type: 'string' },
          capabilities: { type: 'object' },
          serverInfo: {
            type: 'object',
            properties: { name: { type: 'string' }, title: { type: 'string' }, version: { type: 'string' } },
          },
          instructions: { type: 'string' },
        },
        examples: [init],
      },
    },
  },
  PingRequest: {
    type: 'object',
    required: ['jsonrpc', 'id', 'method'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      method: { const: 'ping' },
      params: { type: 'object' },
    },
  },
  PingResult: {
    type: 'object',
    required: ['jsonrpc', 'id', 'result'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      result: { type: 'object', maxProperties: 0 },
    },
  },
  ToolsListRequest: {
    type: 'object',
    required: ['jsonrpc', 'id', 'method'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      method: { const: 'tools/list' },
      params: { type: 'object', properties: { cursor: { type: 'string' } } },
    },
  },
  ToolsListResult: {
    type: 'object',
    required: ['jsonrpc', 'id', 'result'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      result: {
        type: 'object',
        required: ['tools'],
        properties: {
          tools: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'inputSchema'],
              properties: {
                name: { type: 'string', enum: tools.map(t => t.name) },
                title: { type: 'string' },
                description: { type: 'string' },
                inputSchema: { type: 'object' },
              },
            },
          },
        },
      },
    },
  },
  ToolsCallRequest: {
    type: 'object',
    required: ['jsonrpc', 'id', 'method', 'params'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      method: { const: 'tools/call' },
      params: {
        description: 'The tool name selects which arguments schema applies.',
        oneOf: tools.map(t => ({ $ref: `#/components/schemas/${pascal(t.name)}Call` })),
        discriminator: {
          propertyName: 'name',
          mapping: Object.fromEntries(tools.map(t => [t.name, `#/components/schemas/${pascal(t.name)}Call`])),
        },
      },
    },
  },
  ToolsCallResult: {
    type: 'object',
    required: ['jsonrpc', 'id', 'result'],
    properties: {
      jsonrpc: { const: '2.0' },
      id: { $ref: '#/components/schemas/JsonRpcId' },
      result: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'array',
            description: 'One text item whose text is a JSON document: {"tool", "input", "result"}. "input" echoes the normalized arguments the calculator actually used, so the result can be checked.',
            items: {
              type: 'object',
              required: ['type', 'text'],
              properties: { type: { const: 'text' }, text: { type: 'string', contentMediaType: 'application/json' } },
            },
          },
          isError: { type: 'boolean' },
        },
      },
    },
  },
}

for (const t of tools) {
  const base = pascal(t.name)
  schemas[`${base}Input`] = {
    title: t.title || t.name,
    description: t.description,
    ...t.inputSchema,
  }
  schemas[`${base}Call`] = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { const: t.name },
      arguments: { $ref: `#/components/schemas/${base}Input` },
    },
  }
}

const rateLimitHeaders = {
  'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per window, per IP.' },
  'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in the current window.' },
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: init.serverInfo?.title || 'Octura Solutions Site Tools',
    version: init.serverInfo?.version || '1.0.0',
    summary: `Model Context Protocol server with ${tools.length} read-only tools, over JSON-RPC 2.0.`,
    description: [
      'This is a Model Context Protocol (MCP) server, so the whole API is one POST endpoint that speaks JSON-RPC 2.0.',
      'The methods it implements are `initialize`, `ping`, `tools/list` and `tools/call`; it advertises no resources and no prompts and keeps no session state.',
      '',
      `The ${tools.length} tools are listed under components as \`<ToolName>Input\`. Every calculator input has a documented default, so a tool called with \`{}\` returns a sensible baseline rather than an error.`,
      '',
      init.instructions || '',
      '',
      'No authentication. Rate limited per IP; over the limit returns 429 with a Retry-After header.',
      '',
      'Generated by scripts/build-discovery.mjs in https://github.com/Octura-solutions/octura-mcp-server from the live tools/list, so it is a snapshot: the server, not this file, is the source of truth.',
    ].join('\n'),
    termsOfService: `${url.origin}/terms-and-conditions`,
    contact: { name: 'Octura Solutions', url: `${url.origin}/tools/mcp-server`, email: 'curious@octurasolutions.com' },
    license: { name: 'MIT (this document)', identifier: 'MIT' },
  },
  externalDocs: { description: 'Server page with the full tool list and worked examples', url: `${url.origin}/tools/mcp-server` },
  servers: [{ url: url.origin }],
  tags: [{ name: 'mcp', description: 'Model Context Protocol over streamable HTTP' }],
  paths: {
    [url.pathname]: {
      post: {
        tags: ['mcp'],
        operationId: 'jsonrpc',
        summary: 'Send one JSON-RPC 2.0 request',
        description: 'Send `Accept: application/json, text/event-stream`. Responses are plain JSON.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/InitializeRequest' },
                  { $ref: '#/components/schemas/PingRequest' },
                  { $ref: '#/components/schemas/ToolsListRequest' },
                  { $ref: '#/components/schemas/ToolsCallRequest' },
                ],
              },
              examples: {
                toolsList: { value: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } },
                roi: {
                  summary: 'Call a calculator',
                  value: {
                    jsonrpc: '2.0', id: 2, method: 'tools/call',
                    params: {
                      name: 'odoo-roi-calculator',
                      arguments: { currentAnnualCost: 60000, odooAnnualCost: 18000, implementationCost: 45000, annualEfficiencySavings: 30000 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'JSON-RPC result or error object (application-level errors still return HTTP 200).',
            headers: rateLimitHeaders,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/InitializeResult' },
                    { $ref: '#/components/schemas/PingResult' },
                    { $ref: '#/components/schemas/ToolsListResult' },
                    { $ref: '#/components/schemas/ToolsCallResult' },
                    { $ref: '#/components/schemas/JsonRpcError' },
                  ],
                },
              },
            },
          },
          429: {
            description: 'Rate limit exceeded for this IP.',
            headers: { ...rateLimitHeaders, 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' } },
          },
        },
      },
    },
  },
  components: { schemas },
}

const snapshot = {
  $comment: 'Snapshot of the live tools/list and initialize replies. Regenerate with `npm run discovery`; do not edit by hand.',
  endpoint: ENDPOINT,
  transport: 'streamable-http',
  protocolVersion: init.protocolVersion,
  serverInfo: init.serverInfo,
  capabilities: init.capabilities,
  instructions: init.instructions,
  tools,
}

await writeFile(join(ROOT, 'tools.json'), JSON.stringify(snapshot, null, 2) + '\n')
await writeFile(join(ROOT, 'openapi.json'), JSON.stringify(openapi, null, 2) + '\n')
console.log(`wrote tools.json and openapi.json: ${tools.length} tools from ${ENDPOINT}`)
