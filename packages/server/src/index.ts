import { SHARED_VERSION } from '@eyespy/shared';
import { server } from './app';

const port = Number.parseInt(process.env.PORT ?? '2567', 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}
console.log(`Eye Spy server (shared ${SHARED_VERSION}) listening on :${port}`);
server.listen(port).catch((err: unknown) => {
  console.error('server failed to start', err);
  process.exit(1);
});
