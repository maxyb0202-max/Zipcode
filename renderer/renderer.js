(function () {
  'use strict';
  const api = window.api;
  const WIN = api.platform === 'win32';
  const EOL = WIN ? '\r\n' : '\n';
  const SENT = WIN ? 'echo ::CBX::!ERRORLEVEL!::!CD!' : 'echo ::CBX::$?::$PWD';
  const JOIN = WIN ? ' & ' : '; ';
  const SEP = WIN ? '\\' : '/';

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const join = (...p) => p.join(SEP);
  const cut = p => Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  const dirname = p => p.slice(0, cut(p));
  const basename = p => p.slice(cut(p) + 1);
  const q = s => `"${s}"`;
  const icon = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''}><use href="#i-${id}"/></svg>`;
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  const LANGS = {
    python: { ext: ['py'], monaco: 'python', run: ['py'], label: 'Python', def: 'hello', badge: 'Py', cls: 'py', blurb: 'Great first language. Scripts, games and data.' },
    java: { ext: ['java'], monaco: 'java', run: ['java'], label: 'Java', def: 'Main', badge: 'J', cls: 'java', blurb: 'Object-oriented. Apps, Android and school courses.' },
    c: { ext: ['c', 'h'], monaco: 'c', run: ['c'], label: 'C', def: 'hello', badge: 'C', cls: 'c', blurb: 'Close to the hardware. Arduino-style code.' },
    cpp: { ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], monaco: 'cpp', run: ['cpp', 'cc', 'cxx'], label: 'C++', def: 'hello', badge: 'C++', cls: 'cpp', blurb: 'Fast and powerful. Games and engines.' }
  };
  const extOf = f => (f.includes('.') ? f.split('.').pop().toLowerCase() : '');
  function langOf(f) {
    const e = extOf(f);
    for (const k in LANGS) if (LANGS[k].ext.includes(e)) return k;
    return null;
  }
  function badge(name) {
    const e = extOf(name), l = langOf(name);
    if (e === 'h' || e === 'hpp' || e === 'hh') return '<span class="fi h">H</span>';
    if (l) return `<span class="fi ${LANGS[l].cls}">${LANGS[l].badge}</span>`;
    return `<span class="fi dir">${icon('file')}</span>`;
  }

  const S = {
    ws: '', helper: '', vcpkg: '', version: '', vcpkgInstalled: false, tools: null, active: null, lang: 'python',
    models: new Map(), expanded: new Set(), settings: {}, examples: {}, upd: { state: 'idle' }
  };
  let editor = null;

  // ------------------------------------------------------------ toasts
  function toast(msg, kind, action) {
    const box = $('#toasts');
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''));
    const span = el('span'); span.textContent = msg; t.appendChild(span);
    if (action) {
      const b = el('button', 'primary'); b.textContent = action.label;
      b.onclick = () => { action.run(); close(); };
      t.appendChild(b);
    }
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    let timer = setTimeout(close, action ? 9000 : 4500);
    t.onmouseenter = () => clearTimeout(timer);
    t.onmouseleave = () => { timer = setTimeout(close, 2500); };
    function close() { t.classList.add('out'); setTimeout(() => t.remove(), 220); }
  }

  // ------------------------------------------------------------ small input dialog
  function ask(title, value, validate) {
    return new Promise(resolve => {
      const box = $('#ask'), inp = $('#askInput'), err = $('#askErr');
      $('#askTitle').textContent = title;
      inp.value = value || '';
      err.textContent = '';
      box.classList.remove('hidden');
      setTimeout(() => { inp.focus(); const dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length); }, 0);
      const done = v => {
        box.classList.add('hidden');
        $('#askOk').onclick = $('#askCancel').onclick = inp.onkeydown = box.onclick = null;
        resolve(v);
      };
      const ok = async () => {
        const v = inp.value.trim();
        if (!v) { err.textContent = 'Please type a name.'; return; }
        if (validate) { const e = await validate(v); if (e) { err.textContent = e; return; } }
        done(v);
      };
      $('#askOk').onclick = ok;
      $('#askCancel').onclick = () => done(null);
      box.onclick = e => { if (e.target === box) done(null); };
      inp.onkeydown = e => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    });
  }

  // ------------------------------------------------------------ menu
  function openMenu(anchor, items) {
    const m = $('#newMenu');
    m.innerHTML = '';
    for (const it of items) {
      if (it === '-') { m.appendChild(el('hr')); continue; }
      if (it.label && !it.run) { m.appendChild(el('div', 'mlabel', '')).textContent = it.label; continue; }
      const b = el('button', '', (it.html || '') + `<span>${it.text}</span>`);
      b.setAttribute('role', 'menuitem');
      b.onclick = () => { closeMenu(); it.run(); };
      m.appendChild(b);
    }
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - 270) + 'px';
    m.style.top = (r.bottom + 6) + 'px';
    m.classList.remove('hidden');
    anchor.classList.add('open');
    const first = m.querySelector('button'); if (first) first.focus();
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    function outside(e) { if (!m.contains(e.target)) closeMenu(); }
    openMenu.cleanup = () => { document.removeEventListener('mousedown', outside); anchor.classList.remove('open'); };
  }
  function closeMenu() {
    $('#newMenu').classList.add('hidden');
    if (openMenu.cleanup) { openMenu.cleanup(); openMenu.cleanup = null; }
  }
  function newMenu(anchor) {
    const items = [{ label: 'New file' }];
    for (const k of Object.keys(LANGS)) items.push({ html: badge('x.' + LANGS[k].ext[0]), text: `${LANGS[k].label} file`, run: () => newFile(k) });
    items.push('-', { label: `${LANGS[S.lang].label} examples` });
    for (const t of S.examples[S.lang] || []) items.push({ html: icon('spark'), text: t, run: () => newFile(S.lang, t) });
    openMenu(anchor, items);
  }

  // ------------------------------------------------------------ language
  function setLang(lang) {
    S.lang = lang;
    $$('#langSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === lang)));
  }

  // ------------------------------------------------------------ sidebar rail
  function switchPanel(id) {
    $$('.rail').forEach(b => b.classList.remove('on'));
    document.getElementById('rail' + id).classList.add('on');
    $$('#sideExplorer, #sideSearch, #sideGit').forEach(p => p.classList.add('hidden'));
    document.getElementById('side' + id).classList.remove('hidden');
    if (id === 'Search') setTimeout(() => $('#searchQuery').focus(), 0);
    if (id === 'Git') refreshGitPanel();
  }

  // ------------------------------------------------------------ search panel
  async function runSearch() {
    const q2 = $('#searchQuery').value.trim();
    const box = $('#searchResults');
    if (!q2) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="search-empty">Searching…</div>';
    try {
      const results = await api.searchFiles(S.ws, q2);
      if (!results.length) { box.innerHTML = '<div class="search-empty">No results found.</div>'; return; }
      // group by file
      const byFile = new Map();
      for (const r of results) {
        if (!byFile.has(r.file)) byFile.set(r.file, []);
        byFile.get(r.file).push(r);
      }
      box.innerHTML = '';
      for (const [file, rows] of byFile) {
        const fh = el('div', 'sresult-file');
        fh.textContent = file.startsWith(S.ws) ? file.slice(S.ws.length + 1) : file;
        fh.title = file;
        box.appendChild(fh);
        for (const r of rows) {
          const row = el('div', 'sresult-row');
          const ln = el('span', 'ln'); ln.textContent = r.line;
          const txt = el('span', 'txt');
          // highlight the matched text
          const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const idx = r.text.toLowerCase().indexOf(q2.toLowerCase());
          if (idx >= 0) {
            txt.innerHTML = esc(r.text.slice(0, idx)) + `<em>${esc(r.text.slice(idx, idx + q2.length))}</em>` + esc(r.text.slice(idx + q2.length));
          } else {
            txt.textContent = r.text;
          }
          row.append(ln, txt);
          row.onclick = () => { openFile(file).then(() => { if (editor) editor.revealLineInCenter(r.line); editor.setPosition({ lineNumber: r.line, column: 1 }); }); };
          box.appendChild(row);
        }
      }
    } catch (e) {
      box.innerHTML = '<div class="search-empty">Search failed.</div>';
    }
  }

  // ------------------------------------------------------------ git panel
  let gitState = null;

  async function refreshGitPanel() {
    const branchEl = $('#gitBranch');
    const filesEl = $('#gitFiles');
    const logEl = $('#gitLog');
    branchEl.innerHTML = icon('branch') + '<span>Loading…</span>';
    filesEl.innerHTML = '';
    logEl.innerHTML = '';

    const st = await api.gitStatus(S.ws);
    gitState = st;

    if (!st.ok) {
      branchEl.innerHTML = icon('branch') + '<span style="color:var(--text-3)">Not a git repo</span>';
      filesEl.innerHTML = `<div class="git-empty">Not a git repo. <button id="gitInitBtn" style="display:inline;padding:2px 8px;font-size:11px">Init</button></div>`;
      $('#gitInitBtn') && ($('#gitInitBtn').onclick = async () => {
        await api.gitInit(S.ws);
        refreshGitPanel();
      });
      $('#gitDot').classList.add('hidden');
      $('#sbBranch').classList.add('hidden');
      return;
    }

    const totalChanges = st.staged.length + st.unstaged.length + st.untracked.length;
    $('#gitDot').classList.toggle('hidden', totalChanges === 0);
    $('#sbBranch').classList.remove('hidden');
    $('#sbBranch').innerHTML = icon('branch') + `<span>${st.branch}</span>`;

    branchEl.innerHTML = icon('branch') + `<span>${st.branch}</span>`;

    if (!st.files.length) {
      filesEl.innerHTML = '<div class="git-empty">No changes</div>';
    } else {
      filesEl.innerHTML = '';
      for (const f of st.files) {
        const row = el('div', 'git-file');
        const stat = el('span', 'gstat ' + (f.staged ? 's' : f.status));
        stat.textContent = f.status;
        stat.title = f.staged ? 'Staged' : (f.status === 'M' ? 'Modified' : f.status === 'A' ? 'Added' : f.status === 'D' ? 'Deleted' : 'Untracked');
        const name = el('span', 'gname'); name.textContent = f.name; name.title = f.name;
        row.append(stat, name);
        row.onclick = () => {
          const full = join(S.ws, f.name);
          if (f.status !== 'D') openFile(full);
        };
        filesEl.appendChild(row);
      }
    }

    const lg = await api.gitLog(S.ws);
    if (lg.ok && lg.commits.length) {
      logEl.innerHTML = '';
      for (const c of lg.commits.slice(0, 8)) {
        const row = el('div', 'git-commit');
        row.innerHTML = `<span class="ghash">${c.hash}</span>${c.msg.replace(/</g,'&lt;')}`;
        logEl.appendChild(row);
      }
    }
  }

  // ------------------------------------------------------------ problems panel
  const problems = [];
  const ERROR_RE = {
    // gcc/g++: file.c:10:5: error: ...
    c: /^(.+?):(\d+):\d+:\s*(error|warning):\s*(.+)$/,
    // java: file.java:10: error: ...
    java: /^(.+?):(\d+):\s*error:\s*(.+)$/,
    // python: File "file.py", line 10
    python: /^\s*File "(.+?)",\s*line\s*(\d+)/
  };

  function parseProblems(text) {
    const found = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let m;
      if ((m = ERROR_RE.c.exec(l))) {
        found.push({ type: m[3] === 'error' ? 'error' : 'warning', file: m[1], line: parseInt(m[2]), msg: m[4].trim() });
      } else if ((m = ERROR_RE.java.exec(l))) {
        found.push({ type: 'error', file: m[1], line: parseInt(m[2]), msg: m[3].trim() });
      } else if ((m = ERROR_RE.python.exec(l))) {
        const nextMsg = lines[i + 1] ? lines[i + 1].trim() : '';
        found.push({ type: 'error', file: m[1], line: parseInt(m[2]), msg: nextMsg });
      }
    }
    return found;
  }

  function updateProblems(text) {
    const found = parseProblems(text);
    problems.length = 0;
    problems.push(...found);
    const count = problems.length;
    const badge = $('#problemCount');
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    renderProblemsPane();
  }

  function renderProblemsPane() {
    const pane = $('#problemsPane');
    pane.innerHTML = '';
    if (!problems.length) {
      pane.innerHTML = '<div class="search-empty">No problems detected.</div>';
      return;
    }
    for (const p of problems) {
      const row = el('div', 'prob-row');
      const ico = el('span', `prob-icon ${p.type}`);
      ico.innerHTML = p.type === 'error' ? icon('warn') : icon('warn');
      const msg = el('span', 'prob-msg');
      msg.textContent = p.msg;
      msg.title = p.msg;
      const loc = el('span', 'prob-loc');
      loc.textContent = `${basename(p.file)}:${p.line}`;
      row.append(ico, msg, loc);
      row.onclick = () => {
        openFile(p.file).then(() => {
          if (editor) {
            editor.revealLineInCenter(p.line);
            editor.setPosition({ lineNumber: p.line, column: 1 });
          }
          switchPanelTab('terminal');
        });
      };
      pane.appendChild(row);
    }
  }

  function switchPanelTab(tab) {
    const isTerminal = tab === 'terminal';
    $('#tabTerminal').classList.toggle('on', isTerminal);
    $('#tabProblems').classList.toggle('on', !isTerminal);
    $('#termwrap').classList.toggle('hidden', !isTerminal);
    $('#problemsPane').classList.toggle('hidden', isTerminal);
    if (isTerminal) setTimeout(() => fit && fit.fit(), 0);
  }

  // ------------------------------------------------------------ execution timer
  let runStartTime = null, runTimerInterval = null;

  function startRunTimer(name) {
    runStartTime = Date.now();
    runTimerInterval = setInterval(() => {
      const elapsed = ((Date.now() - runStartTime) / 1000).toFixed(1);
      $('#runState').className = 'pill busy';
      $('#runState').textContent = `Running ${name} · ${elapsed}s`;
    }, 100);
  }

  function stopRunTimer() {
    clearInterval(runTimerInterval);
    runTimerInterval = null;
    runStartTime = null;
  }

  // ------------------------------------------------------------ terminal
  let term, fit, buf = '', busy = true, pend = '', atLineStart = true, runActive = null;
  let termOutputBuf = '';
  const hist = []; let histIdx = -1;

  const TERM_THEMES = {
    dark: { background: '#1f2228', foreground: '#d8dbe0', cursor: '#d8dbe0', selectionBackground: '#2b3c5c',
      black: '#1b1d23', red: '#f0716a', green: '#5ad17e', yellow: '#e3b341', blue: '#6aa3ff', magenta: '#c792ea', cyan: '#5fd0d6', white: '#d8dbe0',
      brightBlack: '#6b727d' },
    light: { background: '#f6f7f9', foreground: '#1f2329', cursor: '#1f2329', selectionBackground: '#cfe0fc',
      black: '#1f2329', red: '#cf3c34', green: '#1f9850', yellow: '#a8740b', blue: '#2f6fed', magenta: '#8250df', cyan: '#1b7c83', white: '#5b6370',
      brightBlack: '#8a919b' },
    monokai: { background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#3d3d2f',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75756f' },
    nord: { background: '#2e3440', foreground: '#eceff4', cursor: '#eceff4', selectionBackground: '#3b4a6b',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#636b78' },
    'github-light': { background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: '#ddeeff',
      black: '#1f2328', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#57606a',
      brightBlack: '#8c959f' }
  };

  function out(s) {
    if (!s) return;
    term.write(s);
    atLineStart = s.endsWith('\n');
    if (runActive) termOutputBuf += s;
  }
  function note(s, color) {
    if (!atLineStart) out('\r\n');
    out(`\x1b[${color || 90}m${s}\x1b[0m\r\n`);
  }

  function setState(state, text) {
    if (state !== 'busy') stopRunTimer();
    const pill = $('#runState');
    pill.className = 'pill ' + state;
    pill.textContent = text;
    $('#sbRun').className = state === 'busy' ? 'busy' : '';
    $('#sbRunText').textContent = text;
    $('#btnRun').disabled = state === 'busy';
    $('#btnStop').classList.toggle('live', state === 'busy');
  }

  function onPrompt(code, dir) {
    busy = false;
    if (runActive) {
      const name = runActive; runActive = null;
      stopRunTimer();
      const elapsed = runStartTime ? ((Date.now() - runStartTime) / 1000).toFixed(2) : null;
      if (code === 0) {
        const msg = elapsed ? `✔ ${name} finished in ${elapsed}s` : `✔ ${name} finished`;
        note(msg, 32); setState('idle', 'Finished');
      } else {
        note(`✖ ${name} stopped with an error (exit code ${code})`, 31); setState('fail', 'Error');
      }
      // parse problems from buffered output
      updateProblems(termOutputBuf);
      termOutputBuf = '';
    } else if (!$('#runState').classList.contains('fail')) setState('idle', 'Ready');
    term.write(`\x1b[36m${dir}\x1b[0m\x1b[90m>\x1b[0m `);
    atLineStart = false;
  }

  function flush() {
    for (;;) {
      const i = pend.indexOf('::CBX::');
      if (i < 0) break;
      const j = pend.indexOf('\r\n', i);
      if (j < 0) { out(pend.slice(0, i)); pend = pend.slice(i); return; }
      out(pend.slice(0, i));
      if (!atLineStart) out('\r\n');
      const body = pend.slice(i + 7, j), k = body.indexOf('::');
      const code = k < 0 ? 0 : (parseInt(body.slice(0, k), 10) || 0);
      pend = pend.slice(j + 2);
      onPrompt(code, k < 0 ? body : body.slice(k + 2));
    }
    let hold = 0;
    for (let k = Math.min(6, pend.length); k > 0; k--) {
      if ('::CBX::'.startsWith(pend.slice(-k))) { hold = k; break; }
    }
    out(pend.slice(0, pend.length - hold));
    pend = pend.slice(pend.length - hold);
  }

  function submit(line) {
    if (busy) { api.shellWrite(line + EOL); return; }
    if (line.trim() && hist[hist.length - 1] !== line) hist.push(line);
    histIdx = -1;
    if (/^\s*(cls|clear)\s*$/i.test(line)) { term.clear(); line = ''; }
    busy = true;
    if (line.trim()) setState('busy', 'Running command');
    api.shellWrite((line.trim() ? line + JOIN + SENT : SENT) + EOL);
  }

  function replaceLine(s) {
    term.write('\b \b'.repeat(buf.length));
    buf = s;
    term.write(s);
    atLineStart = false;
  }

  function runInTerminal(cmd, name) {
    if (busy) { toast('Something is still running. Press Stop first.', 'warn'); return false; }
    buf = '';
    termOutputBuf = '';
    if (!atLineStart) out('\r\n');
    note(`▶ Running ${name}`, 36);
    busy = true;
    runActive = name;
    setState('busy', 'Running ' + name);
    startRunTimer(name);
    showPanel(true);
    switchPanelTab('terminal');
    api.shellWrite(cmd + JOIN + SENT + EOL);
    term.focus();
    return true;
  }

  async function restartShell(msg) {
    const wasRunning = !!runActive;
    buf = ''; pend = ''; busy = true; runActive = null;
    stopRunTimer();
    note(msg || '[terminal restarted]', wasRunning ? 33 : 90);
    setState('idle', wasRunning ? 'Stopped' : 'Ready');
    await api.shellStart();
  }

  function showPanel(on) {
    const p = $('#panel');
    if (on === undefined) on = p.classList.contains('collapsed');
    p.classList.toggle('collapsed', !on);
    $('#termToggle use').setAttribute('href', on ? '#i-down' : '#i-up');
    if (on) setTimeout(() => fit.fit(), 0);
  }

  function initTerminal() {
    const theme = S.settings.theme || 'dark';
    term = new Terminal({
      fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace', fontSize: Math.max(11, S.settings.fontSize - 1), cursorBlink: true,
      theme: TERM_THEMES[theme] || TERM_THEMES.dark, scrollback: 5000, lineHeight: 1.15
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('#term'));
    fit.fit();

    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true;
      if (e.key === 'F5') { e.preventDefault(); run(); return false; }
      if (!e.ctrlKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false; }
      if (k === 'v') return false;
      return true;
    });

    term.onData(data => {
      if (data === '\x1b[A' || data === '\x1b[B') {
        if (busy || !hist.length) return;
        if (data === '\x1b[A') histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
        else if (histIdx >= 0) histIdx = histIdx + 1 >= hist.length ? -1 : histIdx + 1;
        replaceLine(histIdx < 0 ? '' : hist[histIdx]);
        return;
      }
      if (data.startsWith('\x1b')) return;
      for (const ch of data) {
        if (ch === '\r') { term.write('\r\n'); atLineStart = true; const l = buf; buf = ''; submit(l); }
        else if (ch === '\n') continue;
        else if (ch === '\x7f' || ch === '\b') { if (buf.length) { buf = buf.slice(0, -1); term.write('\b \b'); } }
        else if (ch === '\x03') { term.write('^C'); atLineStart = false; restartShell('[stopped]'); }
        else if (ch === '\x0c') { term.clear(); }
        else if (ch >= ' ' || ch === '\t') { buf += ch; term.write(ch); atLineStart = false; }
      }
    });
    api.on('shell:data', t => { pend += t.replace(/\r?\n/g, '\r\n'); flush(); });
    api.on('shell:exit', () => { note('[terminal closed, restarting]'); busy = true; pend = ''; api.shellStart(); });
    window.addEventListener('resize', () => fit.fit());

    const sp = $('#splitter'), panel = $('#panel');
    sp.addEventListener('mousedown', e => {
      e.preventDefault();
      showPanel(true);
      sp.classList.add('drag');
      const startY = e.clientY, startH = panel.offsetHeight;
      const move = ev => {
        panel.style.height = Math.max(90, Math.min(window.innerHeight - 220, startH + startY - ev.clientY)) + 'px';
        fit.fit();
      };
      const up = () => { sp.classList.remove('drag'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ------------------------------------------------------------ files / tabs
  async function renderTree() {
    $('#wsname').textContent = basename(S.ws) || S.ws;
    $('#wsname').title = S.ws;
    $('#sbFolder').textContent = S.ws;
    const root = el('div');
    await renderDir(S.ws, root, 0);
    if (!root.children.length) root.appendChild(el('div', 'empty-tree', 'This folder is empty.<br>Click <b>New</b> to create a file.'));
    const tree = $('#tree');
    tree.innerHTML = '';
    tree.appendChild(root);
  }

  async function renameFile(p) {
    const res = { path: null };
    const name = await ask(`Rename ${basename(p)}`, basename(p), async v => {
      if (v === basename(p)) return null;
      const r = await api.rename(p, v);
      if (!r.ok) return r.error;
      res.path = r.path;
      return null;
    });
    if (!name || !res.path) return;
    const rec = S.models.get(p);
    if (rec) {
      const text = rec.model.getValue(), dirty = rec.dirty;
      closeTab(p, true);
      await openFile(res.path);
      if (dirty) S.models.get(res.path).model.setValue(text);
    }
    renderTree();
    toast('Renamed to ' + basename(res.path), 'ok');
  }

  async function deleteFile(p) {
    if (await api.remove(p)) { closeTab(p, true); renderTree(); toast(basename(p) + ' moved to the Recycle Bin'); }
  }

  async function renderDir(dir, box, depth) {
    const items = await api.list(dir);
    for (const it of items) {
      const row = el('div', 'row' + (it.path === S.active ? ' sel' : ''));
      row.style.paddingLeft = (6 + depth * 14) + 'px';
      row.title = it.path;
      if (it.dir) {
        const open = S.expanded.has(it.path);
        row.innerHTML = icon(open ? 'chev' : 'chev', 'tw') + `<span class="fi dir">${icon('folder')}</span>`;
        if (!open) row.querySelector('.tw').style.transform = 'rotate(-90deg)';
        const nm = el('span', 'nm'); nm.textContent = it.name; row.appendChild(nm);
        row.onclick = () => { open ? S.expanded.delete(it.path) : S.expanded.add(it.path); renderTree(); };
      } else {
        row.innerHTML = '<span style="width:12px;flex:none"></span>' + badge(it.name);
        const nm = el('span', 'nm'); nm.textContent = it.name; row.appendChild(nm);
        const acts = el('span', 'acts');
        const rn = el('button', 'mini', icon('pen')); rn.title = 'Rename';
        rn.onclick = e => { e.stopPropagation(); renameFile(it.path); };
        const x = el('button', 'mini del', icon('trash')); x.title = 'Delete';
        x.onclick = e => { e.stopPropagation(); deleteFile(it.path); };
        acts.append(rn, x);
        row.appendChild(acts);
        row.onclick = () => openFile(it.path);
        row.ondblclick = () => renameFile(it.path);
      }
      box.appendChild(row);
      if (it.dir && S.expanded.has(it.path)) await renderDir(it.path, box, depth + 1);
    }
  }

  function renderTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    for (const [p, rec] of S.models) {
      const t = el('div', 'tab' + (p === S.active ? ' on' : ''), badge(p));
      t.title = p;
      const nm = el('span'); nm.textContent = basename(p);
      const x = el('span', 'tx' + (rec.dirty ? '' : ' clean'), (rec.dirty ? '<span class="dirty"></span>' : '') + icon('x', 'xi'));
      x.title = rec.dirty ? 'Unsaved changes. Click to close' : 'Close';
      x.onclick = e => { e.stopPropagation(); closeTab(p, false); };
      t.onclick = () => activate(p);
      t.onauxclick = e => { if (e.button === 1) closeTab(p, false); };
      t.append(nm, x);
      tabs.appendChild(t);
    }
    $('#welcome').classList.toggle('hidden', S.models.size > 0);
    updateStatusbar();
  }

  let autosaveTimer = null;
  async function openFile(p) {
    if (!S.models.has(p)) {
      let text;
      try { text = await api.read(p); } catch (e) { toast('Could not open ' + basename(p), 'err'); return; }
      const lang = langOf(p);
      const model = monaco.editor.createModel(text, lang ? LANGS[lang].monaco : undefined, monaco.Uri.file(p));
      const rec = { model, dirty: false };
      model.onDidChangeContent(() => {
        if (!rec.dirty) { rec.dirty = true; renderTabs(); }
        if (S.settings.autosave) {
          clearTimeout(autosaveTimer);
          autosaveTimer = setTimeout(() => saveAll(), 1000);
        }
      });
      S.models.set(p, rec);
    }
    activate(p);
  }

  function activate(p) {
    const rec = S.models.get(p);
    if (!rec) return;
    S.active = p;
    editor.setModel(rec.model);
    const lang = langOf(p);
    if (lang) setLang(lang);
    renderTabs();
    renderTree();
    editor.focus();
  }

  function closeTab(p, force) {
    const rec = S.models.get(p);
    if (!rec) return;
    if (!force && rec.dirty && !S.settings.autosave && !confirm(`${basename(p)} has unsaved changes. Close without saving?`)) return;
    if (!force && rec.dirty && S.settings.autosave) api.write(p, rec.model.getValue());
    S.models.delete(p);
    if (S.active === p) {
      const next = [...S.models.keys()].pop() || null;
      S.active = null;
      if (next) activate(next); else { editor.setModel(null); renderTabs(); renderTree(); }
    } else renderTabs();
    rec.model.dispose();
  }

  async function save(p) {
    const rec = S.models.get(p);
    if (!rec) return;
    await api.write(p, rec.model.getValue());
    rec.dirty = false;
  }
  async function saveCurrent() {
    if (!S.active) return;
    await save(S.active);
    renderTabs();
    toast('Saved ' + basename(S.active), 'ok');
  }
  async function saveAll() {
    let any = false;
    for (const [p, rec] of S.models) if (rec.dirty) { await save(p); any = true; }
    if (any) renderTabs();
  }

  async function newFile(lang, example) {
    setLang(lang);
    let name = '';
    if (!example) {
      name = await ask(`New ${LANGS[lang].label} file`, LANGS[lang].def + '.' + LANGS[lang].ext[0]);
      if (!name) return;
    }
    const r = await api.newFile(lang, S.ws, name, example);
    if (!r.ok) { toast(r.error, 'err'); return; }
    await renderTree();
    await openFile(r.path);
    toast(`Created ${basename(r.path)}`, 'ok', example ? { label: 'Run it', run } : null);
  }

  async function openWorkspace(p) {
    if (!p) p = await api.pickFolder();
    if (!p) return;
    await saveAll();
    for (const k of [...S.models.keys()]) closeTab(k, true);
    S.ws = p;
    S.expanded.clear();
    await restartShell('[opened ' + p + ']');
    await renderTree();
    await openFirst();
    // refresh git for the new workspace
    refreshGitPanel();
  }

  async function openFirst() {
    const items = (await api.list(S.ws)).filter(i => !i.dir && langOf(i.name));
    if (items.length) await openFile(items[0].path);
    else renderTabs();
  }

  function updateStatusbar() {
    const lang = S.active ? langOf(S.active) : null;
    $('#sbLang').textContent = lang ? LANGS[lang].label : (S.active ? 'Plain text' : '');
    const pos = editor && editor.getModel() ? editor.getPosition() : null;
    $('#sbPos').textContent = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
    $('#sbVer').textContent = 'v' + S.version;
  }

  function renderCards() {
    const box = $('#langCards');
    box.innerHTML = '';
    for (const k of Object.keys(LANGS)) {
      const L = LANGS[k];
      const c = el('button', 'card', `<span class="fi ${L.cls}">${L.badge}</span><b>${L.label}</b><small>${L.blurb}</small>`);
      c.onclick = () => newFile(k);
      box.appendChild(c);
    }
  }

  // ------------------------------------------------------------ run
  function buildRun(file) {
    const lang = langOf(file), dir = dirname(file), base = basename(file).replace(/\.[^.]+$/, '');
    const cd = WIN ? `cd /d ${q(dir)}` : `cd ${q(dir)}`;
    if (lang === 'python') return `${cd} && python -u ${q(file)}`;
    if (lang === 'java') return `${cd} && java -cp ${q(join(S.ws, 'libs', '*'))} ${q(file)}`;

    const compiler = lang === 'c' ? 'gcc' : 'g++ -std=c++17';
    const bdir = join(dir, 'build');
    const exe = join(bdir, base + (WIN ? '.exe' : ''));
    const text = S.models.get(file) ? S.models.get(file).model.getValue() : '';
    const m = text.match(/^\s*\/\/\s*link:\s*(.+)$/m);
    const link = m ? m[1].trim().replace(/[&|<>^%!]/g, '') + ' ' : '';
    let pre = '', flags = '';
    if (S.vcpkgInstalled) {
      const trip = join(S.vcpkg, 'installed', 'x64-mingw-dynamic');
      flags = `-I${q(join(trip, 'include'))} -L${q(join(trip, 'lib'))} `;
      if (WIN) pre = `set "PATH=${join(trip, 'bin')};%PATH%" & `;
    }
    const mk = WIN ? `mkdir ${q(bdir)} 2>nul` : `mkdir -p ${q(bdir)}`;
    return `${cd}${JOIN}${pre}${mk}${JOIN}${compiler} ${q(file)} ${q(S.helper)} ${flags}${link}-o ${q(exe)} && ${q(exe)}`;
  }

  async function run() {
    const f = S.active;
    if (!f) { toast('Create or open a file first.', 'warn'); return; }
    const lang = langOf(f);
    if (!lang || !LANGS[lang].run.includes(extOf(f))) { toast('Only .py, .java, .c and .cpp files can be run.', 'warn'); return; }
    await saveAll();
    const need = { python: 'python', java: 'java', c: 'gcc', cpp: 'gpp' }[lang];
    if (S.tools && S.tools[need] === null) {
      const names = { python: 'Python', java: 'Java (JDK)', c: 'A C compiler', cpp: 'A C++ compiler' };
      toast(`${names[lang]} isn't installed yet.`, 'warn', { label: 'Install', run: () => openDialog('setup') });
      return;
    }
    runInTerminal(buildRun(f), basename(f));
  }

  // ------------------------------------------------------------ packages / setup dialog
  const okName = s => /^[A-Za-z0-9_.\-=<>~\[\],@:/ ]+$/.test(s);
  let working = false;

  function logAdd(t) {
    const box = $('#log');
    t = t.replace(/\r\n/g, '\n').split('\r').filter(s => !/^\s*[-\\|/]?\s*$/.test(s) || s.includes('\n')).join('\n');
    box.textContent += t;
    if (box.textContent.length > 200000) box.textContent = box.textContent.slice(-150000);
    box.scrollTop = box.scrollHeight;
  }

  async function job(fn) {
    if (working) { toast('Wait for the current job to finish.', 'warn'); return; }
    working = true;
    $$('#dlgBody .pane:not(#pane-update):not(#pane-settings) button').forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (e) { logAdd(`\n[error: ${e.message}]\n\n`); }
    finally {
      working = false;
      $$('#dlgBody .pane button').forEach(b => { b.disabled = false; });
    }
  }
  function cmdRun(c) { logAdd(`> ${c}\n`); return api.run({ cmd: c, cwd: S.ws }); }

  function nameFrom(id) {
    const v = $(id).value.trim();
    if (!v) { toast('Type a name first.', 'warn'); $(id).focus(); return null; }
    if (!okName(v)) { toast('That name has characters that are not allowed.', 'err'); return null; }
    return v;
  }

  function openDialog(pane) {
    closeMenu();
    $('#overlay').classList.remove('hidden');
    showPane(pane);
  }
  function closeDialog() { $('#overlay').classList.add('hidden'); }
  function showPane(pane) {
    $$('#dlgNav button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
    $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + pane));
    $('#dlg').classList.toggle('nolog', pane === 'settings' || pane === 'update');
    if (pane === 'java') refreshJars();
    if (pane === 'cpp') refreshVcpkg();
    if (pane === 'setup') refreshTools();
    if (pane === 'settings') loadSettingsUI();
    if (pane === 'update') renderUpdate();
    const first = $('#pane-' + pane + ' input');
    if (first) setTimeout(() => first.focus(), 0);
  }

  // Java
  async function refreshJars() {
    const box = $('#jvInstalled');
    const jars = await api.mvnList(S.ws);
    box.innerHTML = jars.length ? '' : '<div class="empty">No libraries yet</div>';
    for (const j of jars) {
      const d = el('div', 'item');
      const s = el('span'); s.textContent = j; s.title = j;
      const b = el('button'); b.textContent = 'Remove';
      b.onclick = async () => { await api.mvnRemove(S.ws, j); refreshJars(); renderTree(); };
      d.append(s, b); box.appendChild(d);
    }
  }
  async function addJar(g, a, v) {
    await job(async () => {
      logAdd(`Adding ${g}:${a}:${v}\n`);
      const ok = await api.mvnAdd(S.ws, g, a, v);
      await refreshJars();
      renderTree();
      toast(ok ? `Added ${a} ${v}` : `Couldn't add ${a}`, ok ? 'ok' : 'err');
    });
  }
  async function javaSearch() {
    const v = nameFrom('#jvName');
    if (!v) return;
    const parts = v.split(':');
    if (parts.length === 3 && parts.every(Boolean)) return addJar(parts[0], parts[1], parts[2]);
    const box = $('#jvResults');
    box.innerHTML = '<div class="empty">Searching...</div>';
    try {
      const res = await api.mvnSearch(v);
      box.innerHTML = res.length ? '' : '<div class="empty">No results</div>';
      for (const r of res) {
        const d = el('div', 'item');
        const s = el('span'); s.textContent = `${r.g}:${r.a}:${r.v}`; s.title = s.textContent;
        const b = el('button', 'primary'); b.textContent = 'Add';
        b.onclick = () => addJar(r.g, r.a, r.v);
        d.append(s, b); box.appendChild(d);
      }
    } catch (e) {
      box.innerHTML = '<div class="empty">Search failed. Check your internet connection.</div>';
    }
  }

  // C / C++
  const vcExe = () => q(join(S.vcpkg, WIN ? 'vcpkg.exe' : 'vcpkg'));
  const TRIP = WIN ? ' --triplet x64-mingw-dynamic --host-triplet x64-mingw-dynamic' : '';
  async function refreshVcpkg() {
    S.vcpkgInstalled = (await api.vcpkgInfo()).installed;
    $('#vcStatus').innerHTML = S.vcpkgInstalled ? '<span class="ok">✔ vcpkg is installed</span>' : '<span class="bad">vcpkg is not installed yet</span>';
    $('#vcSetup').classList.toggle('hidden', S.vcpkgInstalled);
  }
  async function vcpkgSetup() {
    if (S.tools && !S.tools.git) { toast('Git is needed first.', 'warn', { label: 'Open Setup', run: () => showPane('setup') }); return; }
    await job(async () => {
      const boot = WIN ? `${q(join(S.vcpkg, 'bootstrap-vcpkg.bat'))} -disableMetrics` : `sh ${q(join(S.vcpkg, 'bootstrap-vcpkg.sh'))} -disableMetrics`;
      await cmdRun(`git clone --depth 1 https://github.com/microsoft/vcpkg ${q(S.vcpkg)} && ${boot}`);
      await refreshVcpkg();
    });
  }
  function vc(action) {
    return async () => {
      if (!S.vcpkgInstalled) { toast('Install vcpkg first.', 'warn'); return; }
      let arg = '';
      if (action !== 'list') { const n = nameFrom('#vcName'); if (!n) return; arg = ' ' + n; }
      const trip = (action === 'install' || action === 'remove') ? TRIP : '';
      await job(() => cmdRun(`${vcExe()} ${action}${arg}${trip}`));
    };
  }

  // Setup
  const TOOLS = [
    { keys: ['python'], name: 'Python', id: 'Python.Python.3.12' },
    { keys: ['java'], name: 'Java (JDK 21)', id: 'Microsoft.OpenJDK.21' },
    { keys: ['gcc', 'gpp'], name: 'C and C++ compiler', id: 'BrechtSanders.WinLibs.POSIX.UCRT' },
    { keys: ['git'], name: 'Git', note: 'needed for C and C++ libraries', id: 'Git.Git' }
  ];
  const has = t => S.tools && t.keys.every(k => S.tools[k]);
  const wingetCmd = id => `winget install -e --id ${id} --silent --accept-package-agreements --accept-source-agreements`;

  async function refreshTools(recheck) {
    if (recheck || !S.tools) {
      $('#setupRows').innerHTML = '<div class="empty">Checking this PC...</div>';
      S.tools = await api.check();
    }
    const box = $('#setupRows');
    box.innerHTML = '';
    for (const t of TOOLS) {
      const ok = has(t);
      const row = el('div', 'toolrow', `<span class="st-ic ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'}</span>`);
      const tx = el('div', 'tx');
      const nm = el('span', 'nm'); nm.textContent = t.name;
      const st = el('span', 'st'); st.textContent = ok ? S.tools[t.keys[0]] : ('Not installed' + (t.note ? ` (${t.note})` : ''));
      tx.append(nm, st);
      row.appendChild(tx);
      if (!ok) {
        const b = el('button', 'primary'); b.textContent = 'Install';
        b.disabled = working;
        b.onclick = () => installTools([t]);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    $('#setupAll').disabled = working || TOOLS.every(has);
  }
  async function installTools(list) {
    if (!WIN) { toast('Automatic install only works on Windows.', 'warn'); return; }
    if (S.tools && !S.tools.winget) { logAdd('winget was not found. Install "App Installer" from the Microsoft Store, then press Check again.\n'); return; }
    if (!list.length) { toast('Everything is already installed.', 'ok'); return; }
    await job(async () => {
      for (const t of list) await cmdRun(wingetCmd(t.id));
      await refreshTools(true);
      await restartShell('[tools updated, terminal restarted]');
    });
    refreshTools();
  }

  // Settings
  function defineThemes() {
    monaco.editor.defineTheme('cbx-dark', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': '#1b1d23', 'editorGutter.background': '#1b1d23', 'editor.lineHighlightBackground': '#23262d',
        'editor.lineHighlightBorder': '#00000000', 'editorLineNumber.foreground': '#4c525c', 'editorLineNumber.activeForeground': '#9aa1ac',
        'editorIndentGuide.background1': '#2a2e35', 'editor.selectionBackground': '#2b3c5c', 'editorWidget.background': '#262a31',
        'editorWidget.border': '#2e323a', 'scrollbarSlider.background': '#6b727d40'
      }
    });
    monaco.editor.defineTheme('cbx-light', {
      base: 'vs', inherit: true, rules: [],
      colors: {
        'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f6f9', 'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#b4bac3', 'editorLineNumber.activeForeground': '#5b6370', 'editor.selectionBackground': '#cfe0fc',
        'editorIndentGuide.background1': '#eceef2', 'editorWidget.background': '#ffffff', 'editorWidget.border': '#dde1e7'
      }
    });
    monaco.editor.defineTheme('cbx-monokai', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'keyword', foreground: 'f92672' }, { token: 'string', foreground: 'e6db74' },
        { token: 'comment', foreground: '75715e', fontStyle: 'italic' }, { token: 'number', foreground: 'ae81ff' },
        { token: 'type', foreground: '66d9ef' }, { token: 'function', foreground: 'a6e22e' }
      ],
      colors: {
        'editor.background': '#272822', 'editorGutter.background': '#272822', 'editor.lineHighlightBackground': '#3e3d32',
        'editor.lineHighlightBorder': '#00000000', 'editorLineNumber.foreground': '#75756f', 'editorLineNumber.activeForeground': '#c2c2bf',
        'editor.selectionBackground': '#49483e', 'editorWidget.background': '#2d2e27', 'editorWidget.border': '#3a3b33'
      }
    });
    monaco.editor.defineTheme('cbx-nord', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'keyword', foreground: '81a1c1' }, { token: 'string', foreground: 'a3be8c' },
        { token: 'comment', foreground: '636b78', fontStyle: 'italic' }, { token: 'number', foreground: 'b48ead' },
        { token: 'type', foreground: '8fbcbb' }, { token: 'function', foreground: '88c0d0' }
      ],
      colors: {
        'editor.background': '#2e3440', 'editorGutter.background': '#2e3440', 'editor.lineHighlightBackground': '#3b4252',
        'editor.lineHighlightBorder': '#00000000', 'editorLineNumber.foreground': '#4c566a', 'editorLineNumber.activeForeground': '#9299a8',
        'editor.selectionBackground': '#3b4a6b', 'editorWidget.background': '#353a47', 'editorWidget.border': '#3c4253'
      }
    });
    monaco.editor.defineTheme('cbx-github', {
      base: 'vs', inherit: true,
      rules: [
        { token: 'keyword', foreground: 'cf222e' }, { token: 'string', foreground: '0a3069' },
        { token: 'comment', foreground: '6e7781', fontStyle: 'italic' }, { token: 'number', foreground: '0550ae' },
        { token: 'type', foreground: '8250df' }, { token: 'function', foreground: '6639ba' }
      ],
      colors: {
        'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f6f8fa', 'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#d0d7de', 'editorLineNumber.activeForeground': '#57606a', 'editor.selectionBackground': '#ddeeff',
        'editorWidget.background': '#ffffff', 'editorWidget.border': '#d0d7de'
      }
    });
  }

  function monacoThemeFor(theme) {
    const map = { dark: 'cbx-dark', light: 'cbx-light', monokai: 'cbx-monokai', nord: 'cbx-nord', 'github-light': 'cbx-github' };
    return map[theme] || 'cbx-dark';
  }

  function applySettings() {
    const st = S.settings;
    // body class for CSS theme tokens
    document.body.classList.remove('light', 'monokai', 'nord', 'github-light');
    if (st.theme !== 'dark') document.body.classList.add(st.theme);
    // monaco theme
    monaco.editor.setTheme(monacoThemeFor(st.theme));
    // terminal theme
    const termTheme = TERM_THEMES[st.theme] || TERM_THEMES.dark;
    if (editor) editor.updateOptions({
      fontSize: st.fontSize,
      wordWrap: st.wordWrap ? 'on' : 'off',
      minimap: { enabled: !!st.minimap }
    });
    if (term) {
      term.options.theme = termTheme;
      term.options.fontSize = Math.max(11, st.fontSize - 1);
      fit.fit();
    }
  }
  async function setSetting(patch) {
    S.settings = await api.setSettings(patch);
    applySettings();
    loadSettingsUI();
  }
  async function loadSettingsUI() {
    const st = S.settings;
    $$('#setTheme button').forEach(b => b.classList.toggle('on', b.dataset.v === st.theme));
    $('#setFont').value = st.fontSize; $('#setFontVal').textContent = st.fontSize + ' px';
    $('#setWrap').checked = !!st.wordWrap;
    $('#setMinimap').checked = !!st.minimap;
    $('#setAuto').checked = !!st.autosave;
    $('#setUpd').checked = !!st.autoCheckUpdates;
    $('#setWs').textContent = S.ws;

    // recent workspaces
    const list = $('#recentList');
    list.innerHTML = '';
    try {
      const recents = await api.recentFolders();
      if (!recents.length) {
        list.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:6px 2px">No recent projects</div>';
        return;
      }
      for (const p of recents) {
        const row = el('div', 'recent-row');
        const name = el('span', 'rname'); name.textContent = basename(p);
        const path = el('span', 'rpath'); path.textContent = p; path.title = p;
        row.append(name, path);
        row.onclick = () => { closeDialog(); openWorkspace(p); };
        list.appendChild(row);
      }
    } catch (_) {}
  }

  // Updates
  function renderUpdate() {
    const u = S.upd, st = u.state;
    $('#updCur').textContent = 'v' + S.version;
    $('#updMsg').textContent = u.message || 'Check to see if a newer version is available.';
    $('#updMsg').className = 'updmsg ' + (st === 'error' ? 'bad' : (st === 'ready' || st === 'available' || st === 'latest') ? 'ok' : '');
    $('#updBarWrap').classList.toggle('hidden', st !== 'downloading' && st !== 'ready');
    $('#updBar').style.width = (u.percent || 0) + '%';
    $('#updNotes').classList.toggle('hidden', !(u.notes && (st === 'available' || st === 'downloading' || st === 'ready')));
    $('#updNotes').textContent = u.notes ? "What's new\n\n" + u.notes : '';
    $('#updCheck').classList.toggle('hidden', st === 'available' || st === 'downloading' || st === 'ready');
    $('#updCheck').disabled = st === 'checking' || st === 'unavailable';
    $('#updCheck').textContent = st === 'checking' ? 'Checking...' : 'Check for updates';
    $('#updDownload').classList.toggle('hidden', st !== 'available');
    $('#updInstall').classList.toggle('hidden', st !== 'ready');
    $('#updDot').classList.toggle('hidden', !(st === 'available' || st === 'ready'));
  }
  function onUpdate(u) {
    const prev = S.upd.state;
    S.upd = u;
    renderUpdate();
    if (u.state === 'available' && prev !== 'available') toast(`CodeBox ${u.version} is available.`, 'ok', { label: 'View', run: () => openDialog('update') });
    if (u.state === 'ready' && prev !== 'ready') toast('Update downloaded.', 'ok', { label: 'Restart now', run: async () => { await saveAll(); api.updInstall(); } });
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    $$('#langSeg button').forEach(b => { b.onclick = () => setLang(b.dataset.lang); });
    $('#btnNew').onclick = e => { e.stopPropagation(); $('#newMenu').classList.contains('hidden') ? newMenu($('#btnNew')) : closeMenu(); };
    $('#sideNew').onclick = () => newFile(S.lang);
    $('#sideRefresh').onclick = () => renderTree();
    $('#btnOpen').onclick = () => openWorkspace();
    $('#sideOpen').onclick = () => openWorkspace();
    $('#btnSave').onclick = saveCurrent;
    $('#btnRun').onclick = run;
    $('#btnStop').onclick = () => { if (busy) restartShell('[stopped]'); };
    $('#btnPkg').onclick = () => {
      const l = S.active ? langOf(S.active) : S.lang;
      openDialog(l === 'java' ? 'java' : (l === 'c' || l === 'cpp') ? 'cpp' : 'python');
    };
    $('#btnSetup').onclick = () => openDialog('setup');
    $('#btnSettings').onclick = () => openDialog('settings');
    $('#btnUpdate').onclick = () => openDialog('update');
    $('#dlgClose').onclick = closeDialog;
    $('#overlay').onclick = e => { if (e.target.id === 'overlay') closeDialog(); };
    $$('#dlgNav button').forEach(b => { b.onclick = () => showPane(b.dataset.pane); });
    $('#logClear').onclick = () => { $('#log').textContent = ''; };

    $('#termClear').onclick = () => { term.clear(); term.focus(); };
    $('#termRestart').onclick = () => restartShell();
    $('#termToggle').onclick = () => showPanel();

    // panel tabs
    $('#tabTerminal').onclick = () => switchPanelTab('terminal');
    $('#tabProblems').onclick = () => { switchPanelTab('problems'); renderProblemsPane(); showPanel(true); };

    // sidebar rail
    $('#railExplorer').onclick = () => switchPanel('Explorer');
    $('#railSearch').onclick = () => switchPanel('Search');
    $('#railGit').onclick = () => switchPanel('Git');

    // search
    $('#searchGo').onclick = runSearch;
    $('#searchQuery').onkeydown = e => { if (e.key === 'Enter') runSearch(); };

    // git
    $('#gitRefresh').onclick = refreshGitPanel;
    $('#gitStageAll').onclick = async () => {
      const r = await api.gitStage(S.ws, []);
      if (r.ok) { toast('Staged all changes', 'ok'); refreshGitPanel(); }
      else toast('Stage failed: ' + (r.error || ''), 'err');
    };
    $('#gitCommitBtn').onclick = async () => {
      const msg = $('#gitMsg').value.trim();
      if (!msg) { toast('Enter a commit message.', 'warn'); $('#gitMsg').focus(); return; }
      const r = await api.gitCommit(S.ws, msg);
      if (r.ok) { toast('Committed', 'ok'); $('#gitMsg').value = ''; refreshGitPanel(); }
      else toast('Commit failed: ' + (r.error || ''), 'err');
    };
    $('#gitPushBtn').onclick = async () => {
      toast('Pushing…');
      const r = await api.gitPush(S.ws);
      if (r.ok) { toast('Pushed', 'ok'); refreshGitPanel(); }
      else toast('Push failed: ' + (r.error || ''), 'err');
    };
    $('#gitMsg').onkeydown = e => { if (e.key === 'Enter' && e.ctrlKey) $('#gitCommitBtn').click(); };

    const pip = args => job(() => cmdRun(`python -m pip ${args}`));
    $('#pyInstall').onclick = () => { const n = nameFrom('#pyName'); if (n) pip(`install ${n}`); };
    $('#pyRemove').onclick = () => { const n = nameFrom('#pyName'); if (n) pip(`uninstall -y ${n}`); };
    $('#pyList').onclick = () => pip('list');
    $('#pyReq').onclick = () => pip(`install -r ${q(join(S.ws, 'requirements.txt'))}`);
    $('#pyName').onkeydown = e => { if (e.key === 'Enter') $('#pyInstall').click(); };

    $('#jvSearch').onclick = javaSearch;
    $('#jvName').onkeydown = e => { if (e.key === 'Enter') javaSearch(); };

    $('#vcSetup').onclick = vcpkgSetup;
    $('#vcInstall').onclick = vc('install');
    $('#vcSearch').onclick = vc('search');
    $('#vcRemove').onclick = vc('remove');
    $('#vcList').onclick = vc('list');
    $('#vcName').onkeydown = e => { if (e.key === 'Enter') $('#vcInstall').click(); };

    $('#setupRefresh').onclick = () => refreshTools(true);
    $('#setupAll').onclick = () => installTools(TOOLS.filter(t => !has(t)));

    $$('#setTheme button').forEach(b => { b.onclick = () => setSetting({ theme: b.dataset.v }); });
    $('#setFont').oninput = e => { $('#setFontVal').textContent = e.target.value + ' px'; setSetting({ fontSize: Number(e.target.value) }); };
    $('#setWrap').onchange = e => setSetting({ wordWrap: e.target.checked });
    $('#setMinimap').onchange = e => setSetting({ minimap: e.target.checked });
    $('#setAuto').onchange = e => setSetting({ autosave: e.target.checked });
    $('#setUpd').onchange = e => setSetting({ autoCheckUpdates: e.target.checked });
    $('#setOpenWs').onclick = () => api.openFolder(S.ws);

    $('#updCheck').onclick = () => { S.upd = { ...S.upd, state: 'checking', message: 'Checking for updates...' }; renderUpdate(); api.updCheck(); };
    $('#updDownload').onclick = () => api.updDownload();
    $('#updInstall').onclick = async () => { await saveAll(); api.updInstall(); };
    api.on('upd:status', onUpdate);
    api.on('pkg:log', logAdd);

    window.addEventListener('keydown', e => {
      if (!$('#ask').classList.contains('hidden')) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') { e.preventDefault(); run(); }
      else if (mod && k === 's') { e.preventDefault(); saveCurrent(); }
      else if (mod && k === 'n') { e.preventDefault(); newFile(S.lang); }
      else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); switchPanel('Search'); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); setSetting({ fontSize: Math.min(26, S.settings.fontSize + 1) }); }
      else if (mod && k === '-') { e.preventDefault(); setSetting({ fontSize: Math.max(10, S.settings.fontSize - 1) }); }
      else if (mod && k === '`') { e.preventDefault(); showPanel(); }
      else if (e.key === 'Escape') { if (!$('#newMenu').classList.contains('hidden')) closeMenu(); else closeDialog(); }
    });
    window.addEventListener('beforeunload', () => { if (S.settings.autosave) for (const [p, r] of S.models) if (r.dirty) api.write(p, r.model.getValue()); });
  }

  async function boot() {
    const info = await api.info();
    S.ws = info.path; S.helper = info.helper; S.vcpkg = info.vcpkgRoot; S.version = info.version;
    S.settings = info.settings; S.examples = info.examples;
    if (WIN) document.body.classList.add('overlay');

    defineThemes();
    editor = monaco.editor.create($('#editor'), {
      model: null, theme: monacoThemeFor(S.settings.theme || 'dark'), automaticLayout: true,
      fontSize: S.settings.fontSize, wordWrap: S.settings.wordWrap ? 'on' : 'off',
      fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace', fontLigatures: false,
      minimap: { enabled: !!S.settings.minimap }, scrollBeyondLastLine: false, tabSize: 4, padding: { top: 10 },
      renderLineHighlight: 'all', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', roundedSelection: true,
      bracketPairColorization: { enabled: true }, occurrencesHighlight: 'off', guides: { bracketPairs: false, indentation: true },
      scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11 }
    });
    editor.onDidChangeCursorPosition(updateStatusbar);
    editor.addCommand(monaco.KeyCode.F5, run);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrent);

    renderCards();
    setLang('python');
    initTerminal();
    wire();
    applySettings();
    setState('idle', 'Ready');
    await api.shellStart();
    await renderTree();
    await openFirst();
    S.vcpkgInstalled = (await api.vcpkgInfo()).installed;
    onUpdate(await api.updGet());
    api.check().then(t => {
      S.tools = t;
      if (WIN && !(t.python || t.java || t.gcc)) openDialog('setup');
    });
    // initial git status for statusbar branch
    refreshGitPanel();
    // render empty problems pane
    renderProblemsPane();
  }

  // test hook
  window.__cbxTest = async mode => {
    if (mode === 'welcome') { for (const k of [...S.models.keys()]) closeTab(k, true); return 'ok'; }
    if (mode === 'run') { await openFirst(); await run(); return 'ok'; }
    if (mode === 'menu') { newMenu($('#btnNew')); return 'ok'; }
    if (mode === 'light') { await setSetting({ theme: 'light' }); return 'ok'; }
    if (mode === 'dialog') { openDialog('setup'); return 'ok'; }
    return { tabs: $$('.tab').length, rows: $$('#tree .row').length, active: S.active, busy, state: $('#runState').textContent, version: S.version };
  };

  const base = new URL('../node_modules/monaco-editor/min/', location.href).href;
  window.MonacoEnvironment = {
    getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
      `self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`)
  };
  require.config({ paths: { vs: base + 'vs' } });
  require(['vs/editor/editor.main'], () => { boot().catch(e => console.error('boot failed', e)); });
})();
