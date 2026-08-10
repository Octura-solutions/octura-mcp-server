import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bridge.mjs')

/**
 * A stand-in for the real endpoint. The tests run against this rather than
 * octurasolutions.com so they are deterministic and pass with no network,
 * which is what makes them useful in a sandboxed build.
 */
function fakeEndpoint(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', c => body += c)
      req.on('end', () => handler(JSON.parse(body || '{}'), res, req))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}/mcp`, close: () => server.close() })
    })
  })
}

/** Feed lines to the bridge, collect stdout lines until it exits. */
function run(url, lines, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, OCTURA_MCP_URL: url, OCTURA_MCP_TIMEOUT_MS: '2000' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    child.stdout.on('data', d => out += d)
    child.stderr.on('data', d => err += d)
    const timer = setTimeout(() => { child.kill(); reject(new Error('bridge timed out')) }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      resolve({ lines: out.split('\n').filter(Boolean).map(JSON.parse), stderr: err })
    })
    child.stdin.end(lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  })
}

test('forwards a request and returns the response', async () => {
  const ep = await fakeEndpoint((body, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { echoed: body.method } }))
  })
  const { lines } = await run(ep.url, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
  ep.close()
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], { jsonrpc: '2.0', id: 1, result: { echoed: 'tools/list' } })
})

test('a notification gets no reply, even though the server answers 202', async () => {
  // The bug this guards: writing a response to a notification desynchronises
  // the client, which then reads it as the answer to its next request.
  const ep = await fakeEndpoint((_body, res) => { res.statusCode = 202; res.end() })
  const { lines } = await run(ep.url, [{ jsonrpc: '2.0', method: 'notifications/initialized' }])
  ep.close()
  assert.deepEqual(lines, [])
})

test('stdout carries protocol messages only, logs go to stderr', async () => {
  const ep = await fakeEndpoint((body, res) => {
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }))
  })
  const { lines, stderr } = await run(ep.url, [{ jsonrpc: '2.0', id: 7, method: 'ping' }])
  ep.close()
  assert.equal(lines.length, 1, 'exactly one line on stdout')
  assert.match(stderr, /bridging stdio to/, 'the startup banner went to stderr')
})

test('an unreachable endpoint returns a JSON-RPC error rather than hanging', async () => {
  // Port 1 is reserved and refuses instantly. A client that never gets a
  // reply here would block forever, which is worse than a clean error.
  const { lines } = await run('http://127.0.0.1:1/mcp', [{ jsonrpc: '2.0', id: 3, method: 'ping' }])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].id, 3)
  assert.equal(lines[0].error.code, -32603)
})

test('an upstream error status is passed through as the server wrote it', async () => {
  // 429 matters specifically: the rate limiter's message is the useful part,
  // and replacing it with a generic error would hide the Retry-After advice.
  const ep = await fakeEndpoint((body, res) => {
    res.statusCode = 429
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Rate limit exceeded' } }))
  })
  const { lines } = await run(ep.url, [{ jsonrpc: '2.0', id: 4, method: 'tools/call' }])
  ep.close()
  assert.equal(lines[0].error.message, 'Rate limit exceeded')
})

test('unparseable input yields a parse error with a null id', async () => {
  const ep = await fakeEndpoint((_b, res) => res.end('{}'))
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, OCTURA_MCP_URL: ep.url },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', d => out += d)
  const done = new Promise(r => child.on('close', r))
  child.stdin.end('{ not json\n')
  await done
  ep.close()
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.error.code, -32700)
  assert.equal(parsed.id, null)
})

test('messages split across chunk boundaries are reassembled', async () => {
  // stdin arrives in arbitrary chunks; a naive per-chunk JSON.parse breaks
  // the moment a message straddles two reads.
  const ep = await fakeEndpoint((body, res) => {
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }))
  })
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, OCTURA_MCP_URL: ep.url },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', d => out += d)
  const done = new Promise(r => child.on('close', r))
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' })
  child.stdin.write(msg.slice(0, 12))
  await new Promise(r => setTimeout(r, 50))
  child.stdin.write(msg.slice(12) + '\n')
  child.stdin.end()
  await done
  ep.close()
  assert.equal(JSON.parse(out.trim()).id, 9)
})

test('two messages on one chunk both get answered, in order', async () => {
  const ep = await fakeEndpoint((body, res) => {
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }))
  })
  const { lines } = await run(ep.url, [
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ])
  ep.close()
  assert.deepEqual(lines.map(l => l.id), [1, 2])
})
