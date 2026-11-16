const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec, execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const HOME_DIR = path.join(os.homedir(), '.codebox');
const VCPKG_ROOT = path.join(HOME_DIR, 'vcpkg');
const HELPER = path.join(HOME_DIR, 'unbuf.c');

let win = null;
let sh = null;
let workspace = null;
let settingsFile = null;

const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };

// ---------- settings
const DEFAULTS = { theme: 'dark', fontSize: 14, wordWrap: false, autosave: true, autoCheckUpdates: true, lastWorkspace: null };
let settings = { ...DEFAULTS };
function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

// ---------- environment (re-reads PATH so freshly installed tools work without a restart)
let envCache = null, envAt = 0;
function freshEnv(force) {
  if (!force && envCache && Date.now() - envAt < 5000) return { ...envCache };
  const env = { ...process.env };
  if (IS_WIN) {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"],
        { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
      let old = '';
      for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') { old = env[k] || old; delete env[k]; }
      env.Path = out + ';' + old;
    } catch { /* keep existing PATH */ }
  }
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONIOENCODING = 'utf-8';
  envCache = env; envAt = Date.now();
  return { ...env };
}

// ---------- templates and examples
const EXT = { python: 'py', java: 'java', c: 'c', cpp: 'cpp' };
const TEMPLATES = {
  python: () => `print("Hello from Python!")\nname = input("What's your name? ")\nprint(f"Nice to meet you, {name}!")\n`,
  java: n => `public class ${n} {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}\n`,
  c: () => `#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C!\\n");\n    return 0;\n}\n`,
  cpp: () => `#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++!" << std::endl;\n    return 0;\n}\n`
};

