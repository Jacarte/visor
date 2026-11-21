export const APP_URL = 'app://bundle/index.html';
export const APP_ORIGIN = 'app://bundle';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'none'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export function trustedSender(event: { sender: unknown; senderFrame: unknown }, expected: { mainFrame: unknown; isDestroyed(): boolean } | null): boolean {
  if (!expected || expected.isDestroyed() || event.sender !== expected || !event.senderFrame || event.senderFrame !== expected.mainFrame) return false;
  const frame = event.senderFrame as { url: string; origin: string; isDestroyed?(): boolean };
  return !frame.isDestroyed?.() && frame.url === APP_URL && frame.origin === APP_ORIGIN;
}
export function assetName(url: string, method: string): string | null {
  if (!['GET', 'HEAD'].includes(method) || !['app://bundle/index.html', 'app://bundle/renderer.js', 'app://bundle/styles.css'].includes(url)) return null;
  return url.slice('app://bundle/'.length);
}
export function validateIPCArgs(channel: string, args: unknown[]): boolean {
  if (channel === 'chooseFolder' || channel === 'getSnapshot') return args.length === 0;
  if (channel === 'readNote') return args.length === 2 && typeof args[0] === 'string' && args[0].length > 0 && args[0].length <= 4096 && typeof args[1] === 'number' && Number.isSafeInteger(args[1]) && args[1] > 0;
  if (channel === 'openExternal') return args.length === 1 && typeof args[0] === 'string' && args[0].length <= 4096;
  return false;
}
