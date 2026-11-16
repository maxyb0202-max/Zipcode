'use strict';
/* ── CodeBox v1.4.0 renderer ─────────────────────────────────── */

const { cbx } = window;

/* ── Monaco ──────────────────────────────────────────────────── */
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

let editor, terminalObj, fitAddon;
let currentFile = null;
let currentLang  = 'python';
let tabs         = [];          // [{id,path,name,dirty,model}]
let activeTabId  = null;
let ws           = null;        // workspace folder
let runTimerId   = null;
let runStart     = null;
let settings     = {};
let recentWorkspaces = [];
let splitH       = 220;
const MIN_SPLIT  = 36;

/* ── Default settings ─────────────────────────────────────────── */
const DEF = {
  theme: 'dark', fontSize: 14, wrap: false,
  minimap: false, autoSave: false, updCheck: true,
  formatOnSave: false,
};

/* ── Init ─────────────────────────────────────────────────────── */
require(['vs/editor/editor.main'], () => {
  defineThemes();
  loadSettings();
  initTerminal();
  loadSplitPref();
  wire();
  showWelcome();
  if (settings.updCheck) cbx.updGet();
  cbx.getVersion().then(v => {
    document.getElementById('sbVer').textContent = 'v' + v;
    document.getElementById('updCur').textContent = v;
  });
});

/* ═════════════════════════════════════════════════════════════════
   THEMES
══════════════════════════════════════════════════════════════════*/
function defineThemes() {
  monaco.editor.defineTheme('cbx-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '555e72', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7eb8f5', fontStyle: 'bold' },
      { token: 'string',  foreground: 'a0d080' },
      { token: 'number',  foreground: 'e8b060' },
      { token: 'type',    foreground: '78d8c8' },
    ],
    colors: { 'editor.background': '#14161b', 'editor.foreground': '#c8ccd8', 'editorLineNumber.foreground': '#4a5068', 'editorLineNumber.activeForeground': '#7c8498', 'editor.selectionBackground': '#1b2d50', 'editor.lineHighlightBackground': '#1c1f27' },
  });
  monaco.editor.defineTheme('cbx-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '7a8498', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1a4fa0', fontStyle: 'bold' },
      { token: 'string',  foreground: '1e7a40' },
      { token: 'number',  foreground: '8a4000' },
    ],
    colors: { 'editor.background': '#f8f9fb', 'editor.foreground': '#1e2130', 'editorLineNumber.foreground': '#9499b0', 'editor.lineHighlightBackground': '#f0f1f4', 'editor.selectionBackground': '#d4dcff' },
  });
  monaco.editor.defineTheme('cbx-monokai', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'f92672', fontStyle: 'bold' },
      { token: 'string',  foreground: 'e6db74' },
      { token: 'number',  foreground: 'ae81ff' },
      { token: 'type',    foreground: '66d9e8' },
    ],
    colors: { 'editor.background': '#272822', 'editor.foreground': '#f8f8f2', 'editorLineNumber.foreground': '#605e50', 'editor.lineHighlightBackground': '#2d2e28', 'editor.selectionBackground': '#374020' },
  });
  monaco.editor.defineTheme('cbx-nord', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '555e72', fontStyle: 'italic' },
      { token: 'keyword', foreground: '81a1c1', fontStyle: 'bold' },
      { token: 'string',  foreground: 'a3be8c' },
      { token: 'number',  foreground: 'b48ead' },
      { token: 'type',    foreground: '8fbcbb' },
    ],
    colors: { 'editor.background': '#2e3440', 'editor.foreground': '#d8dee9', 'editorLineNumber.foreground': '#555e72', 'editor.lineHighlightBackground': '#353c4a', 'editor.selectionBackground': '#334060' },
  });
  monaco.editor.defineTheme('cbx-github', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf222e', fontStyle: 'bold' },
      { token: 'string',  foreground: '0a3069' },
      { token: 'number',  foreground: '0550ae' },
    ],
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#1f2328', 'editorLineNumber.foreground': '#adb5bd', 'editor.lineHighlightBackground': '#f6f8fa', 'editor.selectionBackground': '#b6e3ff' },
  });
}

const THEME_MAP = {
  'dark': 'cbx-dark', 'light': 'cbx-light', 'monokai': 'cbx-monokai',
  'nord': 'cbx-nord', 'github-light': 'cbx-github',
};

/* ═════════════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════════════*/
function loadSettings() {
  const raw = localStorage.getItem('cbx-settings');
  settings = raw ? { ...DEF, ...JSON.parse(raw) } : { ...DEF };
  recentWorkspaces = JSON.parse(localStorage.getItem('cbx-recent') || '[]');
  applySettings();
  loadSettingsUI();
}
function saveSettings() {
  localStorage.setItem('cbx-settings', JSON.stringify(settings));
}
function applySettings() {
  const th = settings.theme || 'dark';
  document.body.className = th;
  if (editor) {
    monaco.editor.setTheme(THEME_MAP[th] || 'cbx-dark');
    editor.updateOptions({
      fontSize: settings.fontSize || 14,
      wordWrap: settings.wrap ? 'on' : 'off',
      minimap: { enabled: !!settings.minimap },
    });
  }
}
function loadSettingsUI() {
  const s = settings;
  q('#setFont').value  = s.fontSize || 14;
  q('#setFontVal').textContent = (s.fontSize || 14) + 'px';
  q('#setWrap').checked    = !!s.wrap;
  q('#setMinimap').checked = !!s.minimap;
  q('#setAuto').checked    = !!s.autoSave;
  q('#setUpd').checked     = s.updCheck !== false;
  q('#setFmtSave').checked = !!s.formatOnSave;
  q('#setWs').textContent  = ws || '(no folder open)';
  const seg = q('#setTheme');
  seg.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === s.theme);
  });
  renderRecentList();
}
function renderRecentList() {
  const list = q('#recentList');
  if (!list) return;
  list.innerHTML = recentWorkspaces.length
    ? recentWorkspaces.map((p, i) => `<div class="recentItem" data-idx="${i}"><span class="rp" title="${p}">${p}</span><button class="mini" data-rm="${i}" title="Remove">×</button></div>`).join('')
    : '<div style="padding:8px;font-size:12px;color:var(--text3)">No recent projects</div>';
  list.querySelectorAll('[data-rm]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    recentWorkspaces.splice(+b.dataset.rm, 1);
    localStorage.setItem('cbx-recent', JSON.stringify(recentWorkspaces));
    renderRecentList();
    renderWelcomeRecent();
  });
  list.querySelectorAll('[data-idx]').forEach(b => {
    if (!b.dataset.rm) b.onclick = () => openFolder(recentWorkspaces[+b.dataset.idx]);
  });
}
function addRecent(dir) {
  recentWorkspaces = [dir, ...recentWorkspaces.filter(x => x !== dir)].slice(0, 10);
  localStorage.setItem('cbx-recent', JSON.stringify(recentWorkspaces));
}

