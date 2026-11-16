const { contextBridge, ipcRenderer } = require('electron');

const inv = ch => (...a) => ipcRenderer.invoke(ch, ...a);
const EVENTS = ['shell:data', 'shell:exit', 'pkg:log', 'upd:status'];

// Keep window.api for any legacy code paths
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  info: inv('app:info'),
  setSettings: inv('settings:set'),
  openExternal: inv('open:external'),
  openFolder: inv('open:folder'),
  pickFolder: inv('ws:pick'),
  recentFolders: inv('ws:recent'),
  openRecent: inv('ws:open'),
  list: inv('fs:list'),
  read: inv('fs:read'),
  write: inv('fs:write'),
  newFile: inv('fs:new'),
  rename: inv('fs:rename'),
  remove: inv('fs:delete'),
  shellStart: inv('shell:start'),
  shellWrite: d => ipcRenderer.send('shell:write', d),
  run: inv('proc:run'),
  check: inv('tool:check'),
  vcpkgInfo: inv('vcpkg:info'),
  mvnSearch: inv('maven:search'),
  mvnAdd: inv('maven:add'),
  mvnList: inv('maven:list'),
  mvnRemove: inv('maven:remove'),
  searchFiles: inv('search:files'),
  gitStatus: inv('git:status'),
  gitLog: inv('git:log'),
  gitDiff: inv('git:diff'),
  gitStage: inv('git:stage'),
  gitCommit: inv('git:commit'),
  gitPush: inv('git:push'),
  gitInit: inv('git:init'),
  quickOpen: inv('fs:quickopen'),
  todoScan: inv('todo:scan'),
  updGet: inv('upd:get'),
  updCheck: inv('upd:check'),
  updDownload: inv('upd:download'),
  updInstall: inv('upd:install'),
  on: (ch, fn) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); }
});

// window.cbx — unified API used by renderer.js v1.4.0
contextBridge.exposeInMainWorld('cbx', {
  platform: process.platform,

  // ---- app / settings
  getInfo:      inv('app:info'),
  setSettings:  inv('settings:set'),
  openExternal: inv('open:external'),

  // ---- workspace
  openFolder:    inv('ws:pick'),
  recentFolders: inv('ws:recent'),
  openRecent:    inv('ws:open'),

  // ---- file system
  readDir:    inv('fs:list'),
  readFile:   inv('fs:read'),
  writeFile:  inv('fs:write'),
  newFile:    inv('fs:new'),
  renameFile: inv('fs:rename'),
  deleteFile: inv('fs:delete'),

  // ---- file dialogs
  openFileDialog:   inv('dialog:open-file'),
  saveAsDialog:     inv('dialog:save-as'),
  openFolderDialog: inv('dialog:open-folder'),

  // ---- quick-open & todo
  quickOpen: inv('fs:quickopen'),
  todoScan:  inv('todo:scan'),

  // ---- terminal / shell
  termStart: inv('shell:start'),
  termInput: d => ipcRenderer.send('shell:write', d),

  // ---- run a file (streams to shell:data / shell:exit)
  runFile:  inv('run:file'),
  stopRun:  inv('run:stop'),

  // ---- search
  searchInFiles: async (ws, query) => {
    const results = await ipcRenderer.invoke('search:files', ws, query);
    // normalise: main returns {file, line(number), text} → renderer expects {file, lineNum, line(text)}
    if (!Array.isArray(results)) return [];
    return results.map(r => ({ file: r.file, lineNum: r.line, line: r.text }));
  },

  // ---- git
  gitStatus: inv('git:status'),
  gitLog:    inv('git:log'),
  gitDiff:   inv('git:diff'),
  gitStage:  inv('git:stage'),
  gitCommit: inv('git:commit'),
  gitPush:   inv('git:push'),
  gitInit:   inv('git:init'),

  // ---- tool check — normalise to {python:'ok'|'miss', python_ver, java:'ok'|'miss', ...}
  checkSetup: async () => {
    const r = await ipcRenderer.invoke('tool:check');
    const norm = (v) => (v && v !== 'missing') ? 'ok' : 'miss';
    return {
      python:     norm(r.python),  python_ver:  r.python  || '',
      java:       norm(r.java),    java_ver:    r.java    || '',
      gcc:        norm(r.gcc),     gcc_ver:     r.gcc     || '',
      gpp:        norm(r.gpp),     gpp_ver:     r.gpp     || '',
      git:        norm(r.git),     git_ver:     r.git     || '',
      node:       norm(r.node),    node_ver:    r.node    || '',
      winget:     norm(r.winget),  winget_ver:  r.winget  || '',
    };
  },

  // ---- pip
  pipInstall: inv('pip:install'),
  pipRemove:  inv('pip:remove'),
  pipList:    inv('pip:list'),
  pipReq:     inv('pip:req'),

  // ---- tool install (winget) — both names
  toolInstall:  inv('tool:install'),
  installTool:  inv('tool:install'),

  // ---- show in OS explorer — both names
  openPath:       inv('shell:open-path'),
  showInExplorer: inv('shell:open-path'),

  // ---- open a file via dialog (alias used by renderer)
  openFile: inv('dialog:open-file'),

  // ---- save-as alias
  saveAs: inv('dialog:save-as'),

  // ---- restart terminal (kill + relaunch shell)
  restartTerm: inv('shell:start'),

  // ---- app version helper
  getVersion: async () => { const i = await ipcRenderer.invoke('app:info'); return i && i.version ? i.version : ''; },

  // ---- updater progress event alias
  onUpdProgress: fn => ipcRenderer.on('upd:status', (_e, d) => fn(d)),

  // ---- updater
  updGet:      inv('upd:get'),
  updCheck:    inv('upd:check'),
  updDownload: inv('upd:download'),
  updInstall:  inv('upd:install'),

  // ---- event subscriptions
  onTermOutput:  fn => ipcRenderer.on('shell:data',  (_e, d) => fn(d)),
  onRunFinished: fn => ipcRenderer.on('shell:exit',  (_e, d) => fn(d)),
  onPkgLog:      fn => ipcRenderer.on('pkg:log',     (_e, d) => fn(d)),
  onUpdStatus:   fn => ipcRenderer.on('upd:status',  (_e, d) => fn(d)),

  // generic on() kept for compatibility
  on: (ch, fn) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); }
});
