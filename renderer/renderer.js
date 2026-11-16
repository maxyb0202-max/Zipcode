(function () {
  'use strict';
  const api = window.api;
  const WIN = api.platform === 'win32';
  const EOL = WIN ? '\r\n' : '\n';
  const SENT = WIN ? 'echo ::CBX::%CD%' : 'echo ::CBX::$PWD';
  const JOIN = WIN ? ' & ' : '; ';
  const SEP = WIN ? '\\' : '/';

  const $ = s => document.querySelector(s);
  const join = (...p) => p.join(SEP);
  const cut = p => Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  const dirname = p => p.slice(0, cut(p));
  const basename = p => p.slice(cut(p) + 1);
  const q = s => `"${s}"`;

  const LANGS = {
    python: { ext: ['py'], monaco: 'python', run: ['py'], label: 'Python', def: 'hello' },
    java: { ext: ['java'], monaco: 'java', run: ['java'], label: 'Java', def: 'Main' },
    c: { ext: ['c', 'h'], monaco: 'c', run: ['c'], label: 'C', def: 'hello' },
    cpp: { ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], monaco: 'cpp', run: ['cpp', 'cc', 'cxx'], label: 'C++', def: 'hello' }
  };
  const extOf = f => (f.includes('.') ? f.split('.').pop().toLowerCase() : '');
  function langOf(f) {
    const e = extOf(f);
    for (const k in LANGS) if (LANGS[k].ext.includes(e)) return k;
    return null;
  }

  const S = {
    ws: '', helper: '', vcpkg: '', version: '', vcpkgInstalled: false, tools: null, active: null,
    models: new Map(), expanded: new Set(), settings: {}, examples: {}, upd: { state: 'idle' }
  };
  let editor = null;

  let statusTimer = null;
  function status(msg) {
    $('#status').textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 6000);
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
        $('#askOk').onclick = $('#askCancel').onclick = inp.onkeydown = null;
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
      inp.onkeydown = e => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    });
  }

  // ------------------------------------------------------------ terminal
  let term, fit, buf = '', busy = true, pend = '', atLineStart = true;
  const hist = []; let histIdx = -1;

  const TERM_THEMES = {
    dark: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78' },
    light: { background: '#ffffff', foreground: '#222222', cursor: '#222222', selectionBackground: '#add6ff' }
  };

  function out(s) {
    if (!s) return;
    term.write(s);
    atLineStart = s.endsWith('\n');
  }
  function note(s) {
    if (!atLineStart) out('\r\n');
    out(`\x1b[90m${s}\x1b[0m\r\n`);
  }

  function flush() {
    for (;;) {
      const i = pend.indexOf('::CBX::');
      if (i < 0) break;
      const j = pend.indexOf('\r\n', i);
      if (j < 0) { out(pend.slice(0, i)); pend = pend.slice(i); return; }
      out(pend.slice(0, i));
      if (!atLineStart) out('\r\n');
      term.write(`\x1b[32m${pend.slice(i + 7, j)}>\x1b[0m `);
      atLineStart = false;
      pend = pend.slice(j + 2);
      busy = false;
      setRunning(false);
    }
    let hold = 0;
    for (let k = Math.min(6, pend.length); k > 0; k--) {
      if ('::CBX::'.startsWith(pend.slice(-k))) { hold = k; break; }
    }
    out(pend.slice(0, pend.length - hold));
    pend = pend.slice(pend.length - hold);
  }

  function setRunning(on) {
    $('#btnRun').disabled = on;
    $('#btnStop').classList.toggle('pulse', on);
  }

  function submit(line) {
    if (busy) { api.shellWrite(line + EOL); return; }   // input for the running program
    if (line.trim() && hist[hist.length - 1] !== line) hist.push(line);
    histIdx = -1;
    if (/^\s*(cls|clear)\s*$/i.test(line)) { term.clear(); line = ''; }
    busy = true;
    api.shellWrite((line.trim() ? line + JOIN + SENT : SENT) + EOL);
  }

  function replaceLine(s) {
    term.write('\b \b'.repeat(buf.length));
    buf = s;
    term.write(s);
    atLineStart = false;
  }

  function runInTerminal(cmd) {
    if (busy) { status('Something is still running. Press Stop first.'); return false; }
    buf = '';
    out('\r\n');
    busy = true;
    setRunning(true);
    api.shellWrite(cmd + JOIN + SENT + EOL);
    term.focus();
    return true;
  }

  async function restartShell(msg) {
    buf = ''; pend = ''; busy = true;
    setRunning(false);
    note(msg || '[terminal restarted]');
    await api.shellStart();
  }

  function initTerminal() {
    term = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace', fontSize: Math.max(11, S.settings.fontSize - 1), cursorBlink: true,
      theme: TERM_THEMES[S.settings.theme] || TERM_THEMES.dark, scrollback: 5000
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('#term'));
    fit.fit();

    // Ctrl+C copies when text is selected, Ctrl+V pastes.
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false; }
      if (k === 'v') return false;   // let the browser fire a paste event
      return true;
    });

    term.onData(data => {
      if (data === '\x1b[A' || data === '\x1b[B') {          // history
        if (busy || !hist.length) return;
        if (data === '\x1b[A') histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
        else if (histIdx >= 0) histIdx = histIdx + 1 >= hist.length ? -1 : histIdx + 1;
        replaceLine(histIdx < 0 ? '' : hist[histIdx]);
        return;
      }
      if (data.startsWith('\x1b')) return;               // other escape keys
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

    const sp = $('#splitter'), wrap = $('#termwrap');
    sp.addEventListener('mousedown', e => {
      e.preventDefault();
      const startY = e.clientY, startH = wrap.offsetHeight;
      const move = ev => {
        wrap.style.height = Math.max(80, Math.min(window.innerHeight - 200, startH + startY - ev.clientY)) + 'px';
        fit.fit();
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ------------------------------------------------------------ files / tabs
  async function renderTree() {
    $('#wsname').textContent = basename(S.ws) || S.ws;
    $('#wsname').title = S.ws;
    const root = document.createElement('div');
    await renderDir(S.ws, root, 0);
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
    if (rec) {                                 // reopen under the new name, keeping unsaved text
      const text = rec.model.getValue(), dirty = rec.dirty, wasActive = S.active === p;
      closeTab(p, true);
      await openFile(res.path);
      const nr = S.models.get(res.path);
      if (dirty) { nr.model.setValue(text); }
      if (!wasActive && S.active !== res.path) activate(res.path);
    }
    renderTree();
    status('Renamed to ' + basename(res.path));
  }

  async function renderDir(dir, el, depth) {
    const items = await api.list(dir);
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'row' + (it.path === S.active ? ' sel' : '');
      row.style.paddingLeft = (8 + depth * 14) + 'px';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = (it.dir ? (S.expanded.has(it.path) ? '▾ ' : '▸ ') : '') + it.name;
      row.appendChild(nm);
      if (it.dir) {
        row.onclick = () => { S.expanded.has(it.path) ? S.expanded.delete(it.path) : S.expanded.add(it.path); renderTree(); };
      } else {
        const acts = document.createElement('span'); acts.className = 'acts';
        const rn = document.createElement('span'); rn.textContent = '✎'; rn.title = 'Rename';
        rn.onclick = e => { e.stopPropagation(); renameFile(it.path); };
        const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Delete';
        x.onclick = async e => {
          e.stopPropagation();
          if (await api.remove(it.path)) { closeTab(it.path, true); renderTree(); }
        };
        acts.append(rn, x);
        row.appendChild(acts);
        row.onclick = () => openFile(it.path);
        row.ondblclick = () => renameFile(it.path);
      }
      el.appendChild(row);
      if (it.dir && S.expanded.has(it.path)) await renderDir(it.path, el, depth + 1);
    }
  }

  function renderTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    for (const [p, rec] of S.models) {
      const t = document.createElement('div');
      t.className = 'tab' + (p === S.active ? ' on' : '');
      t.title = p;
      const nm = document.createElement('span');
      nm.textContent = (rec.dirty ? '● ' : '') + basename(p);
      const x = document.createElement('span');
      x.className = 'x'; x.textContent = '×';
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
      try { text = await api.read(p); } catch (e) { status('Could not open ' + basename(p)); return; }
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
    if (lang) { $('#lang').value = lang; fillExamples(); }
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
    status('Saved ' + basename(S.active));
  }
  async function saveAll() {
    let any = false;
    for (const [p, rec] of S.models) if (rec.dirty) { await save(p); any = true; }
    if (any) renderTabs();
  }

  async function newFile(lang, example) {
    let name = '';
    if (!example) {
      name = await ask(`New ${LANGS[lang].label} file name`, LANGS[lang].def + '.' + LANGS[lang].ext[0]);
      if (!name) return;
    }
    const r = await api.newFile(lang, S.ws, name, example);
    if (!r.ok) { status(r.error); return; }
    await renderTree();
    await openFile(r.path);
    status('Created ' + basename(r.path) + (example ? ' - press F5 to run it' : ''));
  }

  function fillExamples() {
    const sel = $('#examples'), lang = $('#lang').value;
    sel.innerHTML = `<option value="">Examples (${LANGS[lang].label})...</option>`;
    for (const t of S.examples[lang] || []) {
      const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o);
    }
  }

  async function openWorkspace() {
    const p = await api.pickFolder();
    if (!p) return;
    await saveAll();
    for (const k of [...S.models.keys()]) closeTab(k, true);
    S.ws = p;
    S.expanded.clear();
    $('#setWs').textContent = p;
    await restartShell('[opened ' + p + ']');
    await renderTree();
    await openFirst();
  }

  async function openFirst() {
    const items = (await api.list(S.ws)).filter(i => !i.dir && langOf(i.name));
    if (items.length) await openFile(items[0].path);
    else renderTabs();
  }

  function updateStatusbar() {
    const lang = S.active ? langOf(S.active) : null;
    $('#sbLang').textContent = lang ? LANGS[lang].label : '';
    const pos = editor && editor.getModel() ? editor.getPosition() : null;
    $('#sbPos').textContent = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
    $('#sbVer').textContent = 'CodeBox ' + S.version;
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
    const link = m ? m[1].trim().replace(/[&|<>^%]/g, '') + ' ' : '';
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
    if (!f) { status('Create or open a file first.'); return; }
    const lang = langOf(f);
    if (!lang || !LANGS[lang].run.includes(extOf(f))) { status('This file type cannot be run. Open a .py, .java, .c or .cpp file.'); return; }
    await saveAll();
    const need = { python: 'python', java: 'java', c: 'gcc', cpp: 'gpp' }[lang];
    if (S.tools && S.tools[need] === null) {
      const names = { python: 'Python', java: 'Java (JDK)', c: 'a C compiler', cpp: 'a C++ compiler' };
      status(`${names[lang]} is not installed yet.`);
      openDialog('setup');
      return;
    }
    runInTerminal(buildRun(f));
  }

  // ------------------------------------------------------------ packages / setup dialog
  const okName = s => /^[A-Za-z0-9_.\-=<>!~\[\],@:/ ]+$/.test(s);
  let working = false;

  function logAdd(t) {
    const el = $('#log');
    t = t.replace(/\r\n/g, '\n').split('\r').filter(s => !/^\s*[-\\|/]?\s*$/.test(s) || s.includes('\n')).join('\n');
    el.textContent += t;
    if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
    el.scrollTop = el.scrollHeight;
  }

  async function job(fn) {
    if (working) { status('Wait for the current job to finish.'); return; }
    working = true;
    document.querySelectorAll('#dlg .pane:not(#pane-update):not(#pane-settings) button').forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (e) { logAdd(`\n[error: ${e.message}]\n\n`); }
    finally {
      working = false;
      document.querySelectorAll('#dlg .pane button').forEach(b => { b.disabled = false; });
    }
  }
  function cmd(c) { logAdd(`> ${c}\n`); return api.run({ cmd: c, cwd: S.ws }); }

  function nameFrom(id) {
    const v = $(id).value.trim();
    if (!v) { status('Type a package name first.'); return null; }
    if (!okName(v)) { status('That name has characters that are not allowed.'); return null; }
    return v;
  }

  function openDialog(pane) {
    $('#overlay').classList.remove('hidden');
    showPane(pane);
  }
  function showPane(pane) {
    document.querySelectorAll('#dlgTabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + pane));
    if (pane === 'java') refreshJars();
    if (pane === 'cpp') refreshVcpkg();
    if (pane === 'setup') refreshTools();
    if (pane === 'settings') loadSettingsUI();
    if (pane === 'update') renderUpdate();
  }

  // Java
  async function refreshJars() {
    const box = $('#jvInstalled');
    const jars = await api.mvnList(S.ws);
    box.innerHTML = jars.length ? '' : '<div class="empty">Nothing installed yet</div>';
    for (const j of jars) {
      const d = document.createElement('div'); d.className = 'item';
      const s = document.createElement('span'); s.textContent = j; s.title = j;
      const b = document.createElement('button'); b.textContent = 'Remove';
      b.onclick = async () => { await api.mvnRemove(S.ws, j); refreshJars(); renderTree(); };
      d.append(s, b); box.appendChild(d);
    }
  }
  async function addJar(g, a, v) {
    await job(async () => {
      logAdd(`Adding ${g}:${a}:${v}\n`);
      await api.mvnAdd(S.ws, g, a, v);
      await refreshJars();
      renderTree();
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
        const d = document.createElement('div'); d.className = 'item';
        const s = document.createElement('span'); s.textContent = `${r.g}:${r.a}:${r.v}`; s.title = s.textContent;
        const b = document.createElement('button'); b.textContent = 'Add'; b.className = 'primary';
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
    $('#vcStatus').innerHTML = S.vcpkgInstalled ? '<span class="ok">vcpkg is installed</span>' : '<span class="bad">vcpkg is not installed yet</span>';
    $('#vcSetup').classList.toggle('hidden', S.vcpkgInstalled);
  }
  async function vcpkgSetup() {
    if (S.tools && !S.tools.git) { status('Git is needed first. Install it in the Setup tab.'); showPane('setup'); return; }
    await job(async () => {
      const boot = WIN ? `${q(join(S.vcpkg, 'bootstrap-vcpkg.bat'))} -disableMetrics` : `sh ${q(join(S.vcpkg, 'bootstrap-vcpkg.sh'))} -disableMetrics`;
      await cmd(`git clone --depth 1 https://github.com/microsoft/vcpkg ${q(S.vcpkg)} && ${boot}`);
      await refreshVcpkg();
    });
  }
  function vc(action) {
    return async () => {
      if (!S.vcpkgInstalled) { status('Install vcpkg first.'); return; }
      let arg = '';
      if (action !== 'list') { const n = nameFrom('#vcName'); if (!n) return; arg = ' ' + n; }
      const trip = (action === 'install' || action === 'remove') ? TRIP : '';
      await job(() => cmd(`${vcExe()} ${action}${arg}${trip}`));
    };
  }

  // Setup
  const TOOLS = [
    { keys: ['python'], name: 'Python', id: 'Python.Python.3.12' },
    { keys: ['java'], name: 'Java (JDK 21)', id: 'Microsoft.OpenJDK.21' },
    { keys: ['gcc', 'gpp'], name: 'C / C++ compiler (gcc, g++)', id: 'BrechtSanders.WinLibs.POSIX.UCRT' },
    { keys: ['git'], name: 'Git (for C / C++ packages)', id: 'Git.Git' }
  ];
  const has = t => S.tools && t.keys.every(k => S.tools[k]);
  const wingetCmd = id => `winget install -e --id ${id} --silent --accept-package-agreements --accept-source-agreements`;

  async function refreshTools(recheck) {
    if (recheck || !S.tools) {
      $('#setupRows').innerHTML = '<div class="empty">Checking...</div>';
      S.tools = await api.check();
    }
    const box = $('#setupRows');
    box.innerHTML = '';
    for (const t of TOOLS) {
      const row = document.createElement('div'); row.className = 'toolrow';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.name;
      const st = document.createElement('span'); st.className = 'st ' + (has(t) ? 'ok' : 'bad');
      st.textContent = has(t) ? '✓ ' + S.tools[t.keys[0]] : 'Not installed';
      row.append(nm, st);
      if (!has(t)) {
        const b = document.createElement('button'); b.textContent = 'Install'; b.className = 'primary';
        b.disabled = working;
        b.onclick = () => installTools([t]);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }
  async function installTools(list) {
    if (!WIN) { status('Automatic install only works on Windows.'); return; }
    if (S.tools && !S.tools.winget) { logAdd('winget was not found. Install "App Installer" from the Microsoft Store, then press Re-check.\n'); return; }
    if (!list.length) { status('Everything is already installed.'); return; }
    await job(async () => {
      for (const t of list) await cmd(wingetCmd(t.id));
      await refreshTools(true);
      await restartShell('[tools updated, terminal restarted]');
    });
    refreshTools();
  }

  // Settings
  function applySettings() {
    const st = S.settings;
    document.body.classList.toggle('light', st.theme === 'light');
    monaco.editor.setTheme(st.theme === 'light' ? 'vs' : 'vs-dark');
    if (editor) editor.updateOptions({ fontSize: st.fontSize, wordWrap: st.wordWrap ? 'on' : 'off' });
    if (term) {
      term.options.theme = TERM_THEMES[st.theme] || TERM_THEMES.dark;
      term.options.fontSize = Math.max(11, st.fontSize - 1);
      fit.fit();
    }
  }
  async function setSetting(patch) {
    S.settings = await api.setSettings(patch);
    applySettings();
  }
  function loadSettingsUI() {
    const st = S.settings;
    $('#setTheme').value = st.theme;
    $('#setFont').value = st.fontSize; $('#setFontVal').textContent = st.fontSize + ' px';
    $('#setWrap').checked = !!st.wordWrap;
    $('#setAuto').checked = !!st.autosave;
    $('#setUpd').checked = !!st.autoCheckUpdates;
    $('#setWs').textContent = S.ws;
  }

  // Updates
  function renderUpdate() {
    const u = S.upd, st = u.state;
    $('#updCur').textContent = 'v' + S.version;
    $('#updMsg').textContent = u.message || 'Press the button to check for a newer version.';
    $('#updMsg').className = 'updmsg ' + (st === 'error' ? 'bad' : (st === 'ready' || st === 'available' || st === 'latest') ? 'ok' : '');
    $('#updBarWrap').classList.toggle('hidden', st !== 'downloading' && st !== 'ready');
    $('#updBar').style.width = (u.percent || 0) + '%';
    $('#updNotes').classList.toggle('hidden', !(u.notes && (st === 'available' || st === 'downloading' || st === 'ready')));
    $('#updNotes').textContent = u.notes ? "What's new:\n" + u.notes : '';
    $('#updCheck').classList.toggle('hidden', st === 'available' || st === 'downloading' || st === 'ready');
    $('#updCheck').disabled = st === 'checking' || st === 'unavailable';
    $('#updDownload').classList.toggle('hidden', st !== 'available');
    $('#updInstall').classList.toggle('hidden', st !== 'ready');
    $('#updDot').classList.toggle('hidden', !(st === 'available' || st === 'ready'));
  }
  function onUpdate(u) {
    const prev = S.upd.state;
    S.upd = u;
    renderUpdate();
    if (u.state === 'available' && prev !== 'available') status(`CodeBox ${u.version} is available - open Update to install it.`);
    if (u.state === 'ready' && prev !== 'ready') status('Update downloaded - open Update and press Restart.');
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    $('#lang').onchange = () => fillExamples();
    $('#btnNew').onclick = () => newFile($('#lang').value);
    $('#examples').onchange = e => { const v = e.target.value; e.target.value = ''; if (v) newFile($('#lang').value, v); };
    $('#btnOpen').onclick = openWorkspace;
    $('#btnSave').onclick = saveCurrent;
    $('#btnRun').onclick = run;
    $('#btnStop').onclick = () => restartShell('[stopped]');
    $('#btnPkg').onclick = () => {
      const l = S.active ? langOf(S.active) : $('#lang').value;
      openDialog(l === 'java' ? 'java' : (l === 'c' || l === 'cpp') ? 'cpp' : 'python');
    };
    $('#btnSetup').onclick = () => openDialog('setup');
    $('#btnSettings').onclick = () => openDialog('settings');
    $('#btnUpdate').onclick = () => openDialog('update');
    $('#dlgClose').onclick = () => $('#overlay').classList.add('hidden');
    $('#overlay').onclick = e => { if (e.target.id === 'overlay') $('#overlay').classList.add('hidden'); };
    document.querySelectorAll('#dlgTabs button').forEach(b => { b.onclick = () => showPane(b.dataset.pane); });

    const pip = args => job(() => cmd(`python -m pip ${args}`));
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

    $('#setupRefresh').onclick = () => refreshTools(true);
    $('#setupAll').onclick = () => installTools(TOOLS.filter(t => !has(t)));

    $('#setTheme').onchange = e => setSetting({ theme: e.target.value });
    $('#setFont').oninput = e => { $('#setFontVal').textContent = e.target.value + ' px'; setSetting({ fontSize: Number(e.target.value) }); };
    $('#setWrap').onchange = e => setSetting({ wordWrap: e.target.checked });
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
      const k = e.key.toLowerCase();
      if (e.key === 'F5') { e.preventDefault(); run(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveCurrent(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'n') { e.preventDefault(); newFile($('#lang').value); }
      else if ((e.ctrlKey || e.metaKey) && (k === '=' || k === '+')) { e.preventDefault(); setSetting({ fontSize: Math.min(26, S.settings.fontSize + 1) }); }
      else if ((e.ctrlKey || e.metaKey) && k === '-') { e.preventDefault(); setSetting({ fontSize: Math.max(10, S.settings.fontSize - 1) }); }
      else if (e.key === 'Escape') $('#overlay').classList.add('hidden');
    });
    window.addEventListener('beforeunload', () => { if (S.settings.autosave) for (const [p, r] of S.models) if (r.dirty) api.write(p, r.model.getValue()); });
  }

  async function boot() {
    const info = await api.info();
    S.ws = info.path; S.helper = info.helper; S.vcpkg = info.vcpkgRoot; S.version = info.version;
    S.settings = info.settings; S.examples = info.examples;

    editor = monaco.editor.create($('#editor'), {
      model: null, theme: S.settings.theme === 'light' ? 'vs' : 'vs-dark', automaticLayout: true,
      fontSize: S.settings.fontSize, wordWrap: S.settings.wordWrap ? 'on' : 'off',
      fontFamily: 'Consolas, "Courier New", monospace', minimap: { enabled: false },
      scrollBeyondLastLine: false, tabSize: 4
    });
    editor.onDidChangeCursorPosition(updateStatusbar);
    editor.addCommand(monaco.KeyCode.F5, run);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrent);

    initTerminal();
    wire();
    applySettings();
    fillExamples();
    await api.shellStart();
    await renderTree();
    await openFirst();
    S.vcpkgInstalled = (await api.vcpkgInfo()).installed;
    onUpdate(await api.updGet());
    api.check().then(t => {
      S.tools = t;
      if (WIN && !(t.python || t.java || t.gcc)) openDialog('setup');
    });
  }

  window.__cbxTest = async () => {
    const made = [];
    for (const l of Object.keys(S.examples)) for (const ex of S.examples[l]) made.push((await api.newFile(l, S.ws, '', ex)).path);
    const r1 = made[3];
    const r2 = await api.newFile('cpp', S.ws, 'my prog', null);
    return {
      tabs: document.querySelectorAll('.tab').length,
      rows: document.querySelectorAll('#tree .row').length,
      active: S.active, busy, version: S.version, upd: S.upd,
      examples: S.examples, newJava: r1, newCpp: r2,
      run: S.active ? buildRun(S.active) : null,
      theme: document.body.className
    };
  };

  const base = new URL('../node_modules/monaco-editor/min/', location.href).href;
  window.MonacoEnvironment = {
    getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
      `self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`)
  };
  require.config({ paths: { vs: base + 'vs' } });
  require(['vs/editor/editor.main'], () => { boot().catch(e => console.error('boot failed', e)); });
})();
