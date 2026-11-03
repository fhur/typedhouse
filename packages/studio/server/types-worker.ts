// The editor's TypeScript service in a worker thread (R12, S9 round 2): type checks never block runs or
// generation on the main thread. Protocol: { id, op, args } in, { id, result } or { id, error } out.
import { parentPort, workerData } from 'node:worker_threads';
import { createTypeService, type CoreMode } from './types.js';

const service = createTypeService({ core: (workerData as { core?: CoreMode | 'auto' } | undefined)?.core ?? 'auto' });
type Ops = {
  setSchema: Parameters<typeof service.setSchema>;
  check: Parameters<typeof service.check>;
  completions: Parameters<typeof service.completions>;
  hover: Parameters<typeof service.hover>;
  warm: [];
};
const ops: { [K in keyof Ops]: (...args: Ops[K]) => unknown } = {
  setSchema: schema => service.setSchema(schema),
  check: source => service.check(source),
  completions: (source, pos) => service.completions(source, pos),
  hover: (source, pos) => service.hover(source, pos) ?? null,
  warm: () => service.warm(),
};

parentPort!.on('message', (message: { id: number; op: keyof Ops; args: unknown[] }) => {
  try {
    const result = (ops[message.op] as (...args: unknown[]) => unknown)(...message.args);
    parentPort!.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
parentPort!.postMessage({ ready: service.core });
