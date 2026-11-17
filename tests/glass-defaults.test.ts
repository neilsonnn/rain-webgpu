import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defaultsMiddleware } from '../scripts/glass-defaults'
import { defaults, normalizeGlassSettings } from '../src/glass/earlier/settings'
import { normalizeGlassSettings as currentSettings } from '../src/glass/settings'
import { presetKeys, type Arrangement } from '../src/glass/presets'

vi.mock('../src/glass/default-presets.json', () => ({ default: {} }))
const models = async () => ({ keys: presetKeys, normalize: (key: string, settings: object) => key === 'current' ? currentSettings(settings)
  : normalizeGlassSettings({ ...settings, arrangement: key.slice('earlier:'.length) as Arrangement }) })

let directory: string, file: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'glass-defaults-'))
  file = join(directory, 'presets.json')
  await writeFile(file, '{}\n')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function request(body: unknown, overrides: object = {}) {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    url: '/__glass/defaults', method: 'POST', headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
  }, overrides) as IncomingMessage
}
function response() {
  return { statusCode: 200, body: '', setHeader() {}, end(text: string) { this.body = text } }
}

describe('local project defaults editor', () => {
  it('writes selected arrangement defaults into the project JSON and preserves other presets during concurrent saves', async () => {
    const save = defaultsMiddleware(file, models), original = response(), canopy = response()
    await Promise.all([
      save(request({ key: 'earlier:original', settings: { ...defaults, contrast: 1.31 } }), original as unknown as ServerResponse, () => {}),
      save(request({ key: 'earlier:canopy', settings: { ...defaults, contrast: 1.55, textureScale: 1.9 } }), canopy as unknown as ServerResponse, () => {}),
    ])
    expect(original.statusCode).toBe(200); expect(canopy.statusCode).toBe(200)
    const persisted = JSON.parse(await readFile(file, 'utf8'))
    expect(persisted['earlier:original']).toEqual({ ...defaults, contrast: 1.31 })
    expect(persisted['earlier:canopy']).toEqual({ ...defaults, arrangement: 'canopy', contrast: 1.55, textureScale: 1.9 })
  })
  it('accepts only the fixed preset names and same-origin JSON requests', async () => {
    const save = defaultsMiddleware(file, models)
    for (const [req, status] of [
      [request({ key: '../../other-file', settings: defaults }), 400],
      [request({ key: 'earlier:canopy', settings: defaults }, { method: 'GET' }), 405],
      [request({ key: 'earlier:canopy', settings: defaults }, { headers: { host: '127.0.0.1:5173', origin: 'https://elsewhere.test' } }), 403],
      [request({ key: 'earlier:canopy', settings: defaults }, { headers: { host: '127.0.0.1:5173', 'content-type': 'text/plain' } }), 415],
    ] as const) {
      const res = response()
      await save(req, res as unknown as ServerResponse, () => {})
      expect(res.statusCode).toBe(status)
    }
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({})
  })
})