/* ═════════════════════════════════════════════════════════════════
   EDITOR CREATION
══════════════════════════════════════════════════════════════════*/
function createEditor() {
  if (editor) return;
  const th = settings.theme || 'dark';
  editor = monaco.editor.create(document.getElementById('editor'), {
    language: currentLang,
    theme: THEME_MAP[th] || 'cbx-dark',
    fontSize: settings.fontSize || 14,
    wordWrap: settings.wrap ? 'on' : 'off',
    minimap: { enabled: !!settings.minimap },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10 },
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    stickyScroll: { enabled: true },
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    formatOnPaste: true,
  });

  editor.onDidChangeCursorPosition(e => {
    q('#sbPos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    updateBreadcrumb();
  });
  editor.onDidChangeModelContent(() => {
    if (activeTabId) markDirty(activeTabId);
    if (settings.autoSave) scheduleAutoSave();
    updateWordCount();
    if (settings.formatOnSave === false) parseAndUpdateProblems();
  });
  applySettings();
}

function updateWordCount() {
  if (!editor) return;
  const v = editor.getValue();
  const words = v.trim() ? v.trim().split(/\s+/).length : 0;
  const lines = editor.getModel()?.getLineCount() || 0;
  q('#sbCount').textContent = `${lines} lines  ${words} words`;
}

let autoSaveTimer;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { if (currentFile) saveFile(); }, 1200);
}

/* ═════════════════════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════════════════════*/
function newTab(path, name, content, lang) {
  const id = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const model = monaco.editor.createModel(content, lang || 'plaintext');
  tabs.push({ id, path, name, dirty: false, model });
  renderTabs();
  activateTab(id);
  return id;
}
function activateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (!editor) createEditor();
  editor.setModel(tab.model);
  activeTabId = id;
  currentFile = tab.path;
  currentLang = tab.model.getLanguageId();
  q('#sbLang').textContent = langLabel(currentLang);
  monaco.editor.setTheme(THEME_MAP[settings.theme || 'dark'] || 'cbx-dark');
  renderTabs();
  updateBreadcrumb();
  updateWordCount();
  hideWelcome();
  editor.focus();
}
function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (tab.dirty) { if (!confirm(`Close "${tab.name}" without saving?`)) return; }
  tab.model.dispose();
  tabs = tabs.filter(t => t.id !== id);
  if (activeTabId === id) {
    if (tabs.length) activateTab(tabs[tabs.length - 1].id);
    else { activeTabId = null; currentFile = null; showWelcome(); }
  }
  renderTabs();
}
function markDirty(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab && !tab.dirty) { tab.dirty = true; renderTabs(); }
}
function markClean(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab) { tab.dirty = false; renderTabs(); }
}
function renderTabs() {
  const bar = q('#tabs');
  bar.innerHTML = tabs.map(t => `
    <div class="tab${t.id === activeTabId ? ' active' : ''}" data-id="${t.id}" title="${t.path || t.name}">
      ${t.dirty ? '<span class="dot-unsaved"></span>' : ''}
      <span class="tname">${esc(t.name)}</span>
      <button class="tbtn" data-close="${t.id}" title="Close">&times;</button>
    </div>`).join('');
  bar.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', e => { if (!e.target.closest('[data-close]')) activateTab(el.dataset.id); });
  });
  bar.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', e => { e.stopPropagation(); closeTab(b.dataset.close); });
  });
}

/* ═════════════════════════════════════════════════════════════════
   BREADCRUMB
══════════════════════════════════════════════════════════════════*/
function updateBreadcrumb() {
  const bc = q('#breadcrumb');
  if (!bc) return;
  if (!currentFile) { bc.innerHTML = ''; return; }
  const rel = ws && currentFile.startsWith(ws) ? currentFile.slice(ws.length).replace(/^[/\\]/, '') : currentFile;
  const parts = rel.split(/[/\\]/);
  bc.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    return (i > 0 ? '<span class="sep">/</span>' : '') +
      `<span${isLast ? ' class="active"' : ''}>${esc(p)}</span>`;
  }).join('');
}

