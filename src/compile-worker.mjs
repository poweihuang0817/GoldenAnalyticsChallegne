// tsx does not propagate its TypeScript loader into worker threads. Register it locally.
import { workerData } from 'node:worker_threads';
if (workerData.entry.endsWith('.ts')) {
  const { tsImport } = await import('tsx/esm/api');
  await tsImport(workerData.entry, import.meta.url);
} else {
  await import(workerData.entry);
}
