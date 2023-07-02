import esbuild from 'esbuild'

esbuild.build({
  logLevel: 'info',
  bundle: true,
  entryPoints: ['src/scripts/index.js', 'src/styles/index.css'],
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
