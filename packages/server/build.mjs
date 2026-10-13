// Bundle the server for production. Workspace packages (@raterobbers/*) are inlined because
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
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@raterobbers/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
