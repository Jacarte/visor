import { expect, it } from 'vitest';
import { APP_URL, APP_ORIGIN, CSP, assetName, trustedSender, validateIPCArgs } from '../src/electron-policy';
it('electron-policy requires the expected live webContents and exact live main-frame origin AND URL', () => {
  const mainFrame = { url: APP_URL, origin: APP_ORIGIN }; const contents = { mainFrame, isDestroyed: () => false };
  expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents)).toBe(true);
  for (const event of [{ sender: {}, senderFrame: mainFrame }, { sender: contents, senderFrame: { ...mainFrame } }, { sender: contents, senderFrame: null }]) expect(trustedSender(event, contents)).toBe(false);
  for (const url of ['app://bundle/index.html#x', 'app://bundle/index.html?x', 'app://bundle.evil/index.html', 'http://localhost/index.html', 'about:blank']) { mainFrame.url = url; expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents)).toBe(false); }
  mainFrame.url = APP_URL; mainFrame.origin = 'null'; expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents)).toBe(false);
  mainFrame.origin = APP_ORIGIN; contents.isDestroyed = () => true; expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents)).toBe(false);
});
it('electron-policy limits every channel and shape; no arbitrary path/root/raw channel capability', () => {
  expect(validateIPCArgs('chooseFolder', [])).toBe(true); expect(validateIPCArgs('chooseFolder', ['/tmp/root'])).toBe(false);
  expect(validateIPCArgs('getSnapshot', [])).toBe(true); expect(validateIPCArgs('getSnapshot', [null])).toBe(false);
  expect(validateIPCArgs('readNote', ['Map.md', 1])).toBe(true);
  for (const args of [[null, 1], ['Map.md', NaN], ['Map.md', 0], ['Map.md', 1.2], ['x'.repeat(4097), 1], ['Map.md', 1, true]]) expect(validateIPCArgs('readNote', args)).toBe(false);
  expect(validateIPCArgs('openExternal', [42])).toBe(false); expect(validateIPCArgs('readFile', ['/etc/passwd'])).toBe(false);
});
it('electron-policy asset protocol serves a fixed GET/HEAD code allowlist, never notes or arbitrary paths', () => {
  expect(assetName(APP_URL, 'GET')).toBe('index.html'); expect(assetName('app://bundle/preload.cjs', 'GET')).toBeNull();
  for (const url of ['app://bundle/Map.md', 'app://bundle/../index.html', 'app://bundle/%2e%2e/index.html', 'app://bundle/index.html?q=x', 'app://evil/index.html', 'file:///index.html']) expect(assetName(url, 'GET')).toBeNull();
  expect(assetName(APP_URL, 'POST')).toBeNull(); expect(assetName(APP_URL, 'HEAD')).toBe('index.html');
  expect(CSP).toContain("connect-src 'none'"); expect(CSP).toContain("style-src-attr 'unsafe-inline'"); expect(CSP).not.toMatch(/script-src[^;]*unsafe/);
});
