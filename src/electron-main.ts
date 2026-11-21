import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FolderIndex } from './folder-index';
import { MarkdownJobs } from './markdown-jobs';
import { externalURL } from './links';
import { APP_URL, CSP, assetName, trustedSender, validateIPCArgs } from './electron-policy';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Electron/Chromium state is never placed in a selected source folder.
const temporaryUserData = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
if (temporaryUserData && path.isAbsolute(temporaryUserData)) app.setPath('userData', temporaryUserData);
app.setPath('sessionData', app.getPath('userData'));
app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'));
let window: BrowserWindow | null = null;
let index: FolderIndex | null = null;
const bundle = __dirname;
// Shared across window lifetimes: closing a window cannot leave a second worker pool behind.
const markdownJobs = new MarkdownJobs(path.join(bundle, 'markdown-worker.cjs'));
async function chooseFolder(): Promise<ReturnType<FolderIndex['current']>> {
  const owner = window; if (!owner || !index) throw new Error('Window unavailable');
  const result = await dialog.showOpenDialog(owner, { title: 'Open a Wayfinder project folder', properties: ['openDirectory'] });
  if (window !== owner || owner.isDestroyed()) throw new Error('Window closed');
  return result.canceled || !result.filePaths[0] ? index.current() : index.select(result.filePaths[0]);
}
for (const channel of ['chooseFolder', 'getSnapshot', 'readNote', 'openExternal']) {
  ipcMain.handle(`visor:${channel}`, async (event, ...args: unknown[]) => {
    const owner = window?.webContents ?? null; const frame = event.senderFrame;
    if (!trustedSender(event, owner) || !validateIPCArgs(channel, args) || !index) throw new Error('Request denied');
    let result: unknown;
    if (channel === 'chooseFolder') result = await chooseFolder();
    else if (channel === 'getSnapshot') result = await index.refresh();
    else if (channel === 'readNote') result = await index.readNote(args[0] as string, args[1] as number);
    else {
      const url = externalURL(args[0]); if (!url) throw new Error('External protocol denied');
      // Recheck immediately before the only OS URL-opening operation.
      if (!trustedSender(event, owner) || event.senderFrame !== frame) throw new Error('Request expired');
      await shell.openExternal(url); result = undefined;
    }
    if (window?.webContents !== owner || !trustedSender(event, owner) || event.senderFrame !== frame) throw new Error('Request expired');
    if (result && typeof result === 'object' && 'generation' in result && result.generation !== index.current().generation) throw new Error('Folder generation changed');
    return result;
  });
}
async function createWindow() {
  const win = new BrowserWindow({ title: 'Visor', width: 1500, height: 1000, minWidth: 900, minHeight: 600, backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(bundle, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false } });
  window = win;
  const session = win.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  const denyDownload = (event: Electron.Event) => event.preventDefault();
  session.on('will-download', denyDownload);
  if (!await session.protocol.isProtocolHandled('app')) {
    session.protocol.handle('app', async request => {
      const name = assetName(request.url, request.method);
      if (!name) return new Response('Not found', { status: 404 });
      const body = await fs.readFile(path.join(bundle, name));
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
      } });
    });
  }
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'o' && (process.platform === 'darwin' ? input.meta : input.control) && !input.alt) {
      event.preventDefault();
      void chooseFolder().catch(error => { if (!win.isDestroyed()) void dialog.showMessageBox(win, { type: 'error', message: 'Folder unavailable', detail: String(error) }); });
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-frame-navigate', event => event.preventDefault());
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  index = new FolderIndex([app.getAppPath(), path.resolve(bundle, '..'), app.getPath('userData'), app.getPath('sessionData'), app.getPath('logs')], snapshot => {
    if (window === win && !win.isDestroyed() && win.webContents.mainFrame.url === APP_URL) win.webContents.send('visor:update', snapshot);
  }, markdownJobs);
  win.on('closed', () => { session.removeListener('will-download', denyDownload); if (window === win) { index?.close(); index = null; window = null; } });
  await win.loadURL(APP_URL);
  const folderArg = process.argv.find(a => a.startsWith('--folder='));
  if (folderArg && index) {
    try { await index.select(folderArg.slice('--folder='.length)); }
    catch (error) { await dialog.showMessageBox(win, { type: 'error', message: 'Folder unavailable', detail: String(error) }); }
  }
}
void app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Visor', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseFolder().catch(error => window && dialog.showMessageBox(window, { type: 'error', message: 'Folder unavailable', detail: String(error) })); } }, { role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ]));
  await createWindow();
  app.on('activate', () => { if (!window) void createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => index?.close());
