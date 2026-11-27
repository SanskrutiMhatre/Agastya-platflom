// =============================================================================
// Letting go of a project's pictures so they can be deleted.
//
// The warm FOP renderer (vendor/engine/fopd) is one long-lived Java process. When it embeds a scaled PNG (every figure with a width and a height does) FOP 2.10 leaves the
// file open until the process ends - measured on this installation: after a build, the one picture of the project stayed locked (the logos, drawn at a fixed size, did not),
// and stopping the renderer freed it. Windows refuses to delete or rename a file that another process holds open, so a project that had been built could not be deleted
// ("EBUSY: resource busy or locked", shown to the person as "Internal error"), and neither could a picture the build had used.
//
// The renderer's source is vendored and stays as it is. What is done here is the remedy that does not touch it: when removing a file fails because it is in use, stop the
// renderer (which frees everything it holds) and try again; the renderer starts again by itself with the next build. If something else holds the file (an editor, a virus
// scanner, an open preview) the person is told which file, instead of an internal error.
// =============================================================================

import path from 'path';
import { vendor } from '../config';
import { conflict } from './http';

const fopd = vendor('engine/fopd');

/** Windows reports a file another process holds open as EBUSY, or as EPERM when it is being deleted. */
export const isFileInUse = (e: unknown): boolean => ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException | undefined)?.code ?? '');

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** Stop the warm renderer: every file it holds open is let go. The next build starts it again (render() starts it when it is not running), a few seconds slower once. */
export function releaseRenderer(): void {
  try { fopd.stop(); } catch { /* nothing to stop */ }
  for (const fn of releaseHooks) { try { fn(); } catch { /* best effort */ } }
}

/**
 * WP-14: builds now run in job workers, each with its own warm JVM, so those hold the pictures. The job service registers a hook here that
 * ends its idle workers (and their JVMs) synchronously; a worker that is running a job is left alone. (A registry, so this leaf module
 * does not import the job service.)
 */
const releaseHooks = new Set<() => void>();
export function onReleaseRenderer(fn: () => void): () => void { releaseHooks.add(fn); return () => releaseHooks.delete(fn); }

/**
 * Run `remove` (it deletes or renames files). If it fails because a file is in use, release the renderer and try again for a couple of seconds; if the file is still in use,
 * say which one and what to do. Any other failure is passed on unchanged.
 */
export function removeReleasingRenderer<T>(remove: () => T, what: string, retries = 12, waitMs = 150): T {
  try { return remove(); } catch (e) { if (!isFileInUse(e)) throw e; }
  releaseRenderer();
  let last: NodeJS.ErrnoException | undefined;
  for (let i = 0; i < retries; i++) {
    pause(waitMs);
    try { return remove(); } catch (e) { if (!isFileInUse(e)) throw e; last = e as NodeJS.ErrnoException; }
  }
  const file = last?.path ? path.basename(last.path) : 'a file';
  throw conflict(`${what} could not be removed: ${file} is open in another program (${last?.code ?? 'in use'}). Close that program and try again.`, 'FILES_IN_USE');
}
