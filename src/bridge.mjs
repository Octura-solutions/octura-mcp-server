#!/usr/bin/env node
/**
 * stdio to streamable-HTTP bridge for the Octura Solutions MCP server.
 *
 * The server is remote and speaks streamable HTTP, which every modern MCP
 * client understands. This bridge exists for the ones that only speak stdio,
 * and so the repository contains something that can actually be built and
 * started by an indexer.
 *
 * It is a pipe, not a reimplementation: whatever arrives on stdin is POSTed
 * verbatim to the endpoint and the reply is written back. No tool list, no
 * schema and no version number is duplicated here, so the bridge cannot drift
 * out of sync with the server the way a hand-mirrored catalogue would.
 *
 * Zero dependencies, deliberately. It runs on Node's built-in fetch, which
 * keeps the Docker image small and means a build cannot fail on a transitive
 * package.
 */

const ENDPOINT = process.env.OCTURA_MCP_URL || 'https://octurasolutions.com/mcp'
const TIMEOUT_MS = Number(process.env.OCTURA_MCP_TIMEOUT_MS || 30000)

/**
 * stdout carries the protocol and nothing else. A stray console.log here
 * corrupts the stream and the client fails to parse a message it never sent.
 */
const log = (...args) => console.error('[octura-mcp]', ...args)

/** JSON-RPC uses null, not undefined, for "no id". */
function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function forward(message) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Both, because the spec allows a server to answer either way. This
        // one replies with JSON, but the bridge should not depend on that.
        'accept': 'application/json, text/event-stream',
        'user-agent': 'octura-mcp-bridge',
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    })

    // 202 with an empty body is the correct reply to a notification. There is
    // nothing to hand back to the client, and inventing a response would be a
    // protocol violation.
    const text = await res.text()
    if (!text) return null

    if (!res.ok) {
      log(`HTTP ${res.status} from endpoint`)
      // A rate-limit or outage still has to reach the client as JSON-RPC,
      // otherwise it just hangs waiting for a reply that never comes.
      try {
        return JSON.parse(text)
      } catch {
        return errorResponse(message?.id, -32603, `Upstream HTTP ${res.status}`)
      }
    }

    return JSON.parse(text)
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `No response within ${TIMEOUT_MS}ms`
      : `Cannot reach ${ENDPOINT}: ${err.message}`
    log(reason)
    return errorResponse(message?.id, -32603, reason)
  } finally {
    clearTimeout(timer)
  }
}

/** One JSON message per line, which is what MCP's stdio transport specifies. */
function write(payload) {
  if (payload !== null && payload !== undefined) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  }
}

async function handleLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return

  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    // No id is recoverable from unparseable input, so this is the one case
    // where the response cannot be correlated. Per JSON-RPC, id is null.
    write(errorResponse(null, -32700, 'Parse error'))
    return
  }

  // A notification (no id) gets no reply, even on failure. Batches are passed
  // through untouched; the server decides what a batch means.
  const isNotification = !Array.isArray(message) && message.id === undefined
  const response = await forward(message)
  if (!isNotification) write(response)
}

// Messages are processed in order. Awaiting each one keeps responses in the
// order the client sent them, which matters for clients that assume it.
let queue = Promise.resolve()
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    queue = queue.then(() => handleLine(line))
  }
})

process.stdin.on('end', () => {
  // Flush a trailing line that arrived without a newline before exiting.
  queue = queue.then(() => handleLine(buffer)).then(() => process.exit(0))
})

log(`bridging stdio to ${ENDPOINT}`)
