# Octura Solutions Site Tools (MCP server)

A hosted [Model Context Protocol](https://modelcontextprotocol.io) server exposing 24
deterministic ERP calculators: Odoo implementation, migration and upgrade costs, ROI and total
cost of ownership, sales tax for the US, Canada and the EU, Canadian payroll source deductions,
and inventory maths like reorder point, safety stock and EOQ.

**Endpoint:** `https://octurasolutions.com/mcp` (streamable HTTP)
**Registry:** [`com.octurasolutions/site-tools`](https://registry.modelcontextprotocol.io/v0/servers?search=octura)

Nothing to install and no API key. It is a remote server, so you point your client at the URL.

## Why these are tools and not a chat answer

Every tool is a pure function: same inputs, same outputs, no model in the loop and no
randomness. Asking a language model to compute a payback period or a Quebec QST total invites a
plausible-looking wrong number. These return the arithmetic instead, along with the inputs they
used, so the result can be checked.

The trade-off is that they are calculators, not advice. They do not know your business, and the
cost models carry assumptions (regional rates, blended hourly costs) that a real quote would
replace.

## Add it to your client

Claude Code:

```bash
claude mcp add --transport http octura https://octurasolutions.com/mcp
```

Any client that reads a JSON config:

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

The server is stateless and tools-only. It implements `initialize`, `ping`, `tools/list` and
`tools/call`; it advertises no resources and no prompts.

### If your client only speaks stdio

Most clients handle remote HTTP directly and should use the config above. For older ones that
only support stdio, this repo ships a bridge:

```bash
npx -y github:Octura-solutions/octura-mcp-server
```

```json
{
  "mcpServers": {
    "octura": {
      "command": "npx",
      "args": ["-y", "github:Octura-solutions/octura-mcp-server"]
    }
  }
}
```

Or with Docker, `docker build -t octura-mcp . && docker run -i --rm octura-mcp`.

(It runs from this repo rather than an npm package name, because the bridge is not published to
npm. If that changes, the shorter `npx -y octura-mcp-server` will work too.)

The bridge is a pipe: it POSTs whatever arrives on stdin to the endpoint and writes the reply
back. It has no dependencies and it does not restate the tool list or any schema, so it cannot
drift out of sync with the server. Point it elsewhere with `OCTURA_MCP_URL`.

## A worked example

```bash
curl -s -X POST https://octurasolutions.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"odoo-roi-calculator",
        "arguments":{"currentAnnualCost":60000,"odooAnnualCost":18000,
                     "implementationCost":45000,"annualEfficiencySavings":30000}}}'
```

The `text` content is JSON, echoing the input alongside the result:

```json
{
  "tool": "odoo-roi-calculator",
  "input": {
    "currentAnnualCost": 60000,
    "odooAnnualCost": 18000,
    "implementationCost": 45000,
    "annualEfficiencySavings": 30000
  },
  "result": {
    "annualNetSavings": 72000,
    "paybackMonths": 7.5,
    "threeYearNet": 171000,
    "threeYearRoiPercent": 380
  }
}
```

Every input has a documented default, so a tool called with `{}` still returns a sensible
baseline rather than an error.

## The tools

Each one also exists as an interactive page, which is the easiest way to see what a tool expects
before wiring it up.

### Odoo cost and planning

| Tool | What it returns |
|---|---|
| [`odoo-implementation-cost-calculator`](https://octurasolutions.com/tools/odoo-implementation-cost-calculator) | Estimate your Odoo implementation budget |
| [`odoo-migration-cost-calculator`](https://octurasolutions.com/tools/odoo-migration-cost-calculator) | Estimate the cost to migrate to Odoo |
| [`odoo-upgrade-cost-calculator`](https://octurasolutions.com/tools/odoo-upgrade-cost-calculator) | Budget an Odoo version upgrade |
| [`odoo-total-cost-of-ownership-calculator`](https://octurasolutions.com/tools/odoo-total-cost-of-ownership-calculator) | Model the multi-year total cost of Odoo |
| [`odoo-roi-calculator`](https://octurasolutions.com/tools/odoo-roi-calculator) | Estimate payback and multi-year ROI of Odoo |
| [`odoo-sh-pricing-calculator`](https://octurasolutions.com/tools/odoo-sh-pricing-calculator) | Estimate your Odoo.sh hosting cost |
| [`odoo-stack-savings-calculator`](https://octurasolutions.com/tools/odoo-stack-savings-calculator) | See what consolidating tools into Odoo saves |
| [`odoo-edi-readiness-cost-estimator`](https://octurasolutions.com/tools/odoo-edi-readiness-cost-estimator) | Estimate EDI integration cost in Odoo |
| [`odoo-app-selector`](https://octurasolutions.com/tools/odoo-app-selector) | Find the Odoo apps your business needs |
| [`erp-selection-tool`](https://octurasolutions.com/tools/erp-selection-tool) | Score your best-fit ERP shortlist across 10 systems |
| [`odoo-conf-tuner`](https://octurasolutions.com/tools/odoo-conf-tuner) | Tune odoo.conf workers and memory limits |

### Tax

| Tool | What it returns |
|---|---|
| [`us-sales-tax-calculator`](https://octurasolutions.com/tools/us-sales-tax-calculator) | State sales tax for all 50 states and DC |
| [`us-sales-tax-nexus-checker`](https://octurasolutions.com/tools/us-sales-tax-nexus-checker) | See where you must collect US sales tax |
| [`canadian-sales-tax-calculator`](https://octurasolutions.com/tools/canadian-sales-tax-calculator) | GST, HST, PST and QST for all provinces |
| [`eu-vat-calculator`](https://octurasolutions.com/tools/eu-vat-calculator) | VAT rates by country plus VIES validation |
| [`canadian-payroll-source-deductions-calculator`](https://octurasolutions.com/tools/canadian-payroll-source-deductions-calculator) | CPP, EI and income tax source deductions |

### Inventory and operations

| Tool | What it returns |
|---|---|
| [`inventory-turnover-calculator`](https://octurasolutions.com/tools/inventory-turnover-calculator) | Turnover ratio and days of inventory |
| [`reorder-point-calculator`](https://octurasolutions.com/tools/reorder-point-calculator) | When to reorder, with safety stock |
| [`safety-stock-calculator`](https://octurasolutions.com/tools/safety-stock-calculator) | Buffer stock for demand and lead-time swings |
| [`economic-order-quantity-calculator`](https://octurasolutions.com/tools/economic-order-quantity-calculator) | Optimal order quantity to minimize cost |
| [`inventory-carrying-cost-calculator`](https://octurasolutions.com/tools/inventory-carrying-cost-calculator) | Annual cost of holding inventory |
| [`landed-cost-calculator`](https://octurasolutions.com/tools/landed-cost-calculator) | True per-unit cost including freight and duty |
| [`margin-and-markup-calculator`](https://octurasolutions.com/tools/margin-and-markup-calculator) | Convert between margin, markup and price |
| [`oee-calculator`](https://octurasolutions.com/tools/oee-calculator) | Overall Equipment Effectiveness for production |

## Limits

Rate limited per IP. Read `X-RateLimit-Limit` and `X-RateLimit-Remaining` on the response rather
than hard-coding a number, since the ceiling can change. Over the limit returns HTTP 429 with a
`Retry-After` header.

Tax rates and payroll figures are maintained on a best-effort basis and are not a substitute for
filing advice from an accountant.

## About this repository

This repo is the public home of the server: this README, a copy of the published `server.json`
registry manifest, and the stdio bridge described above. The calculators themselves run inside
the Octura Solutions website, whose source is private, so what you can build and run here is
the bridge rather than the tools.

Run the bridge's tests with `npm test`. They use a local stand-in for the endpoint, so they
pass with no network access.

Details on the server, including the full tool list with input schemas, are at
[octurasolutions.com/tools/mcp-server](https://octurasolutions.com/tools/mcp-server).

Found a wrong number or a tool that errors? Open an issue.

## License

MIT, see [LICENSE](LICENSE). This covers the contents of this repository. The hosted service is
offered as-is under the terms on the website.
