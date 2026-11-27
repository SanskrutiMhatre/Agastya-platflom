// Worker thread of dbImage.inspectDatabaseFileAsync: checks one database file off the server's event loop (WP-12).
import { parentPort, workerData } from 'worker_threads';
import { inspectDatabaseFile } from './dbImage';

try {
  parentPort?.postMessage({ ok: true, facts: inspectDatabaseFile(String((workerData as { file: string }).file)) });
} catch (e) {
  parentPort?.postMessage({ ok: false, error: (e as Error).message });
}