/* ═════════════════════════════════════════════════════════════════
   FILE I/O
══════════════════════════════════════════════════════════════════*/
async function openFile(filePath) {
  const existing = tabs.find(t => t.path === filePath);
  if (existing) { activateTab(existing.id); return; }
  const content = await cbx.readFile(filePath);
  if (content === null) { toast('Could not read file', true); return; }
  const name = filePath.split(/[/\\]/).pop();
  const lang = detectLang(name);
  newTab(filePath, name, content, lang);
}
async function saveFile(path) {
  const fp = path || currentFile;
  if (!fp || !editor || activeTabId === null) return;
  if (settings.formatOnSave) {
    await editor.getAction('editor.action.formatDocument')?.run();
  }
  const ok = await cbx.writeFile(fp, editor.getValue());
  if (ok) { markClean(activeTabId); toast('Saved'); updateWordCount(); parseAndUpdateProblems(); }
  else toast('Save failed', true);
}
async function saveFileAs() {
  const fp = await cbx.saveAs(currentFile || null);
  if (!fp) return;
  currentFile = fp;
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) { tab.path = fp; tab.name = fp.split(/[/\\]/).pop(); renderTabs(); }
  await saveFile(fp);
  updateBreadcrumb();
}
async function openFolder(dir) {
  if (!dir) dir = await cbx.openFolder();
  if (!dir) return;
  ws = dir;
  addRecent(dir);
  q('#wsname').textContent = dir.split(/[/\\]/).pop();
  q('#sbFolder').textContent = dir.split(/[/\\]/).pop();
  q('#setWs').textContent = dir;
  refreshTree();
  refreshGitBranch();
  renderWelcomeRecent();
  toast('Opened: ' + dir.split(/[/\\]/).pop());
}
async function refreshTree() {
  if (!ws) return;
  const items = await cbx.readDir(ws);
  const tree = q('#tree');
  if (!items) { tree.innerHTML = '<div class="treeItem" style="color:var(--red)">Cannot read folder</div>'; return; }
  renderTreeItems(tree, items, ws, 0);
}
function renderTreeItems(container, items, base, depth) {
  const files = [], dirs = [];
  items.forEach(it => (it.isDir ? dirs : files).push(it));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  container.innerHTML = '';
  [...dirs, ...files].forEach(it => {
    const fp = base + '/' + it.name;
    const el = document.createElement('div');
    el.className = 'treeItem' + (it.isDir ? ' dir' : '') + (currentFile === fp ? ' active' : '');
    el.style.paddingLeft = (10 + depth * 14) + 'px';
    el.innerHTML = `<svg style="color:${it.isDir ? 'var(--accent)' : 'var(--text3)'}"><use href="${it.isDir ? '#i-folder' : '#i-file'}"/></svg>${esc(it.name)}`;
    if (it.isDir) {
      el.addEventListener('click', async () => {
        if (el._open) { el._open = false; el._sub?.remove(); el._sub = null; return; }
        el._open = true;
        const sub = document.createElement('div');
        el._sub = sub;
        const children = await cbx.readDir(fp);
        if (children) renderTreeItems(sub, children, fp, depth + 1);
        el.after(sub);
      });
    } else {
      el.addEventListener('click', () => openFile(fp));
    }
    container.appendChild(el);
  });
}

