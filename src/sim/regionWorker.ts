/** Web Worker entry: hosts the region sim off the main thread. */
import { RegionSimHost } from './RegionSimHost';
import type { ToWorker } from './regionProtocol';

const scope = self as unknown as {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: { data: ToWorker }) => void) | null;
};

const host = new RegionSimHost({ post: (msg, transfer) => scope.postMessage(msg, transfer ?? []) });
scope.onmessage = (e) => host.handle(e.data);
