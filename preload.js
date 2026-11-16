const { contextBridge, ipcRenderer } = require('electron');

const inv = ch => (...a) => ipcRenderer.invoke(ch, ...a);
const EVENTS = ['shell:data', 'shell:exit', 'pkg:log', 'upd:status'];

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
  updGet: inv('upd:get'),
  updCheck: inv('upd:check'),
  updDownload: inv('upd:download'),
  updInstall: inv('upd:install'),
  on: (ch, fn) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); }
});
