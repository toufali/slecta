import { readdirSync } from 'node:fs'
import esbuild from 'esbuild'

const partialPaths = ['src/scripts/partials', 'src/styles/partials'].reduce((acc, cur) => {
  const entries = readdirSync(cur, { withFileTypes: true })
  const paths = entries.map(entry => `${entry.path}/${entry.name}`)
  acc.push(...paths)
  return acc
}, [])


esbuild.build({
  logLevel: 'info',
  bundle: true,
  entryPoints: ['src/scripts/index.js', 'src/styles/index.css', ...partialPaths],
  entryNames: '[dir]/[name]',
  loader: { '.woff2': 'copy' },
  assetNames: '[dir]/[name]',
  external: ['*.webp', '*.svg'],
  outdir: 'dist',
  format: 'esm',
  minify: true,
  sourcemap: true,
  splitting: false,
  treeShaking: true,
  platform: 'neutral',
})
