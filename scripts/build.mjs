/**
 * Builds both halves into lib/.
 *
 * lib/index.js  — Host half: ESM, bare imports left external (the host supplies
 *                 cordis/schemastery from its own module table).
 * lib/client.js — Client half: a browser bundle wrapped in the loader's lazy
 *                 factory, so it must contain no top-level import/export.
 *
 * esbuild instead of tsdown because the client artifact has to be a function
 * body: `require` is the factory parameter, and `react` must stay a
 * `require('react')` call rather than being bundled.
 */
import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = resolve(ROOT, 'lib')

/**
 * Bundles one entry point and returns its text.
 * @param options - esbuild options; `bundle` and `write:false` are set here.
 * @returns The first output file's contents.
 */
async function emit(options) {
  const result = await build({ bundle: true, write: false, logLevel: 'warning', ...options })
  return result.outputFiles?.[0]?.text ?? ''
}

await rm(LIB, { recursive: true, force: true })
await mkdir(LIB, { recursive: true })

// Host: `packages: 'external'` keeps @deepseek-ai/* as imports so the plugin
// shares the host's instances instead of embedding a second copy.
const host = await emit({
  entryPoints: [resolve(ROOT, 'src/index.ts')],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
})
await writeFile(resolve(LIB, 'index.js'), host)

// Client: jsx "transform" (not "automatic") because automatic emits
// require('react/jsx-runtime'), which the browser module table does not expose.
const client = await emit({
  entryPoints: [resolve(ROOT, 'src/client/index.tsx')],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'createElement',
  jsxFragment: 'Fragment',
  external: ['react'],
})

// Same wrapper shape the shipped browser artifacts use: the loader hands over
// `require`, we hand back the module exports.
const wrapped = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-plastic-memories",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  client,
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')
await writeFile(resolve(LIB, 'client.js'), wrapped)

console.log('built lib/index.js and lib/client.js')
