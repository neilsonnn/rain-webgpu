import { readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { GlassSettings } from '../src/glass/settings'
import type { Arrangement } from '../src/glass/presets'

interface PresetModels { keys: readonly string[]; normalize: (key: string, settings: object) => GlassSettings }

// A deliberately narrow, development-only editor: one JSON file and the preset
// names declared in the project; the browser cannot supply paths or code.
export function defaultsMiddleware(file: string, loadModels: () => Promise<PresetModels>) {
  let writes = Promise.resolve()
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/__glass/defaults') { next(); return }
    const reply = (status: number, value: unknown) => {
      res.statusCode = status; res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value))
    }
    if (req.method !== 'POST') { reply(405, { error: 'Use POST.' }); return }
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      reply(403, { error: 'Save defaults from this website.' }); return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'Expected JSON.' }); return }
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString()
        if (Buffer.byteLength(body) > 16384) { reply(413, { error: 'Preset is too large.' }); return }
      }
      let input: { key?: unknown; settings?: unknown }
      try { input = JSON.parse(body) } catch { reply(400, { error: 'Invalid JSON.' }); return }
      const models = await loadModels()
      if (!input || typeof input.key !== 'string' || !models.keys.includes(input.key) || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) {
        reply(400, { error: 'Unknown preset or settings.' }); return
      }
      const key = input.key, settings = models.normalize(key, input.settings)
      const write = writes.catch(() => {}).then(async () => {
        const presets = JSON.parse(await readFile(file, 'utf8'))
        presets[key] = settings
        await writeFile(`${file}.tmp`, `${JSON.stringify(presets, null, 2)}\n`)
        await rename(`${file}.tmp`, file)
      })
      writes = write
      await write
      reply(200, { saved: key })
    } catch (error) {
      console.error('Could not save glass defaults.', error)
      reply(500, { error: 'Defaults could not be written.' })
    }
  }
}

export function glassDefaults(): Plugin {
  return { name: 'glass-default-presets', apply: 'serve', configureServer(server) {
    // Load browser settings through Vite rather than importing them into the
    // server config: saving a preset must not restart the development server.
    server.middlewares.use(defaultsMiddleware(resolve(server.config.root, 'src/glass/default-presets.json'), async () => {
      const [{ glassVersions }, { presetKeys }] = await Promise.all([
        server.ssrLoadModule('/src/glass/versions.ts'), server.ssrLoadModule('/src/glass/presets.ts'),
      ])
      return { keys: presetKeys, normalize: (key, settings) => key === 'current'
        ? glassVersions.current.normalizeGlassSettings(settings)
        : glassVersions.earlier.normalizeGlassSettings({ ...settings, arrangement: key.slice('earlier:'.length) as Arrangement }) }
    }))
  } }
}