const EXAMPLES = {
  python: {
    'Guess the number': `import random\n\nsecret = random.randint(1, 100)\ntries = 0\nprint("I'm thinking of a number between 1 and 100.")\nwhile True:\n    try:\n        guess = int(input("Your guess: "))\n    except ValueError:\n        print("Please type a whole number.")\n        continue\n    tries += 1\n    if guess < secret:\n        print("Higher!")\n    elif guess > secret:\n        print("Lower!")\n    else:\n        print(f"Correct! You got it in {tries} tries.")\n        break\n`,
    'Calculator': `a = float(input("First number: "))\nop = input("Operation (+ - * /): ").strip()\nb = float(input("Second number: "))\n\nif op == "+":\n    print(a + b)\nelif op == "-":\n    print(a - b)\nelif op == "*":\n    print(a * b)\nelif op == "/":\n    print(a / b if b != 0 else "Can't divide by zero")\nelse:\n    print("Unknown operation")\n`,
    'Times tables': `n = int(input("Which times table? "))\nfor i in range(1, 13):\n    print(f"{i:2} x {n} = {i * n}")\n`
  },
  java: {
    'Guess the number': n => `import java.util.Random;\nimport java.util.Scanner;\n\npublic class ${n} {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int secret = new Random().nextInt(100) + 1;\n        int tries = 0;\n        System.out.println("I'm thinking of a number between 1 and 100.");\n        while (true) {\n            System.out.print("Your guess: ");\n            System.out.flush();\n            int guess;\n            try { guess = Integer.parseInt(in.nextLine().trim()); }\n            catch (NumberFormatException e) { System.out.println("Please type a whole number."); continue; }\n            tries++;\n            if (guess < secret) System.out.println("Higher!");\n            else if (guess > secret) System.out.println("Lower!");\n            else { System.out.println("Correct! You got it in " + tries + " tries."); break; }\n        }\n    }\n}\n`,
    'Calculator': n => `import java.util.Scanner;\n\npublic class ${n} {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.print("First number: "); System.out.flush();\n        double a = Double.parseDouble(in.nextLine().trim());\n        System.out.print("Operation (+ - * /): "); System.out.flush();\n        String op = in.nextLine().trim();\n        System.out.print("Second number: "); System.out.flush();\n        double b = Double.parseDouble(in.nextLine().trim());\n        switch (op) {\n            case "+": System.out.println(a + b); break;\n            case "-": System.out.println(a - b); break;\n            case "*": System.out.println(a * b); break;\n            case "/": System.out.println(b != 0 ? String.valueOf(a / b) : "Can't divide by zero"); break;\n            default: System.out.println("Unknown operation");\n        }\n    }\n}\n`,
    'Times tables': n => `import java.util.Scanner;\n\npublic class ${n} {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.print("Which times table? "); System.out.flush();\n        int t = Integer.parseInt(in.nextLine().trim());\n        for (int i = 1; i <= 12; i++) System.out.printf("%2d x %d = %d%n", i, t, i * t);\n    }\n}\n`
  },
  c: {
    'Guess the number': `#include <stdio.h>\n#include <stdlib.h>\n#include <time.h>\n\nint main(void) {\n    srand((unsigned)time(NULL));\n    int secret = rand() % 100 + 1, guess = 0, tries = 0;\n    printf("I'm thinking of a number between 1 and 100.\\n");\n    while (guess != secret) {\n        printf("Your guess: ");\n        if (scanf("%d", &guess) != 1) return 1;\n        tries++;\n        if (guess < secret) printf("Higher!\\n");\n        else if (guess > secret) printf("Lower!\\n");\n    }\n    printf("Correct! You got it in %d tries.\\n", tries);\n    return 0;\n}\n`,
    'Calculator': `#include <stdio.h>\n\nint main(void) {\n    double a, b;\n    char op;\n    printf("Type a sum like 3 * 4: ");\n    if (scanf("%lf %c %lf", &a, &op, &b) != 3) return 1;\n    switch (op) {\n        case '+': printf("%g\\n", a + b); break;\n        case '-': printf("%g\\n", a - b); break;\n        case '*': printf("%g\\n", a * b); break;\n        case '/': if (b != 0) printf("%g\\n", a / b); else printf("Can't divide by zero\\n"); break;\n        default: printf("Unknown operation\\n");\n    }\n    return 0;\n}\n`,
    'Times tables': `#include <stdio.h>\n\nint main(void) {\n    int n;\n    printf("Which times table? ");\n    if (scanf("%d", &n) != 1) return 1;\n    for (int i = 1; i <= 12; i++) printf("%2d x %d = %d\\n", i, n, i * n);\n    return 0;\n}\n`
  },
  cpp: {
    'Guess the number': `#include <iostream>\n#include <random>\n\nint main() {\n    std::mt19937 rng(std::random_device{}());\n    int secret = std::uniform_int_distribution<int>(1, 100)(rng), guess = 0, tries = 0;\n    std::cout << "I'm thinking of a number between 1 and 100.\\n";\n    while (guess != secret) {\n        std::cout << "Your guess: ";\n        if (!(std::cin >> guess)) return 1;\n        ++tries;\n        if (guess < secret) std::cout << "Higher!\\n";\n        else if (guess > secret) std::cout << "Lower!\\n";\n    }\n    std::cout << "Correct! You got it in " << tries << " tries.\\n";\n}\n`,
    'Calculator': `#include <iostream>\n\nint main() {\n    double a, b;\n    char op;\n    std::cout << "Type a sum like 3 * 4: ";\n    if (!(std::cin >> a >> op >> b)) return 1;\n    switch (op) {\n        case '+': std::cout << a + b << "\\n"; break;\n        case '-': std::cout << a - b << "\\n"; break;\n        case '*': std::cout << a * b << "\\n"; break;\n        case '/': std::cout << (b != 0 ? std::to_string(a / b) : "Can't divide by zero") << "\\n"; break;\n        default: std::cout << "Unknown operation\\n";\n    }\n}\n`,
    'Times tables': `#include <iostream>\n#include <iomanip>\n\nint main() {\n    int n;\n    std::cout << "Which times table? ";\n    if (!(std::cin >> n)) return 1;\n    for (int i = 1; i <= 12; ++i) std::cout << std::setw(2) << i << " x " << n << " = " << i * n << "\\n";\n}\n`
  }
};

function javaClassName(raw) {
  let n = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (!n || /^[0-9]/.test(n)) n = 'Main' + n;
  return n[0].toUpperCase() + n.slice(1);
}

