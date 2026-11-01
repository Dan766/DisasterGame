import type { FromWorker, ToWorker, Transport } from './regionProtocol';

/** Spawns the region sim worker and wraps it as a `Transport`. */
export function createWorkerTransport(): Transport {
  const worker = new Worker(new URL('./regionWorker.ts', import.meta.url), { type: 'module' });
  return {
    post: (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer),
    onMessage: (cb) => {
      worker.onmessage = (e: MessageEvent<FromWorker>) => cb(e.data);
    },
    terminate: () => worker.terminate(),
  };
}