/* ═════════════════════════════════════════════════════════════════
   QUICK OPEN  (Ctrl+P)
══════════════════════════════════════════════════════════════════*/
let qoFiles = [];
function showQuickOpen() {
  if (!ws) { toast('Open a folder first'); return; }
  q('#qopen').classList.remove('hidden');
  q('#qoInput').value = '';
  q('#qoList').innerHTML = '';
  q('#qoHint').classList.remove('hidden');
  q('#qoInput').focus();
  if (!qoFiles.length) {
    cbx.quickOpen(ws).then(files => { qoFiles = files || []; renderQoList(''); });
  } else {
    renderQoList('');
  }
}
function hideQuickOpen() {
  q('#qopen').classList.add('hidden');
  if (editor) editor.focus();
}
function renderQoList(query) {
  const list = q('#qoList');
  const hint = q('#qoHint');
  const q2 = query.toLowerCase();
  let items = qoFiles;
  if (q2) {
    items = qoFiles.map(f => ({ ...f, score: fuzzScore(f.rel.toLowerCase(), q2) }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  } else {
    items = qoFiles.slice(0, 30);
  }
  hint.classList.toggle('hidden', items.length > 0);
  list.innerHTML = items.map((f, i) =>
    `<div class="qoItem${i === 0 ? ' sel' : ''}" data-full="${esc(f.full)}" data-idx="${i}">
      <div>
        <div class="qname">${highlightFuzz(esc(f.name), q2)}</div>
        <div class="qpath">${esc(f.rel)}</div>
      </div>
    </div>`).join('');
  list.querySelectorAll('.qoItem').forEach(el => {
    el.addEventListener('click', () => { hideQuickOpen(); openFile(el.dataset.full); });
    el.addEventListener('mouseenter', () => {
      list.querySelectorAll('.qoItem').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
    });
  });
}
function fuzzScore(str, query) {
  let si = 0, qi = 0, score = 0, consec = 0;
  for (; si < str.length && qi < query.length; si++) {
    if (str[si] === query[qi]) { qi++; consec++; score += consec; } else consec = 0;
  }
  return qi === query.length ? score : 0;
}
function highlightFuzz(html, query) {
  if (!query) return html;
  return html.replace(new RegExp(`(${[...query].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'),
    m => `<mark>${m}</mark>`);
}

/* ═════════════════════════════════════════════════════════════════
   FIND IN FILES
══════════════════════════════════════════════════════════════════*/
async function runSearch() {
  const q2 = q('#searchQuery').value.trim();
  if (!q2 || !ws) return;
  const res = await cbx.searchInFiles(ws, q2);
  const container = q('#searchResults');
  if (!res || !res.length) { container.innerHTML = '<div class="srFile" style="color:var(--text3)">No results</div>'; return; }
  const grouped = {};
  res.forEach(r => {
    if (!grouped[r.file]) grouped[r.file] = [];
    grouped[r.file].push(r);
  });
  container.innerHTML = Object.entries(grouped).map(([file, matches]) => {
    const rel = ws && file.startsWith(ws) ? file.slice(ws.length + 1) : file;
    const lines = matches.map(m => {
      const hi = esc(m.line).replace(new RegExp(esc(q2), 'gi'), s => `<mark>${s}</mark>`);
      return `<div class="srLine" data-file="${esc(file)}" data-ln="${m.lineNum}">${m.lineNum}: ${hi}</div>`;
    }).join('');
    return `<div class="srFile" data-file="${esc(file)}">${esc(rel)}</div>${lines}`;
  }).join('');
  container.querySelectorAll('[data-file]').forEach(el => {
    el.addEventListener('click', () => {
      const ln = el.dataset.ln ? +el.dataset.ln : 1;
      openFile(el.dataset.file).then(() => {
        if (editor && ln) editor.revealLineInCenter(ln);
      });
    });
  });
}

/* ═════════════════════════════════════════════════════════════════
   GIT
══════════════════════════════════════════════════════════════════*/
async function refreshGitBranch() {
  if (!ws) return;
  const info = await cbx.gitStatus(ws);
  if (!info) return;
  const branch = info.branch || 'detached';
  q('#gitBranch').textContent = branch;
  q('#sbBranch').textContent  = branch;
  q('#sbBranch').classList.toggle('hidden', !info.branch);
  renderGitFiles(info.files || []);
  const dot = q('#gitDot');
  dot.classList.toggle('hidden', !(info.files && info.files.length));
}
function renderGitFiles(files) {
  const container = q('#gitFiles');
  container.innerHTML = files.length
    ? files.map(f => {
        const st = f.status || 'M';
        return `<div class="gitFile">
          <input type="checkbox"${f.staged ? ' checked' : ''} data-file="${esc(f.name)}">
          <span class="gitStatus ${st}">${st}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${esc(f.name)}">${esc(f.name.split(/[/\\]/).pop())}</span>
        </div>`;
      }).join('')
    : '<div style="padding:12px;font-size:12px;color:var(--text3)">No changes</div>';
}
async function refreshGitPanel() {
  refreshGitBranch();
  const info = await cbx.gitLog(ws);
  const logEl = q('#gitLog');
  logEl.innerHTML = (info || []).map(c =>
    `<div class="gitCommit"><span class="hash">${esc(c.hash.slice(0,7))}</span><span class="msg">${esc(c.msg)}</span></div>`
  ).join('');
}
async function doGitCommit() {
  const msg = q('#gitMsg').value.trim();
  if (!msg) { toast('Enter a commit message', true); return; }
  const checkedFiles = [...q('#gitFiles').querySelectorAll('input:checked')].map(x => x.dataset.file);
  if (checkedFiles.length) {
    for (const f of checkedFiles) await cbx.gitStage(ws, f);
  }
  const ok = await cbx.gitCommit(ws, msg);
  if (ok) { q('#gitMsg').value = ''; toast('Committed'); refreshGitPanel(); }
  else toast('Commit failed', true);
}
async function doGitPush() {
  toast('Pushing…');
  const ok = await cbx.gitPush(ws);
  if (ok) toast('Pushed'); else toast('Push failed', true);
}
async function doGitDiff() {
  if (!ws) return;
  const diff = await cbx.gitDiff(ws, currentFile);
  if (!diff) { toast('No diff'); return; }
  const tab = tabs.find(t => t.id === activeTabId);
  const name = tab ? 'DIFF: ' + tab.name : 'Diff';
  const model = monaco.editor.createModel(diff, 'diff');
  tabs.push({ id: 'diff_' + Date.now(), path: null, name, dirty: false, model });
  renderTabs();
  activateTab(tabs[tabs.length - 1].id);
}

/* ═════════════════════════════════════════════════════════════════
   TODO PANEL
══════════════════════════════════════════════════════════════════*/
async function refreshTodo() {
  if (!ws) { toast('Open a folder first'); return; }
  q('#todoResults').innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text3)">Scanning…</div>';
  const results = await cbx.todoScan(ws);
  const dot = q('#todoDot');
  dot.classList.toggle('hidden', !(results && results.length));
  if (!results || !results.length) {
    q('#todoResults').innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text3)">No TODOs found 🎉</div>';
    return;
  }
  const grouped = {};
  results.forEach(r => {
    const short = ws && r.file.startsWith(ws) ? r.file.slice(ws.length + 1) : r.file;
    if (!grouped[short]) grouped[short] = { full: r.file, items: [] };
    grouped[short].items.push(r);
  });
  q('#todoResults').innerHTML = Object.entries(grouped).map(([rel, g]) =>
    `<div class="todoGroup">${esc(rel)} <span style="color:var(--text3)">(${g.items.length})</span></div>` +
    g.items.map(r =>
      `<div class="todoItem" data-file="${esc(r.file)}" data-ln="${r.line}">
        <span class="todoKind ${r.kind}">${r.kind}</span>
        <span class="todoText">${esc(r.text)}</span>
        <span class="todoLine">:${r.line}</span>
      </div>`).join('')
  ).join('');
  q('#todoResults').querySelectorAll('.todoItem').forEach(el => {
    el.addEventListener('click', () => {
      openFile(el.dataset.file).then(() => {
        if (editor) editor.revealLineInCenter(+el.dataset.ln);
      });
    });
  });
}

/* ═════════════════════════════════════════════════════════════════
   PROBLEMS PANEL
══════════════════════════════════════════════════════════════════*/
function parseProblems(text) {
  const probs = [];
  const patterns = [
    // Python: "  File "foo.py", line 42"
    /File "([^"]+)", line (\d+)/g,
    // GCC/G++: "foo.c:5:3: error:"
    /^([^:]+\.(?:c|cpp|h|java|py)(?:\.h)?):(\d+):\d+:\s*(error|warning):\s*(.+)/gm,
    // Java javac: "foo.java:12: error:"
    /^([^:]+\.java):(\d+):\s*error:\s*(.+)/gm,
  ];
  patterns.forEach(re => {
    let m;
    while ((m = re.exec(text)) !== null) {
      probs.push({ file: m[1], line: +m[2], msg: (m[4] || m[3] || '').trim(), sev: (m[3] === 'warning') ? 'warn' : 'err' });
    }
  });
  return probs;
}
function updateProblems(text) {
  const probs = parseProblems(text);
  const badge = q('#problemCount');
  badge.textContent = probs.length;
  badge.classList.toggle('hidden', !probs.length);
  renderProblemsPane(probs);
}
function parseAndUpdateProblems() {
  // only parse if problems pane is visible
  const pane = q('#problemsPane');
  if (!pane || pane.classList.contains('hidden')) return;
  updateProblems(q('#problemsPane').dataset.lastText || '');
}
function renderProblemsPane(probs) {
  const pane = q('#problemsPane');
  if (!probs.length) { pane.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text3)">No problems detected</div>'; return; }
  pane.innerHTML = probs.map(p =>
    `<div class="probItem ${p.sev}" data-file="${esc(p.file)}" data-ln="${p.line}">
      <span class="psev">${p.sev === 'err' ? 'Error' : 'Warning'}</span>
      <div><div class="probFile">${esc(p.file.split(/[/\\]/).pop())}<span class="probLine">:${p.line}</span></div><div class="probMsg">${esc(p.msg)}</div></div>
    </div>`).join('');
  pane.querySelectorAll('.probItem').forEach(el => {
    el.addEventListener('click', () => {
      openFile(el.dataset.file).then(() => { if (editor) editor.revealLineInCenter(+el.dataset.ln); });
    });
  });
}

/* ═════════════════════════════════════════════════════════════════
   TERMINAL
══════════════════════════════════════════════════════════════════*/
function initTerminal() {
  terminalObj = new Terminal({
    fontFamily: "'Cascadia Code','JetBrains Mono',Consolas,monospace",
    fontSize: 12,
    theme: termTheme(),
    convertEol: true,
    scrollback: 2000,
    cursorBlink: true,
  });
  fitAddon = new FitAddon.FitAddon();
  terminalObj.loadAddon(fitAddon);
  terminalObj.open(document.getElementById('term'));
  fitAddon.fit();
  terminalObj.writeln('\x1b[32mCodeBox v1.4.0 — terminal ready\x1b[0m');
  cbx.onTermOutput((_e, data) => {
    terminalObj.write(data);
    updateProblems(data);
    q('#problemsPane').dataset.lastText = (q('#problemsPane').dataset.lastText || '') + data;
  });
  cbx.onRunFinished((_e, code) => {
    stopRunTimer();
    const ok = code === 0;
    terminalObj.writeln(`\x1b[${ok ? '32' : '31'}m\n── Exited with code ${code} ──\x1b[0m`);
    q('#btnRun').disabled = false;
    q('#btnStop').disabled = true;
    setSbRun(ok ? 'idle' : 'error', ok ? 'Ready' : 'Error');
  });
  terminalObj.onData(d => cbx.termInput(d));
}
function termTheme() {
  const dark = { background: '#14161b', foreground: '#c8ccd8', cursor: '#7c8498', selectionBackground: '#1b2d50', black: '#14161b', red: '#f26a6a', green: '#5ad17e', yellow: '#e8d060', blue: '#7eb8f5', magenta: '#b48df0', cyan: '#60c8d8', white: '#c8ccd8', brightBlack: '#4a5068', brightRed: '#ff8080', brightGreen: '#76e89a', brightYellow: '#ffe080', brightBlue: '#90c8ff', brightMagenta: '#c8a0ff', brightCyan: '#78e0f0', brightWhite: '#e8eaee' };
  return dark;
}

/* ═════════════════════════════════════════════════════════════════
   RUN
══════════════════════════════════════════════════════════════════*/
async function runCode() {
  if (!editor) return;
  await saveFile();
  if (!currentFile) { toast('Save the file first', true); return; }
  q('#btnRun').disabled = true;
  q('#btnStop').disabled = false;
  q('#problemsPane').dataset.lastText = '';
  updateProblems('');
  switchPanelTab('terminal');
  terminalObj.writeln(`\x1b[36m\n── Run: ${currentFile.split(/[/\\]/).pop()} ──\x1b[0m`);
  startRunTimer(currentFile.split(/[/\\]/).pop());
  setSbRun('running', 'Running…');
  cbx.runFile(currentFile, currentLang);
}
function startRunTimer(name) {
  runStart = Date.now();
  clearInterval(runTimerId);
  runTimerId = setInterval(() => {
    const s = ((Date.now() - runStart) / 1000).toFixed(1);
    q('#runState').textContent = `Running ${s}s`;
    q('#sbRunText').textContent = `Running ${s}s`;
  }, 200);
}
function stopRunTimer() {
  clearInterval(runTimerId);
  runTimerId = null;
  if (runStart) {
    const s = ((Date.now() - runStart) / 1000).toFixed(1);
    q('#runState').textContent = `Done ${s}s`;
    q('#sbRunText').textContent = `Done ${s}s`;
    runStart = null;
  }
}
function setSbRun(cls, text) {
  q('#sbRun').className = cls;
  q('#sbRunText').textContent = text;
  q('#runState').className = 'pill ' + (cls === 'running' ? 'running' : 'idle');
  q('#runState').textContent = text;
}

/* ═════════════════════════════════════════════════════════════════
   PANEL TABS
══════════════════════════════════════════════════════════════════*/
function switchPanelTab(tab) {
  const isTerminal = tab === 'terminal';
  q('#termwrap').classList.toggle('hidden', !isTerminal);
  q('#problemsPane').classList.toggle('hidden', isTerminal);
  q('#tabTerminal').classList.toggle('on', isTerminal);
  q('#tabProblems').classList.toggle('on', !isTerminal);
  if (isTerminal && fitAddon) fitAddon.fit();
}

/* ═════════════════════════════════════════════════════════════════
   SIDE PANEL SWITCHING
══════════════════════════════════════════════════════════════════*/
function switchPanel(id) {
  ['sideExplorer','sideSearch','sideGit','sideTodo'].forEach(p => q('#' + p).classList.toggle('hidden', p !== id));
  ['railExplorer','railSearch','railGit','railTodo'].forEach(r => {
    const btn = q('#' + r);
    if (btn) btn.classList.toggle('on', r === 'rail' + id.charAt(4).toUpperCase() + id.slice(5));
  });
  if (id === 'sideGit') refreshGitPanel();
  if (id === 'sideTodo') refreshTodo();
}

/* ═════════════════════════════════════════════════════════════════
   SPLITTER
══════════════════════════════════════════════════════════════════*/
function loadSplitPref() {
  splitH = +localStorage.getItem('cbx-split') || 220;
  applySplit();
}
function applySplit() {
  q('#panel').style.height = splitH + 'px';
  if (fitAddon) fitAddon.fit();
}
function initSplitter() {
  const sp = q('#splitter');
  let startY, startH;
  sp.addEventListener('mousedown', e => {
    startY = e.clientY; startH = splitH;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  function onMove(e) {
    splitH = Math.max(MIN_SPLIT, startH - (e.clientY - startY));
    applySplit();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    localStorage.setItem('cbx-split', splitH);
    if (fitAddon) fitAddon.fit();
  }
}

/* ═════════════════════════════════════════════════════════════════
   WELCOME
══════════════════════════════════════════════════════════════════*/
function showWelcome() {
  if (tabs.length) return;
  q('#welcome').classList.remove('hidden');
  renderWelcomeRecent();
  renderLangCards();
}
function hideWelcome() { q('#welcome').classList.add('hidden'); }
function renderWelcomeRecent() {
  const list = q('#wRecentList');
  const section = q('#wRecentSection');
  if (!list) return;
  if (!recentWorkspaces.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = recentWorkspaces.slice(0, 5).map(p =>
    `<div class="wRecentItem" data-p="${esc(p)}">
      <svg><use href="#i-folder"/></svg>
      <div>
        <div class="rname">${esc(p.split(/[/\\]/).pop())}</div>
        <div class="rpath">${esc(p)}</div>
      </div>
    </div>`).join('');
  list.querySelectorAll('.wRecentItem').forEach(el => {
    el.addEventListener('click', () => openFolder(el.dataset.p));
  });
}
function renderLangCards() {
  const cards = q('#langCards');
  if (!cards) return;
  const langs = [
    { key: 'python', label: 'Python', fi: 'py', desc: 'Beginner-friendly' },
    { key: 'java',   label: 'Java',   fi: 'java', desc: 'Object-oriented' },
    { key: 'c',      label: 'C',      fi: 'cpp', desc: 'Low-level, fast' },
    { key: 'cpp',    label: 'C++',    fi: 'cpp', desc: 'Systems & games' },
  ];
  cards.innerHTML = langs.map(l =>
    `<button class="langCard" data-lang="${l.key}">
      <div class="fi ${l.fi}">${l.label[0]}</div>
      <span>${l.label}</span>
      <span class="ldesc">${l.desc}</span>
    </button>`).join('');
  cards.querySelectorAll('.langCard').forEach(c => {
    c.addEventListener('click', () => {
      currentLang = c.dataset.lang;
      setLang(currentLang);
      newFile();
    });
  });
}
function newFile(lang) {
  const l = lang || currentLang;
  const name = `main${extFor(l)}`;
  const content = snippetFor(l);
  newTab(null, name, content, langToMonaco(l));
  setLang(l);
}

/* ═════════════════════════════════════════════════════════════════
   ZEN MODE
══════════════════════════════════════════════════════════════════*/
function toggleZen() {
  document.body.classList.toggle('zen');
  if (editor) editor.layout();
  if (fitAddon) fitAddon.fit();
}

/* ═════════════════════════════════════════════════════════════════
   PACKAGES / DIALOGS
══════════════════════════════════════════════════════════════════*/
function showOverlay(pane) {
  q('#overlay').classList.remove('hidden');
  q('#dlgNav').querySelectorAll('button').forEach(b => b.classList.remove('on'));
  q('#dlgNav').querySelector(`[data-pane="${pane}"]`)?.classList.add('on');
  q('#dlgBody').querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  q(`#pane-${pane}`)?.classList.add('on');
  if (pane === 'update') checkUpdates();
  if (pane === 'setup') checkSetup();
  if (pane === 'settings') loadSettingsUI();
}
function hideOverlay() {
  q('#overlay').classList.add('hidden');
  if (editor) editor.focus();
}

/* ═════════════════════════════════════════════════════════════════
   UPDATES
══════════════════════════════════════════════════════════════════*/
async function checkUpdates() {
  q('#updMsg').textContent = 'Checking…';
  const info = await cbx.updGet();
  if (!info) { q('#updMsg').textContent = 'Could not check for updates.'; return; }
  if (info.updateAvailable) {
    q('#updMsg').textContent = `Version ${info.version} is available.`;
    q('#updDownload').classList.remove('hidden');
    q('#updDot').classList.remove('hidden');
    if (info.releaseNotes) {
      q('#updNotes').textContent = info.releaseNotes;
      q('#updNotes').classList.remove('hidden');
    }
  } else {
    q('#updMsg').textContent = 'You are on the latest version.';
    q('#updDownload').classList.add('hidden');
  }
}
function setupUpdateButtons() {
  q('#updCheck').onclick = checkUpdates;
  q('#updDownload').onclick = () => {
    q('#updDownload').disabled = true;
    q('#updBarWrap').classList.remove('hidden');
    cbx.updDownload();
  };
  q('#updInstall').onclick = () => cbx.updInstall();
  cbx.onUpdProgress((_e, pct) => {
    q('#updBar').style.width = pct + '%';
    if (pct >= 100) { q('#updInstall').classList.remove('hidden'); q('#updMsg').textContent = 'Ready to install.'; }
  });
}

/* ═════════════════════════════════════════════════════════════════
   SETUP
══════════════════════════════════════════════════════════════════*/
async function checkSetup() {
  q('#setupRows').innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">Checking…</div>';
  const rows = [
    { name: 'Python 3', cmd: 'python', label: 'python' },
    { name: 'Java JDK', cmd: 'javac', label: 'java' },
    { name: 'GCC (C/C++)', cmd: 'gcc', label: 'gcc' },
  ];
  const info = await cbx.checkSetup() || {};
  q('#setupRows').innerHTML = rows.map(r => {
    const st = info[r.cmd] || 'miss';
    return `<div class="setupRow">
      <span class="sname">${esc(r.name)}</span>
      <span class="sver">${esc(info[r.cmd + '_ver'] || '')}</span>
      <span class="sstat ${st}">${st === 'ok' ? '✓ Installed' : 'Not found'}</span>
      ${st !== 'ok' ? `<button class="primary" onclick="installTool('${r.label}')">Install</button>` : ''}
    </div>`;
  }).join('');
}
window.installTool = async function(label) {
  appendLog(`Installing ${label}…`);
  const ok = await cbx.installTool(label);
  if (ok) { toast('Installed!'); checkSetup(); } else toast('Install failed — open a terminal and run winget manually', true);
};

/* ═════════════════════════════════════════════════════════════════
   PACKAGES
══════════════════════════════════════════════════════════════════*/
async function pyInstall() {
  const name = q('#pyName').value.trim();
  if (!name) return;
  appendLog(`pip install ${name}`);
  const ok = await cbx.pipInstall(name);
  if (ok) toast('Installed: ' + name); else toast('Install failed', true);
}
async function pyRemove() {
  const name = q('#pyName').value.trim();
  if (!name) return;
  const ok = await cbx.pipRemove(name);
  if (ok) toast('Removed: ' + name); else toast('Failed', true);
}
async function pyList() {
  const list = await cbx.pipList();
  appendLog(list || '(empty)');
}

/* ═════════════════════════════════════════════════════════════════
   LOG
══════════════════════════════════════════════════════════════════*/
function appendLog(text) {
  const log = q('#log');
  log.textContent += text + '\n';
  log.scrollTop = log.scrollHeight;
}

/* ═════════════════════════════════════════════════════════════════
   ASK DIALOG
══════════════════════════════════════════════════════════════════*/
function askUser(title, placeholder = '') {
  return new Promise(resolve => {
    q('#askTitle').textContent = title;
    q('#askInput').placeholder = placeholder;
    q('#askInput').value = '';
    q('#askErr').textContent = '';
    q('#ask').classList.remove('hidden');
    q('#askInput').focus();
    const ok = () => { q('#ask').classList.add('hidden'); resolve(q('#askInput').value.trim()); };
    const cancel = () => { q('#ask').classList.add('hidden'); resolve(null); };
    q('#askOk').onclick = ok;
    q('#askCancel').onclick = cancel;
    q('#askInput').onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
  });
}

/* ═════════════════════════════════════════════════════════════════
   NEW FILE MENU
══════════════════════════════════════════════════════════════════*/
function showNewMenu(anchor) {
  const menu = q('#newMenu');
  menu.innerHTML = `
    <div class="menuItem" id="nmBlank"><svg><use href="#i-file"/></svg>Blank file</div>
    <hr>
    <div class="menuItem" data-lng="python"><span class="fi py" style="width:14px;height:14px;border-radius:3px;font-size:8px">P</span>Python</div>
    <div class="menuItem" data-lng="java"><span class="fi java" style="width:14px;height:14px;border-radius:3px;font-size:8px">J</span>Java</div>
    <div class="menuItem" data-lng="c"><span class="fi cpp" style="width:14px;height:14px;border-radius:3px;font-size:8px">C</span>C</div>
    <div class="menuItem" data-lng="cpp"><span class="fi cpp" style="width:14px;height:14px;border-radius:3px;font-size:8px">C</span>C++</div>
    <hr>
    <div class="menuItem" id="nmFile"><svg><use href="#i-folder"/></svg>Open file…</div>
    <div class="menuItem" id="nmFolder"><svg><use href="#i-folder"/></svg>Open folder…</div>`;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.classList.remove('hidden');
  menu.querySelectorAll('[data-lng]').forEach(el => {
    el.onclick = () => { hideNewMenu(); currentLang = el.dataset.lng; newFile(el.dataset.lng); };
  });
  q('#nmBlank').onclick  = () => { hideNewMenu(); newFile(); };
  q('#nmFile').onclick   = () => { hideNewMenu(); openFilePicker(); };
  q('#nmFolder').onclick = () => { hideNewMenu(); openFolder(); };
}
function hideNewMenu() { q('#newMenu').classList.add('hidden'); }
async function openFilePicker() {
  const fp = await cbx.openFile();
  if (fp) openFile(fp);
}

/* ═════════════════════════════════════════════════════════════════
   LANGUAGE
══════════════════════════════════════════════════════════════════*/
function setLang(lang) {
  currentLang = lang;
  q('#langSeg').querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-checked', b.dataset.lang === lang ? 'true' : 'false');
    b.classList.toggle('on', b.dataset.lang === lang);
  });
  q('#sbLang').textContent = langLabel(lang);
  if (editor) monaco.editor.setModelLanguage(editor.getModel(), langToMonaco(lang));
}
function detectLang(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { py: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', txt: 'plaintext', html: 'html', css: 'css' }[ext] || 'plaintext';
}
function langToMonaco(lang) { return { python: 'python', java: 'java', c: 'c', cpp: 'cpp' }[lang] || lang; }
function extFor(lang) { return { python: '.py', java: '.java', c: '.c', cpp: '.cpp' }[lang] || '.txt'; }
function langLabel(lang) { return { python: 'Python', java: 'Java', c: 'C', cpp: 'C++', javascript: 'JS', typescript: 'TS', json: 'JSON', markdown: 'Markdown', plaintext: 'Text' }[lang] || lang; }

/* ═════════════════════════════════════════════════════════════════
   SNIPPETS
══════════════════════════════════════════════════════════════════*/
function snippetFor(lang) {
  const s = {
    python: `# My Python program\n\ndef main():\n    name = input("What is your name? ")\n    print(f"Hello, {name}!")\n\nmain()\n`,
    java:   `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n`,
    c:      `#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n`,
    cpp:    `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n`,
  };
  return s[lang] || '';
}

/* ═════════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════════*/
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  q('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 4000 : 2000);
}

/* ═════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════*/
function q(sel) { return document.querySelector(sel); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ═════════════════════════════════════════════════════════════════
   WIRE  — event bindings
══════════════════════════════════════════════════════════════════*/
function wire() {
  /* ── Titlebar buttons ── */
  q('#btnNew').onclick    = e => { e.stopPropagation(); showNewMenu(q('#btnNew')); };
  q('#btnOpen').onclick   = () => openFolder();
  q('#btnSave').onclick   = () => saveFile();
  q('#btnQuickOpen').onclick = () => showQuickOpen();
  q('#btnRun').onclick    = () => runCode();
  q('#btnStop').onclick   = () => cbx.stopRun();
  q('#btnZen').onclick    = () => toggleZen();
  q('#btnPkg').onclick    = () => showOverlay('python');
  q('#btnSetup').onclick  = () => showOverlay('setup');
  q('#btnSettings').onclick = () => showOverlay('settings');
  q('#btnUpdate').onclick   = () => showOverlay('update');
  q('#btnHelp').onclick     = () => cbx.openExternal('https://claude.ai/artifact/Eq1gVrsppJFZjizS3icH2r');

  /* ── Welcome screen ── */
  q('#wNewFile').onclick    = () => newFile();
  q('#wOpenFolder').onclick = () => openFolder();
  q('#wQuickOpen').onclick  = () => showQuickOpen();

  /* ── Language selector ── */
  q('#langSeg').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });

  /* ── Side rail ── */
  q('#railExplorer').onclick = () => switchPanel('sideExplorer');
  q('#railSearch').onclick   = () => { switchPanel('sideSearch'); q('#searchQuery').focus(); };
  q('#railGit').onclick      = () => switchPanel('sideGit');
  q('#railTodo').onclick     = () => switchPanel('sideTodo');

  /* ── Explorer ── */
  q('#sideNew').onclick     = async () => {
    if (!ws) { toast('Open a folder first'); return; }
    const name = await askUser('New file name', 'main.py');
    if (!name) return;
    const fp = ws + '/' + name;
    await cbx.writeFile(fp, '');
    await refreshTree();
    openFile(fp);
  };
  q('#sideRefresh').onclick = () => refreshTree();
  q('#sideOpen').onclick    = () => openFolder();

  /* ── Search ── */
  q('#searchGo').onclick = () => runSearch();
  q('#searchQuery').onkeydown = e => { if (e.key === 'Enter') runSearch(); };

  /* ── Git ── */
  q('#gitRefresh').onclick    = () => refreshGitPanel();
  q('#gitDiffBtn').onclick    = () => doGitDiff();
  q('#gitStageAll').onclick   = async () => {
    q('#gitFiles').querySelectorAll('input[type=checkbox]').forEach(x => x.checked = true);
    toast('All staged (commit to confirm)');
  };
  q('#gitCommitBtn').onclick  = () => doGitCommit();
  q('#gitPushBtn').onclick    = () => doGitPush();
  q('#gitMsg').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doGitCommit(); };

  /* ── TODO ── */
  q('#todoRefresh').onclick = () => refreshTodo();

  /* ── Panel tabs ── */
  q('#tabTerminal').onclick = () => switchPanelTab('terminal');
  q('#tabProblems').onclick = () => switchPanelTab('problems');
  q('#termClear').onclick   = () => { terminalObj.clear(); q('#problemsPane').dataset.lastText = ''; };
  q('#termRestart').onclick = () => { cbx.restartTerm(); toast('Terminal restarted'); };
  q('#termToggle').onclick  = () => {
    const pane = q('#panel');
    const small = pane.style.height === MIN_SPLIT + 'px';
    splitH = small ? 220 : MIN_SPLIT;
    applySplit();
  };

  /* ── Quick open ── */
  q('#qoInput').oninput = e => renderQoList(e.target.value);
  q('#qoInput').onkeydown = e => {
    const list = q('#qoList');
    const sel  = list.querySelector('.qoItem.sel');
    if (e.key === 'ArrowDown') {
      const nxt = sel?.nextElementSibling || list.firstElementChild;
      sel?.classList.remove('sel'); nxt?.classList.add('sel');
      nxt?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      const prv = sel?.previousElementSibling || list.lastElementChild;
      sel?.classList.remove('sel'); prv?.classList.add('sel');
      prv?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (sel) { hideQuickOpen(); openFile(sel.dataset.full); }
    } else if (e.key === 'Escape') {
      hideQuickOpen();
    }
    e.stopPropagation();
  };
  q('#qopen').addEventListener('click', e => { if (e.target === q('#qopen')) hideQuickOpen(); });

  /* ── Shortcuts overlay ── */
  q('#shortcutsClose').onclick = () => q('#shortcuts').classList.add('hidden');
  q('#shortcuts').addEventListener('click', e => { if (e.target === q('#shortcuts')) q('#shortcuts').classList.add('hidden'); });

  /* ── Settings ── */
  q('#setTheme').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      settings.theme = b.dataset.v;
      saveSettings(); applySettings(); loadSettingsUI();
    };
  });
  q('#setFont').oninput = e => {
    settings.fontSize = +e.target.value;
    q('#setFontVal').textContent = settings.fontSize + 'px';
    saveSettings(); applySettings();
  };
  q('#setWrap').onchange = e => { settings.wrap = e.target.checked; saveSettings(); applySettings(); };
  q('#setMinimap').onchange = e => { settings.minimap = e.target.checked; saveSettings(); applySettings(); };
  q('#setAuto').onchange = e => { settings.autoSave = e.target.checked; saveSettings(); };
  q('#setUpd').onchange  = e => { settings.updCheck = e.target.checked; saveSettings(); };
  q('#setFmtSave').onchange = e => { settings.formatOnSave = e.target.checked; saveSettings(); };
  q('#setOpenWs').onclick = () => { if (ws) cbx.showInExplorer(ws); };

  /* ── Overlay nav ── */
  q('#dlgNav').querySelectorAll('[data-pane]').forEach(b => {
    b.onclick = () => showOverlay(b.dataset.pane);
  });
  q('#dlgClose').onclick = () => hideOverlay();
  q('#overlay').addEventListener('click', e => { if (e.target === q('#overlay')) hideOverlay(); });

  /* ── Package pane ── */
  q('#pyInstall').onclick = () => pyInstall();
  q('#pyRemove').onclick  = () => pyRemove();
  q('#pyList').onclick    = () => pyList();
  q('#pyReq').onclick     = async () => {
    const fp = await cbx.openFile();
    if (fp) { appendLog('pip install -r ' + fp); await cbx.pipReq(fp); }
  };
  q('#logClear').onclick = () => { q('#log').textContent = ''; };

  /* ── Zen exit ── */
  q('#zenExit').onclick = () => toggleZen();

  /* ── Global keyboard ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!q('#qopen').classList.contains('hidden')) { hideQuickOpen(); return; }
      if (!q('#shortcuts').classList.contains('hidden')) { q('#shortcuts').classList.add('hidden'); return; }
      if (!q('#overlay').classList.contains('hidden')) { hideOverlay(); return; }
      if (document.body.classList.contains('zen')) { toggleZen(); return; }
    }
    if (e.key === 'F5') { e.preventDefault(); runCode(); return; }
    if (e.key === 'F11') { e.preventDefault(); toggleZen(); return; }
    if (e.ctrlKey && e.key === 'p') { e.preventDefault(); showQuickOpen(); return; }
    if (e.ctrlKey && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); return; }
    if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); saveFileAs(); return; }
    if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); switchPanel('sideSearch'); q('#searchQuery').focus(); return; }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); showNewMenu(q('#btnNew')); return; }
    if (e.ctrlKey && e.key === '?') { e.preventDefault(); q('#shortcuts').classList.toggle('hidden'); return; }
    if (e.altKey && e.shiftKey && e.key === 'F') { e.preventDefault(); editor?.getAction('editor.action.formatDocument')?.run(); return; }
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) { settings.fontSize = Math.min(26, (settings.fontSize||14)+1); saveSettings(); applySettings(); loadSettingsUI(); }
    if (e.ctrlKey && e.key === '-') { settings.fontSize = Math.max(10, (settings.fontSize||14)-1); saveSettings(); applySettings(); loadSettingsUI(); }
  });

  /* ── Click outside new menu ── */
  document.addEventListener('click', e => {
    if (!q('#newMenu').contains(e.target) && !q('#btnNew').contains(e.target)) hideNewMenu();
  });

  /* ── Splitter ── */
  initSplitter();

  /* ── Update IPC ── */
  setupUpdateButtons();

  /* ── Window resize ── */
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });
}
