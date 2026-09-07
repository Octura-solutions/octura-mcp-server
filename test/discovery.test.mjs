import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'))

/**
 * These files are generated snapshots of the live server, so the tests do not
 * check them against the network. They check that the three descriptions
 * agree with each other, which is what breaks when one is regenerated and
 * another is not.
 */
test('tools.json is a tools/list snapshot with the endpoint the README documents', async () => {
  const snap = await read('tools.json')
  assert.equal(snap.endpoint, 'https://octurasolutions.com/mcp')
  assert.equal(snap.transport, 'streamable-http')
  assert.ok(Array.isArray(snap.tools) && snap.tools.length > 0)
  for (const t of snap.tools) {
    assert.match(t.name, /^[a-z0-9_-]+$/)
    assert.equal(t.inputSchema.type, 'object')
  }
  const names = snap.tools.map(t => t.name)
  assert.deepEqual(names, [...names].sort(), 'tools are sorted so regeneration diffs stay readable')
})

test('openapi.json types every tool in tools.json and nothing else', async () => {
  const [snap, api] = await Promise.all([read('tools.json'), read('openapi.json')])
  assert.equal(api.openapi, '3.1.0')
  assert.ok(api.paths['/mcp'].post, 'the single JSON-RPC endpoint is documented')

  const callParams = api.components.schemas.ToolsCallRequest.properties.params
  const mapping = callParams.discriminator.mapping
  assert.deepEqual(Object.keys(mapping).sort(), snap.tools.map(t => t.name))

  for (const t of snap.tools) {
    const callRef = mapping[t.name].replace('#/components/schemas/', '')
    const call = api.components.schemas[callRef]
    assert.equal(call.properties.name.const, t.name)
    const inputRef = call.properties.arguments.$ref.replace('#/components/schemas/', '')
    const input = api.components.schemas[inputRef]
    assert.deepEqual(input.properties ?? {}, t.inputSchema.properties ?? {},
      `${t.name}: argument schema in openapi.json matches tools.json`)
  }

  // Every $ref in the document resolves.
  const refs = JSON.stringify(api).match(/"\$ref":"#\/components\/schemas\/([A-Za-z0-9]+)"/g) || []
  for (const r of refs) {
    const name = r.slice(r.lastIndexOf('/') + 1, -1)
    assert.ok(api.components.schemas[name], `unresolved $ref ${name}`)
  }
})

test('ai-plugin.json has the required fields and points at this openapi.json', async () => {
  const plugin = await read('.well-known/ai-plugin.json')
  for (const k of ['schema_version', 'name_for_human', 'name_for_model', 'description_for_human',
                   'description_for_model', 'auth', 'api', 'logo_url', 'contact_email', 'legal_info_url']) {
    assert.ok(plugin[k], `missing ${k}`)
  }
  assert.equal(plugin.schema_version, 'v1')
  assert.match(plugin.name_for_model, /^[A-Za-z0-9_]{1,50}$/)
  assert.ok(plugin.description_for_model.length <= 8000)
  assert.equal(plugin.auth.type, 'none')
  assert.equal(plugin.api.type, 'openapi')
  assert.match(plugin.api.url, /\/openapi\.json$/)
})
