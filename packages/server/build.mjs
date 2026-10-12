// Bundle the server for production. Workspace packages (@eyespy/*) are inlined because
// they ship TypeScript source; everything from node_modules stays external.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@eyespy/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
