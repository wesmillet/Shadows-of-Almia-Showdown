// Development only: a match worker run from source (the built server has dist-server/roomWorker.js).
// Workers do not pick up `--import tsx` for their own imports, so it is registered here first.
import { register } from 'tsx/esm/api';

register();
await import('./roomWorker.ts');
