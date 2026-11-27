// Types for scan.mjs, so the vitest files under src/ can import it (tsconfig has no allowJs).
export const FRONTEND: string;
export const ROOT: string;
export const ROUTE_MOUNTS: Record<string, string>;
export const KEY_HANDLER_FILES: string[];
export function handlerKeys(text: string): string[];
export interface ParityItem { key: string; [detail: string]: unknown }
export function scanRoutes(): ParityItem[];
export function scanTestIds(): { items: ParityItem[]; computed: Record<string, number>; auditScope: { files: number; literal: number } };
export function scanTests(): ParityItem[];
export function scanHandlerKeys(): ParityItem[];
export function testidsWithoutBrowserTest(ids: string[]): string[];
export function staticSurface(): { routes: ParityItem[]; testids: ParityItem[]; tests: ParityItem[]; handlerKeys: ParityItem[]; info: Record<string, unknown> };
