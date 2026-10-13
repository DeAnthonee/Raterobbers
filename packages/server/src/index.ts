import { SHARED_VERSION } from '@raterobbers/shared';
import { BUILD_TIME, VERSION, clientDistDir, server } from './app';

const port = Number.parseInt(process.env.PORT ?? '2567', 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}
// Bind every interface: behind a tunnel or in a container a loopback-only bind is invisible.
const host = process.env.HOST ?? '0.0.0.0';

server
  .listen(port, host)
  .then(() => {
    console.log(
      `Rate Robbers server v${VERSION} (build ${BUILD_TIME}, shared ${SHARED_VERSION}) listening on ${host}:${port}; client: ${clientDistDir() ?? 'not served'}`,
    );
  })
  .catch((err: unknown) => {
    console.error('server failed to start', err);
    process.exit(1);
  });