function uniquePath(dir, base, ext) {
  for (let i = 1; i < 1000; i++) {
    const p = path.join(dir, `${base}${i > 1 ? i : ''}.${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  throw new Error('Too many files');
}

// name: optional user-chosen file name (no extension needed). example: optional example title.
function createFile(lang, dir, name, example) {
  if (!EXT[lang]) throw new Error('Unknown language');
  let base = (name || '').trim().replace(/\.[A-Za-z0-9]+$/, '').replace(/[<>:"/\\|?*]/g, '');
  if (lang === 'java') base = javaClassName(base || (example ? example.replace(/(^|\s+)(\w)/g, (_m, _s, c) => c.toUpperCase()) : 'Main'));
  if (!base) base = example ? example.toLowerCase().replace(/\s+/g, '_') : 'hello';
  let p = path.join(dir, `${base}.${EXT[lang]}`);
  if (fs.existsSync(p)) {
    if (name) throw new Error(`${path.basename(p)} already exists`);
    p = uniquePath(dir, base, EXT[lang]);
  }
  const cls = path.basename(p).replace(/\.java$/, '');
  const src = example ? EXAMPLES[lang][example] : TEMPLATES[lang];
  if (!src) throw new Error('Unknown example');
  fs.writeFileSync(p, typeof src === 'function' ? src(cls) : src);
  return p;
}

function ensureWorkspace() {
  const def = path.join(app.getPath('documents'), 'CodeBox');
  workspace = settings.lastWorkspace && fs.existsSync(settings.lastWorkspace) ? settings.lastWorkspace : def;
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });
  // Makes C/C++ output appear immediately in the built-in terminal.
  fs.writeFileSync(HELPER, '#include <stdio.h>\n__attribute__((constructor)) static void cbx_unbuf(void) { setvbuf(stdout, NULL, _IONBF, 0); setvbuf(stderr, NULL, _IONBF, 0); }\n');
  if (!fs.readdirSync(workspace).length) createFile('python', workspace);
}

// ---------- shell
function killShell() {
  if (!sh) return;
  const p = sh; sh = null;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else p.kill('SIGKILL');
  } catch { /* ignore */ }
}

function startShell() {
  killShell();
  const env = freshEnv(true);
  const s = IS_WIN
    ? spawn('cmd.exe', ['/Q', '/K'], { cwd: workspace, env, windowsHide: true })
    : spawn('sh', [], { cwd: workspace, env });
  sh = s;
  s.stdout.on('data', d => { if (sh === s) send('shell:data', d.toString('utf8')); });
  s.stderr.on('data', d => { if (sh === s) send('shell:data', d.toString('utf8')); });
  s.on('error', e => send('shell:data', `Shell error: ${e.message}\n`));
  s.on('exit', () => { if (sh === s) { sh = null; send('shell:exit', null); } });
  if (IS_WIN) s.stdin.write('chcp 65001>nul\r\necho ::CBX::%CD%\r\n');
  else s.stdin.write('echo ::CBX::$PWD\n');
}

// ---------- maven (Java packages)
async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function mvnInstall(ws, g, a, v, seen, depth) {
  const key = `${g}:${a}`;
  if (seen.has(key)) return;
  seen.add(key);
  const base = `https://repo1.maven.org/maven2/${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}`;
  const libs = path.join(ws, 'libs');
  fs.mkdirSync(libs, { recursive: true });
  const jar = path.join(libs, `${a}-${v}.jar`);
  if (!fs.existsSync(jar)) {
    send('pkg:log', `Downloading ${g}:${a}:${v}\n`);
    try { fs.writeFileSync(jar, await fetchBuf(base + '.jar')); }
    catch (e) { send('pkg:log', `  skipped (${e.message})\n`); if (depth === 0) throw e; }
  } else send('pkg:log', `Already have ${a}-${v}.jar\n`);
  if (depth >= 4) return;
  let pom;
  try { pom = (await fetchBuf(base + '.pom')).toString('utf8'); } catch { return; }
  pom = pom.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
    .replace(/<build>[\s\S]*?<\/build>/g, '').replace(/<profiles>[\s\S]*?<\/profiles>/g, '');
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`)); return m ? m[1] : ''; };
  for (const m of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const d = m[1];
    const dg = tag(d, 'groupId'), da = tag(d, 'artifactId'), dv = tag(d, 'version');
    const scope = tag(d, 'scope') || 'compile';
    if (!dg || !da || !dv || /\$\{|[\[\(,]/.test(dg + da + dv)) continue;
    if (scope !== 'compile' && scope !== 'runtime') continue;
    if (tag(d, 'optional') === 'true') continue;
    try { await mvnInstall(ws, dg, da, dv, seen, depth + 1); } catch { /* best effort */ }
  }
}

// ---------- updates (GitHub Releases via electron-updater)
let updater = null;
let updState = { state: 'idle', version: null, percent: 0, message: '', notes: '' };
function setUpd(patch) { updState = { ...updState, ...patch }; send('upd:status', updState); }

function initUpdater() {
  if (!app.isPackaged) {
    setUpd({ state: 'unavailable', message: 'Updates work in the installed app, not when running from source.' });
    return;
  }
  try { updater = require('electron-updater').autoUpdater; }
  catch (e) { setUpd({ state: 'unavailable', message: 'Updater not available: ' + e.message }); return; }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpd({ state: 'checking', message: 'Checking for updates...' }));
  updater.on('update-available', i => setUpd({
    state: 'available', version: i.version, message: `Version ${i.version} is available.`,
    notes: typeof i.releaseNotes === 'string' ? i.releaseNotes.replace(/<[^>]+>/g, '').trim() : ''
  }));
  updater.on('update-not-available', () => setUpd({ state: 'latest', message: `You have the latest version (${app.getVersion()}).` }));
  updater.on('download-progress', p => setUpd({ state: 'downloading', percent: Math.round(p.percent), message: `Downloading... ${Math.round(p.percent)}%` }));
  updater.on('update-downloaded', i => setUpd({ state: 'ready', version: i.version, percent: 100, message: `Version ${i.version} is ready. Restart to finish updating.` }));
  updater.on('error', e => {
    const msg = String((e && e.message) || e);
    const friendly = /404|ENOTFOUND|net::|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(msg)
      ? "Couldn't reach the update server. Check your internet connection and try again."
      : 'Update failed: ' + msg.split('\n')[0];
    setUpd({ state: 'error', message: friendly });
  });
}
async function checkUpdates() {
  if (!updater) return updState;
  try { await updater.checkForUpdates(); } catch { /* reported via 'error' */ }
  return updState;
}

// ---------- IPC
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    path: workspace, helper: HELPER, vcpkgRoot: VCPKG_ROOT, version: app.getVersion(),
    packaged: app.isPackaged, settings, examples: Object.fromEntries(Object.entries(EXAMPLES).map(([k, v]) => [k, Object.keys(v)]))
  }));
  ipcMain.handle('settings:set', (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
  ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('open:folder', (_e, p) => shell.openPath(p || workspace));

  ipcMain.handle('ws:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: workspace });
    if (r.canceled || !r.filePaths[0]) return null;
    workspace = r.filePaths[0];
    settings.lastWorkspace = workspace; saveSettings();
    return workspace;
  });

  ipcMain.handle('fs:list', (_e, dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== '__pycache__')
        .map(d => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    } catch { return []; }
  });
  ipcMain.handle('fs:read', (_e, p) => fs.readFileSync(p, 'utf8'));
  ipcMain.handle('fs:write', (_e, p, text) => { fs.writeFileSync(p, text); return true; });
  ipcMain.handle('fs:new', (_e, lang, dir, name, example) => {
    try { return { ok: true, path: createFile(lang, dir || workspace, name, example) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('fs:rename', (_e, p, newName) => {
    newName = String(newName || '').trim();
    if (!newName || /[<>:"/\\|?*]/.test(newName)) return { ok: false, error: 'That name is not allowed.' };
    const np = path.join(path.dirname(p), newName);
    if (fs.existsSync(np)) return { ok: false, error: `${newName} already exists.` };
    fs.renameSync(p, np);
    return { ok: true, path: np };
  });
  ipcMain.handle('fs:delete', async (_e, p) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Delete ${path.basename(p)}?`, detail: 'It will be moved to the Recycle Bin.'
    });
    if (r.response !== 0) return false;
    try { await shell.trashItem(p); } catch { fs.rmSync(p, { force: true }); }
    return true;
  });

  ipcMain.handle('shell:start', () => { startShell(); return true; });
  ipcMain.on('shell:write', (_e, d) => { if (sh && sh.stdin.writable) sh.stdin.write(d); });

  ipcMain.handle('proc:run', (_e, { cmd, cwd }) => new Promise(resolve => {
    const p = spawn(cmd, { shell: true, cwd: cwd || workspace, env: freshEnv(true), windowsHide: true });
    p.stdout.on('data', d => send('pkg:log', d.toString('utf8')));
    p.stderr.on('data', d => send('pkg:log', d.toString('utf8')));
    p.on('error', e => { send('pkg:log', `Error: ${e.message}\n`); resolve(-1); });
    p.on('close', code => { send('pkg:log', code === 0 ? '\n[done]\n\n' : `\n[failed, exit code ${code}]\n\n`); resolve(code); });
  }));

  const ver = cmd => new Promise(resolve => {
    exec(cmd, { env: freshEnv(), timeout: 15000, windowsHide: true }, (err, so, se) => {
      if (err) return resolve(null);
      resolve(((so || se || '').split(/\r?\n/)[0] || 'installed').trim());
    });
  });
  ipcMain.handle('tool:check', async () => {
    freshEnv(true);
    const [python, java, gcc, gpp, git, winget] = await Promise.all([
      ver('python --version'), ver('javac -version'), ver('gcc --version'), ver('g++ --version'),
      ver('git --version'), IS_WIN ? ver('winget --version') : Promise.resolve(null)
    ]);
    return { python, java, gcc, gpp, git, winget };
  });

  ipcMain.handle('vcpkg:info', () => ({ installed: fs.existsSync(path.join(VCPKG_ROOT, IS_WIN ? 'vcpkg.exe' : 'vcpkg')) }));

  ipcMain.handle('maven:search', async (_e, q) => {
    const r = await fetch(`https://search.maven.org/solrsearch/select?q=${encodeURIComponent(q)}&rows=20&wt=json`);
    if (!r.ok) throw new Error(`Maven Central returned ${r.status}`);
    const j = await r.json();
    return (j.response.docs || []).map(d => ({ g: d.g, a: d.a, v: d.latestVersion }));
  });
  ipcMain.handle('maven:add', async (_e, ws, g, a, v) => {
    try {
      await mvnInstall(ws, g, a, v, new Set(), 0);
      send('pkg:log', '\n[done]\n\n');
      return true;
    } catch (e) {
      send('pkg:log', `\n[failed: ${e.message}]\n\n`);
      return false;
    }
  });
  ipcMain.handle('maven:list', (_e, ws) => {
    try { return fs.readdirSync(path.join(ws, 'libs')).filter(f => f.endsWith('.jar')).sort(); } catch { return []; }
  });
  ipcMain.handle('maven:remove', (_e, ws, jar) => {
    fs.rmSync(path.join(ws, 'libs', path.basename(jar)), { force: true });
    return true;
  });

  ipcMain.handle('upd:get', () => updState);
  ipcMain.handle('upd:check', () => checkUpdates());
  ipcMain.handle('upd:download', async () => {
    if (!updater) return updState;
    setUpd({ state: 'downloading', percent: 0, message: 'Starting download...' });
    try { await updater.downloadUpdate(); } catch { /* reported via 'error' */ }
    return updState;
  });
  ipcMain.handle('upd:install', () => {
    if (!updater || updState.state !== 'ready') return false;
    killShell();
    setImmediate(() => updater.quitAndInstall(true, true));   // silent install, then reopen CodeBox
    return true;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 820, minHeight: 520,
    backgroundColor: settings.theme === 'light' ? '#ffffff' : '#1e1e1e', title: 'CodeBox',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.once('did-finish-load', () => {
    if (updater && settings.autoCheckUpdates) setTimeout(checkUpdates, 4000);
  });

  if (process.env.CBX_TEST) {
    win.webContents.on('console-message', (...a) => console.log('[renderer]', a[2] !== undefined ? a[2] : (a[0] && a[0].message)));
    setTimeout(async () => {
      try {
        const out = await win.webContents.executeJavaScript('window.__cbxTest ? window.__cbxTest() : "no test hook"');
        console.log('[test]', JSON.stringify(out));
      } catch (e) { console.log('[test-error]', e.message); }
      app.quit();
    }, Number(process.env.CBX_TEST_MS || 12000));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadSettings();
    ensureWorkspace();
    registerIpc();
    initUpdater();
    createWindow();
  });
  app.on('before-quit', killShell);
  app.on('window-all-closed', () => app.quit());
}
