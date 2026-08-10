# octura-mcp-server

stdio bridge to the [Octura Solutions MCP server](https://octurasolutions.com/tools/mcp-server):
24 deterministic ERP calculators covering Odoo implementation, migration and upgrade cost, ROI
and total cost of ownership, US/Canada/EU sales tax and VAT, Canadian payroll source deductions,
and inventory maths (reorder point, safety stock, EOQ, landed cost, OEE).

Every tool is a pure function. Same inputs, same outputs, no model in the loop, so the numbers
are arithmetic rather than a plausible guess.

## Use it

The server is remote and speaks streamable HTTP, which most clients support directly:

```json
{
  "mcpServers": {
    "octura": {
      "type": "streamable-http",
      "url": "https://octurasolutions.com/mcp"
    }
  }
}
```

This package is for clients that only speak stdio:

```bash
uvx octura-mcp-server
```

```json
{
  "mcpServers": {
    "octura": {
      "command": "uvx",
      "args": ["octura-mcp-server"]
    }
  }
}
```

No install, no API key, no configuration. Point it at another endpoint with `OCTURA_MCP_URL`,
and adjust the request timeout with `OCTURA_MCP_TIMEOUT_MS`.

## What it does

It is a pipe. Whatever arrives on stdin is POSTed verbatim to the endpoint and the reply is
written back. It does not restate the tool list or any schema, so it cannot drift out of sync
with the server. Standard library only, no dependencies.

## Links

- Tools, docs and interactive versions: <https://octurasolutions.com/tools/mcp-server>
- Source: <https://github.com/Octura-solutions/octura-mcp-server>
- Official MCP registry: `com.octurasolutions/site-tools`

MIT licensed. Tax rates and payroll figures are maintained on a best-effort basis and are not a
substitute for advice from an accountant.
