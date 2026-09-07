// ==UserScript==
// @name         调控云录入助手
// @namespace    dcinput
// @version      1.1.0
// @description  ExtJS 通用录入：文本/数字/日期/本地下拉/搜索选择按控件类型填；CSV 列名=网页 name。
// @author       dcinput
// @include      http://10.42.2.*/*
// @include      http://10.42.2.*
// @include      https://10.42.2.*/*
// @include      https://10.42.2.*
// @all-frames   true
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__dcinputLoaded) return;
  window.__dcinputLoaded = true;

  var VERSION = '1.1.0';
  var NS = 'dcinput';

  var state = {
    rows: [],
    index: 0,
    fileName: '',
    encoding: '',
    delimiter: ',',
    queryStatus: [],
    lastFingerprint: '',
    pickGen: 0,
    filledCurrent: false,
    visible: false,
    status: ''
  };

  /* ---------- storage ---------- */
  function storeGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        var v = GM_getValue(key, null);
        if (v !== null && v !== undefined) return v;
      }
    } catch (e) {}
    try {
      var raw = localStorage.getItem(NS + ':' + key);
      if (raw) return JSON.parse(raw);
    } catch (e2) {}
    return fallback;
  }
  function storeSet(key, value) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, value); } catch (e) {}
    try { localStorage.setItem(NS + ':' + key, JSON.stringify(value)); } catch (e2) {}
  }
  function loadProgress() {
    var p = storeGet('progress:' + state.fileName, null);
    if (p && typeof p.index === 'number') state.index = p.index;
  }
  function saveProgress() {
    if (!state.fileName) return;
    var done = {};
    var i;
    for (i = 0; i < state.rows.length; i++) {
      if (state.rows[i]._status) done[i] = state.rows[i]._status;
    }
    storeSet('progress:' + state.fileName, { index: state.index, done: done });
  }

  /* ---------- csv ---------- */
  function looksLikeHeader(text) {
    var head = String(text || '').split(/\r?\n/)[0] || '';
    if (head.indexOf('\uFFFD') >= 0) return false;
    var cols = head.split(/[,\t;]/);
    if (cols.length < 2) return false;
    if (/[\u4e00-\u9fff]/.test(head)) return true;
    var i, ok = 0, cell;
    for (i = 0; i < cols.length; i++) {
      cell = String(cols[i] || '').trim();
      if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(cell)) ok++;
    }
    return ok >= 2;
  }
  function decodeBuffer(buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'utf-8-bom' };
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'utf-16le' };
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'utf-16be' };
    }
    var utf8 = new TextDecoder('utf-8').decode(u8);
    if (looksLikeHeader(utf8)) return { text: utf8, encoding: 'utf-8' };
    try {
      var gbk = new TextDecoder('gb18030').decode(u8);
      if (looksLikeHeader(gbk)) return { text: gbk, encoding: 'gbk' };
      if (!looksLikeHeader(utf8)) return { text: gbk, encoding: 'gbk-fallback' };
    } catch (e) {}
    return { text: utf8, encoding: 'utf-8-fallback' };
  }
  function guessDelimiter(headerLine) {
    var comma = (headerLine.match(/,/g) || []).length;
    var tab = (headerLine.match(/\t/g) || []).length;
    var semi = (headerLine.match(/;/g) || []).length;
    if (tab > comma && tab > semi) return '\t';
    if (semi > comma && semi > tab) return ';';
    return ',';
  }
  function parseCsv(text, delimiter) {
    var rows = [];
    var row = [];
    var cell = '';
    var i, c, inQuote = false;
    var s = String(text || '').replace(/^\uFEFF/, '');
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (inQuote) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { cell += '"'; i++; }
          else inQuote = false;
        } else cell += c;
      } else if (c === '"') inQuote = true;
      else if (c === delimiter) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function rowsToObjects(matrix) {
    if (!matrix.length) return [];
    var header = matrix[0].map(function (h) { return String(h || '').trim(); });
    var out = [];
    var r, obj, c, key, val, has;
    for (r = 1; r < matrix.length; r++) {
      if (!matrix[r] || !matrix[r].join('').trim()) continue;
      obj = { _row: r, _status: '', _keys: header };
      has = false;
      for (c = 0; c < header.length; c++) {
        key = header[c];
        if (!key) continue;
        val = matrix[r][c] == null ? '' : String(matrix[r][c]).trim();
        obj[key] = val;
        if (val) has = true;
      }
      if (has) out.push(obj);
    }
    return out;
  }
  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }
  function isoFromParts(y, m, d) {
    y = parseInt(y, 10);
    m = parseInt(m, 10);
    d = parseInt(d, 10);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function parseToIsoDate(raw) {
    var s = String(raw == null ? '' : raw).replace(/^["']|["']$/g, '').trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\s|T|$)/);
    if (m) return isoFromParts(m[1], m[2], m[3]);
    m = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) return isoFromParts(m[1], m[2], m[3]);
    if (/^\d+(\.\d+)?$/.test(s)) {
      var n = parseFloat(s);
      if (n > 20000 && n < 80000) {
        var dt = new Date(Date.UTC(1899, 11, 30));
        dt.setUTCDate(dt.getUTCDate() + Math.floor(n));
        return dt.toISOString().slice(0, 10);
      }
    }
    return '';
  }
  function isoToDate(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function sameDay(a, b) {
    var ia = parseToIsoDate(a);
    var ib = parseToIsoDate(b);
    return !!(ia && ib && ia === ib);
  }
  function uniquePush(arr, v) {
    if (v === undefined || v === null || v === '') return;
    if (arr.indexOf(v) < 0) arr.push(v);
  }
  function coerceValue(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '/' || s === '无') return '';
    var iso = parseToIsoDate(s);
    if (iso) return iso;
    return s;
  }
  function valueCandidates(val) {
    var s = coerceValue(val);
    var out = [];
    if (!s) return out;
    var iso = parseToIsoDate(s) || parseToIsoDate(val);
    if (iso) {
      var p = iso.split('-');
      uniquePush(out, iso);
      uniquePush(out, p[0] + '/' + p[1] + '/' + p[2]);
      uniquePush(out, p[0] + '/' + parseInt(p[1], 10) + '/' + parseInt(p[2], 10));
      uniquePush(out, p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日');
      return out;
    }
    uniquePush(out, s);
    var m = s.match(/^(.*)\(([^)]+)\)\s*$/);
    if (m) {
      uniquePush(out, m[2]);
      uniquePush(out, m[1].trim());
    }
    return out;
  }
  function isSheetMeta(name) {
    return /^(序号|备注|说明|编号)$/.test(String(name || ''));
  }
  function previewName(row) {
    if (!row) return '（未导入）';
    var keys = row._keys || [];
    var i, k, v;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!k || k.charAt(0) === '_' || isSheetMeta(k)) continue;
      v = row[k];
      if (v) return String(v);
    }
    return '第' + row._row + '行';
  }

  /* ---------- documents ---------- */
  function walkDocuments() {
    var docs = [];
    function walk(win, path) {
      if (!win) return;
      try {
        var doc = win.document;
        if (doc) {
          var item = { win: win, doc: doc, path: path, url: '', title: '' };
          try { item.url = win.location.href; } catch (e1) {}
          try { item.title = doc.title || ''; } catch (e2) {}
          docs.push(item);
        }
        var frames = doc ? doc.querySelectorAll('iframe,frame') : [];
        var i;
        for (i = 0; i < frames.length; i++) {
          try { walk(frames[i].contentWindow, path + '/iframe[' + i + ']'); }
          catch (e3) {
            docs.push({ win: null, doc: null, path: path + '/iframe[' + i + ']', url: frames[i].src || '', title: '(跨域无法读取)', blocked: true });
          }
        }
      } catch (e) {
        docs.push({ win: null, doc: null, path: path, url: '', title: '(无法读取)', blocked: true });
      }
    }
    walk(window, 'top');
    return docs;
  }
  function isSearchField(el) {
    var name = (el && el.name) || '';
    var id = (el && el.id) || '';
    if (/^common_(tree_)?search/.test(name)) return true;
    if (id.indexOf('common_search') >= 0 || id.indexOf('common_tree_search') >= 0) return true;
    return false;
  }
  function isNoiseField(el) {
    var name = (el && el.name) || '';
    var id = (el && el.id) || '';
    if (!name) return true;
    if (isSearchField(el)) return true;
    if (name === 'inputItem' || name === 'isSuccess') return true;
    if (name === id) return true;
    if (el.type === 'hidden') return true;
    return false;
  }
  function isTableFieldId(id) {
    return /^[A-Z][A-Z0-9_]*\.[A-Za-z0-9_]+-inputEl$/.test(id || '');
  }
  function tablePrefix(id) {
    var m = String(id || '').match(/^([A-Z][A-Z0-9_]*)\./);
    return m ? m[1] : '';
  }
  function elVisible(el) {
    if (!el) return false;
    var cls = ' ' + String(el.className || '') + ' ';
    if (cls.indexOf(' x-hide-display ') >= 0 || cls.indexOf(' x-hide-offsets ') >= 0 || cls.indexOf(' x-hidden ') >= 0) return false;
    if ((el.offsetWidth || 0) < 40 && (el.offsetHeight || 0) < 40) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.right < 0) return false;
      var vw = (el.ownerDocument.documentElement.clientWidth) || 0;
      var vh = (el.ownerDocument.documentElement.clientHeight) || 0;
      if (vw && r.left > vw) return false;
      if (vh && r.top > vh) return false;
    } catch (e) {}
    return true;
  }
  function closestDetail(el) {
    var n = el;
    var hops = 0;
    while (n && hops < 20) {
      if (n.className && String(n.className).indexOf('x-window') >= 0) return n;
      n = n.parentElement;
      hops++;
    }
    return null;
  }
  function windowTitle(winEl) {
    if (!winEl) return '';
    var titleEl = winEl.querySelector('.x-window-header-text, .x-title-text, .x-header-text');
    return titleEl ? String(titleEl.innerText || titleEl.textContent || '') : '';
  }
  function isLookupWindow(winEl) {
    if (!/查询|选择/.test(windowTitle(winEl))) return false;
    var nodes = winEl.querySelectorAll('input[name], textarea[name], select[name]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (isTableFieldId(nodes[i].id)) return false;
    }
    return true;
  }
  function csvNameSet() {
    var row = state.rows[state.index];
    var keys = (row && row._keys) || [];
    var set = {};
    var i, k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!k || k.charAt(0) === '_' || isSheetMeta(k)) continue;
      set[k] = 1;
    }
    return set;
  }
  function overlapCount(els, nameSet) {
    var n = 0, i, name, seen = {};
    for (i = 0; i < els.length; i++) {
      name = els[i].name;
      if (name && nameSet[name] && !seen[name]) {
        seen[name] = 1;
        n++;
      }
    }
    return n;
  }
  function inputsIn(root) {
    if (!root || !root.querySelectorAll) return [];
    var nodes = root.querySelectorAll('input[name], textarea[name], select[name]');
    var out = [];
    var i, el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (isNoiseField(el)) continue;
      out.push(el);
    }
    return out;
  }
  function fieldGroupKey(el) {
    var win = closestDetail(el);
    if (win) {
      if (isLookupWindow(win) && !isTableFieldId(el.id)) return 'lookup';
      return 'win:' + (win.id || windowTitle(win) || 'anon');
    }
    var pref = tablePrefix(el.id);
    if (pref) return 'tbl:' + pref;
    return 'page';
  }
  function groupHidden(els) {
    var i, win, anyWin = false, anyVis = false;
    for (i = 0; i < els.length; i++) {
      win = closestDetail(els[i]);
      if (win) {
        anyWin = true;
        if (elVisible(win)) anyVis = true;
      } else anyVis = true;
    }
    return anyWin && !anyVis;
  }
  function scoreInputs(els, nameSet) {
    var i, tableN = 0, vis = 0, win;
    for (i = 0; i < els.length; i++) {
      if (isTableFieldId(els[i].id)) tableN++;
      win = closestDetail(els[i]);
      if (win && elVisible(win)) vis++;
      if (!win) vis++;
    }
    return overlapCount(els, nameSet) * 1000 + vis * 20 + tableN * 15 + els.length;
  }
  function pickBestGroup(groups, nameSet) {
    var key, visibleExists = false, best = [], bestScore = -1, score;
    for (key in groups) {
      if (!groups.hasOwnProperty(key) || key === 'lookup') continue;
      if (!groupHidden(groups[key])) visibleExists = true;
    }
    for (key in groups) {
      if (!groups.hasOwnProperty(key) || key === 'lookup') continue;
      if (visibleExists && groupHidden(groups[key])) continue;
      score = scoreInputs(groups[key], nameSet);
      if (score > bestScore) {
        bestScore = score;
        best = groups[key];
      }
    }
    if (!best.length && groups.lookup) return groups.lookup;
    return best;
  }
  function listDetailInputs(doc) {
    if (!doc) return [];
    var els = inputsIn(doc);
    if (!els.length) return [];
    var groups = {};
    var i, el, key;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      key = fieldGroupKey(el);
      if (!groups[key]) groups[key] = [];
      groups[key].push(el);
    }
    return pickBestGroup(groups, csvNameSet());
  }
  function hasDetailForm(doc) {
    return listDetailInputs(doc).length > 0;
  }
  function formFingerprint(doc) {
    var els = listDetailInputs(doc);
    var names = [];
    var i, n, pref;
    for (i = 0; i < els.length; i++) {
      n = els[i].name || els[i].id || '';
      if (n && names.indexOf(n) < 0) names.push(n);
      pref = tablePrefix(els[i].id);
      if (pref && names.indexOf(pref) < 0) names.push(pref);
    }
    names.sort();
    return names.join('|');
  }
  function isSystemField(el) {
    var n = (el && el.name) || '';
    var id = (el && el.id) || '';
    if (/^(STAMP|OWNER|ID|更新标志|拥有者|调控标识)$/.test(n)) return true;
    if (/\.(STAMP|OWNER|ID)-inputEl$/.test(id)) return true;
    return false;
  }
  function formLooksReadOnly(doc) {
    var els = listDetailInputs(doc);
    if (!els.length) return false;
    var Ext = winExt(doc.defaultView);
    var i, el, cmp, n = 0, locked = 0;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (isSystemField(el)) continue;
      n++;
      cmp = cmpFromEl(Ext, el);
      try {
        if (cmp && (cmp.readOnly || cmp.disabled)) locked++;
      } catch (e) {}
    }
    return n >= 2 && locked === n;
  }
  function findFormHolder() {
    var docs = walkDocuments();
    var nameSet = csvNameSet();
    var best = null, bestScore = -1;
    var i, els, score;
    for (i = 0; i < docs.length; i++) {
      if (!docs[i].doc) continue;
      els = listDetailInputs(docs[i].doc);
      if (!els.length) continue;
      score = scoreInputs(els, nameSet);
      if (score > bestScore) {
        bestScore = score;
        best = docs[i];
      }
    }
    return best;
  }

  /* ---------- Ext ---------- */
  function winExt(win) {
    var cands = [];
    try { if (typeof unsafeWindow !== 'undefined') cands.push(unsafeWindow); } catch (e0) {}
    if (win) {
      cands.push(win);
      try { if (win.wrappedJSObject) cands.push(win.wrappedJSObject); } catch (e1) {}
    }
    var i, w;
    for (i = 0; i < cands.length; i++) {
      w = cands[i];
      try {
        if (w && w.Ext && (w.Ext.getCmp || w.Ext.ComponentQuery)) return w.Ext;
      } catch (e2) {}
    }
    return null;
  }
  function cmpFromEl(Ext, el) {
    if (!Ext || !el || !Ext.getCmp) return null;
    var id = el.id || '';
    if (id.slice(-8) === '-inputEl') id = id.slice(0, -8);
    try { return Ext.getCmp(id) || null; } catch (e) { return null; }
  }
  function cmpByName(Ext, name) {
    if (!Ext || !name) return null;
    var q, list, i, c;
    q = 'field[name="' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
    try {
      if (Ext.ComponentQuery && Ext.ComponentQuery.query) list = Ext.ComponentQuery.query(q);
    } catch (e) { list = []; }
    if (!list || !list.length) return null;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      try {
        if (typeof c.isVisible === 'function' && !c.isVisible()) continue;
      } catch (e1) {}
      try { if (c.hidden) continue; } catch (e2) {}
      return c;
    }
    return list[0];
  }

  /* ---------- find by name（当前弹窗分组，避开列表搜索框） ---------- */
  function findByName(doc, name) {
    if (!doc || !name) return null;
    var els = listDetailInputs(doc);
    var i, el, other = null;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.name !== name) continue;
      if (isTableFieldId(el.id)) return el;
      if (!other) other = el;
    }
    if (other) return other;
    els = inputsIn(doc);
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.name !== name) continue;
      if (isTableFieldId(el.id)) return el;
      if (!other) other = el;
    }
    return other;
  }
  function cmpXType(cmp) {
    if (!cmp) return '';
    try {
      if (typeof cmp.getXType === 'function') return String(cmp.getXType() || '');
    } catch (e) {}
    return String(cmp.xtype || '');
  }
  function isPicker(el, cmp) {
    if (el) {
      var ph = el.placeholder || '';
      if (ph.indexOf('请选择') >= 0) return true;
      if ((el.className || '').indexOf('x-trigger-noedit') >= 0) return true;
    }
    if (cmp) {
      var t = cmpXType(cmp);
      if (/combo|trigger|picker|lov|lookup|assetcombo/i.test(t)) return true;
    }
    return false;
  }
  function looksLikeDateName(el, cmp) {
    var s = ((el && el.name) || '') + ' ' + ((el && el.id) || '') + ' ' + ((cmp && cmp.name) || '');
    return /日期|DATE|PERIOD|_DT($|[^A-Z])/i.test(s);
  }
  /* ExtJS 常用控件：text / textarea / number / date / combo / lookup / checkbox / radio / select / readonly */
  function classifyField(el, cmp) {
    var xt = cmpXType(cmp).toLowerCase();
    var id = ((el && el.id) || '') + ' ' + ((cmp && cmp.id) || '');
    var cls = ' ' + ((el && el.className) || '') + ' ';
    var tag = el && el.tagName ? el.tagName.toUpperCase() : '';
    var type = (el && el.type) || '';
    if (type === 'hidden' || /displayfield|hidden/.test(xt)) return 'skip';
    if (type === 'file' || /fileupload|filefield/.test(xt)) return 'skip';
    if (type === 'checkbox' || /checkbox/.test(xt)) return 'checkbox';
    if (type === 'radio' || /^radio/.test(xt)) return 'radio';
    if (tag === 'SELECT') return 'select';
    if (/date/.test(xt) || /datefield/.test(id) || /x-form-date/.test(cls) || looksLikeDateName(el, cmp)) {
      if (!/combo/.test(xt)) return 'date';
    }
    if (/timefield/.test(xt)) return 'time';
    if (/number|spinner/.test(xt) || /numberfield/.test(id)) return 'number';
    if (/textarea/.test(xt) || tag === 'TEXTAREA' || /textareafield/.test(id)) return 'textarea';
    if (/assetcombo|lovcombo|treecombo/.test(xt) || /assetcombo/.test(id)) return 'lookup';
    if (/combo/.test(xt) || isComboCmp(cmp)) return isLocalCombo(cmp) ? 'combo' : 'lookup';
    if (/trigger|picker|lookup/.test(xt) || isPicker(el, cmp)) return isLocalCombo(cmp) ? 'combo' : 'lookup';
    if (el && (el.readOnly || el.disabled) && cls.indexOf('x-trigger') < 0) return 'readonly';
    return 'text';
  }
  function currentShown(el, cmp) {
    var raw = '';
    try { if (cmp && typeof cmp.getRawValue === 'function') raw = String(cmp.getRawValue() || ''); } catch (e) {}
    if (!raw && el) raw = String(el.value || '');
    return raw;
  }
  function valueStuck(shown, csvVal) {
    if (!shown || !csvVal) return false;
    if (shown === csvVal) return true;
    if (sameDay(shown, csvVal)) return true;
    if (shown.indexOf(csvVal) >= 0 || csvVal.indexOf(shown) >= 0) return true;
    var a = valueCandidates(csvVal);
    var i;
    for (i = 0; i < a.length; i++) {
      if (shown === a[i] || shown.indexOf(a[i]) >= 0) return true;
      if (sameDay(shown, a[i])) return true;
    }
    return false;
  }
  function setNativeValue(el, value) {
    if (!el) return false;
    var v = value == null ? '' : String(value);
    if (el.tagName === 'SELECT') {
      var opts = el.options, i;
      for (i = 0; i < opts.length; i++) {
        if (opts[i].value === v || (opts[i].text || '').indexOf(v) >= 0) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    try {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
    } catch (e) { el.value = v; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }
  function fireCmp(cmp, val) {
    if (!cmp) return;
    try { if (typeof cmp.fireEvent === 'function') cmp.fireEvent('change', cmp, val); } catch (e) {}
    try { if (typeof cmp.fireEvent === 'function') cmp.fireEvent('select', cmp, val); } catch (e2) {}
    try { if (typeof cmp.fireEvent === 'function') cmp.fireEvent('blur', cmp); } catch (e3) {}
  }
  function isDateField(el, cmp) {
    return classifyField(el, cmp) === 'date' || classifyField(el, cmp) === 'time';
  }
  function isComboCmp(cmp) {
    if (!cmp) return false;
    var t = String(cmp.xtype || '');
    if (/combo/i.test(t)) return true;
    if (cmp.displayField || cmp.valueField) return true;
    try { if (cmp.getStore || cmp.store) return true; } catch (e) {}
    return false;
  }
  function comboStore(cmp) {
    if (!cmp) return null;
    try { if (typeof cmp.getStore === 'function') return cmp.getStore(); } catch (e) {}
    try { return cmp.store || null; } catch (e2) { return null; }
  }
  function recGet(rec, field) {
    if (!rec || field == null || field === '') return '';
    try {
      if (typeof rec.get === 'function') {
        var v = rec.get(field);
        return v == null ? '' : String(v);
      }
    } catch (e) {}
    try {
      if (rec.data && rec.data[field] != null) return String(rec.data[field]);
    } catch (e2) {}
    return '';
  }
  function scoreOption(text, csvVal) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 0;
    var cands = valueCandidates(csvVal);
    var best = 0, i, c;
    for (i = 0; i < cands.length; i++) {
      c = String(cands[i] || '').replace(/\s+/g, ' ').trim();
      if (!c) continue;
      if (t === c) return 100;
    }
    for (i = 0; i < cands.length; i++) {
      c = String(cands[i] || '').replace(/\s+/g, ' ').trim();
      if (!c || c.length < 2) continue;
      if (t.indexOf(c) === 0 || c.indexOf(t) === 0) best = Math.max(best, 70);
      else if (t.indexOf(c) >= 0 || c.indexOf(t) >= 0) best = Math.max(best, 50);
    }
    return best;
  }
  function collapseCombo(cmp) {
    try { if (cmp && typeof cmp.collapse === 'function') cmp.collapse(); } catch (e) {}
  }
  function selectComboFromStore(cmp, csvVal) {
    var store = comboStore(cmp);
    if (!store) return false;
    var df = cmp.displayField || 'text';
    var vf = cmp.valueField || 'value';
    var best = null, bestScore = 0, recs, i, rec, sc;
    function consider(r) {
      if (!r) return;
      sc = Math.max(scoreOption(recGet(r, df), csvVal), scoreOption(recGet(r, vf), csvVal));
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    try {
      if (typeof cmp.findRecord === 'function') {
        var cands = valueCandidates(csvVal);
        for (i = 0; i < cands.length; i++) {
          rec = null;
          try { rec = cmp.findRecord(df, cands[i]); } catch (e0) {}
          if (!rec) try { rec = cmp.findRecord(vf, cands[i]); } catch (e1) {}
          if (rec) { best = rec; bestScore = 100; break; }
        }
      }
    } catch (e2) {}
    if (!best) {
      try {
        if (typeof store.each === 'function') store.each(function (r) { consider(r); });
        else {
          recs = (store.data && store.data.items) || [];
          for (i = 0; i < recs.length; i++) consider(recs[i]);
        }
      } catch (e3) {}
    }
    if (!best || bestScore < 70) return false;
    try {
      var val = recGet(best, vf);
      if (typeof cmp.setValue === 'function') {
        if (val !== '') cmp.setValue(val);
        else cmp.setValue(best);
      }
      collapseCombo(cmp);
      return true;
    } catch (e4) { return false; }
  }
  function clickBoundlist(cmp, el, csvVal) {
    var root = null, doc, lists, items, i, j, t, sc, best = null, bestScore = 0;
    try {
      if (cmp && typeof cmp.getPicker === 'function') {
        var p = cmp.getPicker();
        if (p && p.el && p.el.dom) root = p.el.dom;
      }
    } catch (e) {}
    doc = (el && el.ownerDocument) || (cmp && cmp.el && cmp.el.dom && cmp.el.dom.ownerDocument) || document;
    lists = root ? [root] : doc.querySelectorAll('.x-boundlist, .x-combo-list');
    for (i = 0; i < lists.length; i++) {
      if (!root && (lists[i].offsetWidth || 0) < 20 && (lists[i].offsetHeight || 0) < 20) continue;
      items = lists[i].querySelectorAll('.x-boundlist-item, .x-combo-list-item');
      for (j = 0; j < items.length; j++) {
        t = String(items[j].innerText || items[j].textContent || '').trim();
        sc = scoreOption(t, csvVal);
        if (sc > bestScore) { bestScore = sc; best = items[j]; }
      }
    }
    if (!best || bestScore < 70) return false;
    try { best.click(); } catch (e2) { return false; }
    collapseCombo(cmp);
    return true;
  }
  function isLocalCombo(cmp) {
    if (!cmp) return false;
    var t = cmpXType(cmp);
    if (/assetcombo|lov|lookup/i.test(t)) return false;
    var mode = '';
    try { mode = String(cmp.queryMode || cmp.mode || ''); } catch (e) {}
    if (mode === 'remote') return false;
    if (mode === 'local') return true;
    var store = comboStore(cmp);
    var n = 0;
    try {
      if (store) {
        if (typeof store.getCount === 'function') n = store.getCount();
        else if (store.data && store.data.items) n = store.data.items.length;
      }
    } catch (e2) {}
    return n > 0 && n <= 80 && /combo/i.test(t);
  }
  function tryWriteCombo(el, cmp, csvVal, canExpand) {
    if (!cmp && !el) return false;
    if (selectComboFromStore(cmp, csvVal)) return true;
    if (!isLocalCombo(cmp) || canExpand === false) return false;
    try {
      if (cmp && typeof cmp.expand === 'function') cmp.expand();
      else if (cmp && typeof cmp.onTriggerClick === 'function') cmp.onTriggerClick();
    } catch (e) {}
    if (selectComboFromStore(cmp, csvVal)) { collapseCombo(cmp); return true; }
    if (clickBoundlist(cmp, el, csvVal)) return true;
    collapseCombo(cmp);
    return false;
  }
  function tryWritePlain(el, cmp, csvVal) {
    var cands = valueCandidates(csvVal);
    var i, v, before, after;
    before = currentShown(el, cmp);
    for (i = 0; i < cands.length; i++) {
      v = cands[i];
      if (cmp && typeof cmp.setValue === 'function') {
        try { cmp.setValue(v); fireCmp(cmp, v); } catch (e) {}
      }
      after = currentShown(el, cmp);
      if (valueStuck(after, csvVal)) return true;
    }
    if (el && cands[0]) setNativeValue(el, cands[0]);
    after = currentShown(el, cmp);
    return valueStuck(after, csvVal) || (after && after !== before && valueStuck(after, csvVal));
  }
  function tryWriteDate(el, cmp, csvVal) {
    var iso = parseToIsoDate(csvVal);
    var dt = iso ? isoToDate(iso) : null;
    var after;
    if (cmp && typeof cmp.setValue === 'function' && dt) {
      try { cmp.setValue(dt); fireCmp(cmp, dt); } catch (e) {}
      after = currentShown(el, cmp);
      if (valueStuck(after, csvVal)) return true;
    }
    return tryWritePlain(el, cmp, csvVal);
  }
  function tryWriteNumber(el, cmp, csvVal) {
    var n = parseFloat(String(csvVal).replace(/,/g, ''));
    var after;
    if (!isNaN(n) && isFinite(n) && cmp && typeof cmp.setValue === 'function') {
      try { cmp.setValue(n); fireCmp(cmp, n); } catch (e) {}
      after = currentShown(el, cmp);
      if (valueStuck(after, csvVal) || String(after) === String(n)) return true;
    }
    return tryWritePlain(el, cmp, csvVal);
  }
  function truthyVal(v) {
    return /^(1|true|yes|y|是|有|√|on|checked)$/i.test(String(v == null ? '' : v).trim());
  }
  function tryWriteCheck(el, cmp, csvVal) {
    var on = truthyVal(csvVal);
    try { if (cmp && typeof cmp.setValue === 'function') { cmp.setValue(on); fireCmp(cmp, on); } } catch (e) {}
    if (el) {
      el.checked = on;
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
    }
    return true;
  }
  function tryWriteRadio(el, cmp, csvVal) {
    var cands = valueCandidates(csvVal);
    var i, nodes, n, t;
    if (cmp && typeof cmp.setValue === 'function') {
      for (i = 0; i < cands.length; i++) {
        try { cmp.setValue(cands[i]); fireCmp(cmp, cands[i]); } catch (e) {}
        if (valueStuck(currentShown(el, cmp), csvVal)) return true;
      }
    }
    if (el && el.form) {
      nodes = el.form.querySelectorAll('input[type=radio][name="' + el.name + '"]');
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        t = String(n.value || n.nextSibling && n.nextSibling.textContent || '');
        if (scoreOption(t, csvVal) >= 70 || scoreOption(n.value, csvVal) >= 70) {
          n.checked = true;
          try { n.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
          return true;
        }
      }
    }
    return tryWritePlain(el, cmp, csvVal);
  }
  function tryWriteSelect(el, csvVal) {
    if (!el || !el.options) return false;
    var i, opt, best = -1, bestScore = 0, sc;
    for (i = 0; i < el.options.length; i++) {
      opt = el.options[i];
      sc = Math.max(scoreOption(opt.value, csvVal), scoreOption(opt.text, csvVal));
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best < 0 || bestScore < 70) return false;
    el.selectedIndex = best;
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    return true;
  }
  function tryWrite(el, cmp, csvVal) {
    var kind = classifyField(el, cmp);
    var ok = false;
    if (kind === 'skip' || kind === 'readonly') return true;
    if (kind === 'date' || kind === 'time') ok = tryWriteDate(el, cmp, csvVal);
    else if (kind === 'number') ok = tryWriteNumber(el, cmp, csvVal);
    else if (kind === 'checkbox') ok = tryWriteCheck(el, cmp, csvVal);
    else if (kind === 'radio') ok = tryWriteRadio(el, cmp, csvVal);
    else if (kind === 'select') ok = tryWriteSelect(el, csvVal) || tryWritePlain(el, cmp, csvVal);
    else if (kind === 'combo') {
      ok = tryWriteCombo(el, cmp, csvVal, false);
      if (!ok) ok = tryWriteRaw(el, cmp, csvVal);
    } else if (kind === 'lookup') {
      ok = tryWriteRaw(el, cmp, csvVal);
    } else {
      ok = tryWritePlain(el, cmp, csvVal);
    }
    return ok;
  }
  function tryWriteRaw(el, cmp, csvVal) {
    var word = String((valueCandidates(csvVal)[0] || csvVal || '')).trim();
    if (!word) return false;
    try { if (cmp && typeof cmp.setRawValue === 'function') cmp.setRawValue(word); } catch (e) {}
    if (el) {
      try {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, word);
        else el.value = word;
      } catch (e2) { el.value = word; }
    }
    var shown = currentShown(el, cmp);
    return !!(shown && shown.indexOf('请选择') < 0);
  }

  function openPicker(el, cmp) {
    try { if (cmp && typeof cmp.onTriggerClick === 'function') { cmp.onTriggerClick(); return; } } catch (e) {}
    try { if (cmp && typeof cmp.onTrigger2Click === 'function') { cmp.onTrigger2Click(); return; } } catch (e1) {}
    try { if (cmp && typeof cmp.expand === 'function') { cmp.expand(); return; } } catch (e2) {}
    if (!el) return;
    var wrap = el.parentElement, hops = 0, triggers, t, i;
    while (wrap && hops < 6) {
      triggers = wrap.querySelectorAll('.x-form-search-trigger, .x-form-arrow-trigger, .x-form-trigger');
      for (i = 0; i < triggers.length; i++) {
        t = triggers[i];
        if ((t.offsetWidth || 0) > 0) { try { t.click(); return; } catch (e3) {} }
      }
      wrap = wrap.parentElement;
      hops++;
    }
    try { el.click(); } catch (e4) {}
  }
  function eachVisibleWindow(fn) {
    var docs = walkDocuments();
    var d, wins, w, title;
    for (d = 0; d < docs.length; d++) {
      if (!docs[d].doc) continue;
      wins = docs[d].doc.querySelectorAll('.x-window, .x-window-dlg');
      for (w = 0; w < wins.length; w++) {
        if ((wins[w].offsetWidth || 0) < 40) continue;
        title = windowTitle(wins[w]);
        if (fn(wins[w], title, docs[d].doc) === true) return true;
      }
    }
    return false;
  }
  function isLookupWin(win, title) {
    if (/查询|选择|查找/.test(title || '')) return true;
    if (win.querySelector('.x-grid, .x-grid-view, .x-tree') && !win.querySelector('input[id^="SG_"][id$="-inputEl"]')) return true;
    return false;
  }
  function clickWinBtn(win, texts) {
    var nodes = win.querySelectorAll('a, button, .x-btn, span.x-btn-inner, .x-btn-text');
    var i, t, j;
    for (i = 0; i < nodes.length; i++) {
      t = String(nodes[i].innerText || nodes[i].textContent || nodes[i].value || '').replace(/\s+/g, '');
      if (!t) continue;
      for (j = 0; j < texts.length; j++) {
        if (t === texts[j] || t.indexOf(texts[j]) >= 0) {
          try { (nodes[i].closest ? nodes[i].closest('.x-btn') || nodes[i] : nodes[i]).click(); return true; } catch (e) {}
        }
      }
    }
    return false;
  }
  function typeIntoLookupSearch(keyword) {
    if (!keyword) return false;
    var word = valueCandidates(keyword)[0] || keyword;
    return eachVisibleWindow(function (win, title) {
      if (!isLookupWin(win, title) && inputsIn(win).length && !/查询|选择/.test(title)) return false;
      var inputs = win.querySelectorAll('input.x-form-text, input[type=text]');
      var i, el;
      for (i = 0; i < inputs.length; i++) {
        el = inputs[i];
        if (el.readOnly || el.disabled) continue;
        if ((el.className || '').indexOf('x-trigger-noedit') >= 0) continue;
        if (isTableFieldId(el.id)) continue;
        if (isSearchField(el) && !isLookupWin(win, title)) continue;
        setNativeValue(el, word);
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); } catch (e) {}
        clickWinBtn(win, ['查询', '搜索']);
        return true;
      }
      return false;
    });
  }
  function fillLookupSearch(keyword) {
    setTimeout(function () { typeIntoLookupSearch(keyword); }, 400);
  }
  function clickLookupHit(keyword) {
    if (!keyword) return false;
    var cands = valueCandidates(keyword);
    return eachVisibleWindow(function (win, title) {
      if (!isLookupWin(win, title) && !win.querySelector('.x-grid-row, .x-grid-cell')) return false;
      var rows = win.querySelectorAll('.x-grid-row, tr.x-grid-row');
      var i, j, t, sc, best = null, bestScore = 0;
      if (!rows.length) rows = win.querySelectorAll('.x-grid-cell, .x-tree-node-el, .x-boundlist-item');
      for (i = 0; i < rows.length; i++) {
        t = String(rows[i].innerText || rows[i].textContent || '').trim();
        sc = scoreOption(t, keyword);
        for (j = 0; j < cands.length; j++) {
          if (cands[j] && t.indexOf(cands[j]) >= 0) sc = Math.max(sc, cands[j].length >= 2 ? 80 : 50);
        }
        if (sc > bestScore) { bestScore = sc; best = rows[i]; }
      }
      if (!best || bestScore < 50) return false;
      try { best.click(); } catch (e) {}
      try { best.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); } catch (e2) {}
      clickWinBtn(win, ['确定', '选择', '确认', 'OK']);
      return true;
    });
  }

  /* ---------- fill current form ---------- */
  function fillCurrent() {
    var row = state.rows[state.index];
    if (!row) {
      setStatus('没有数据，请先导入 CSV 或粘贴');
      return false;
    }
    var holder = findFormHolder();
    if (!holder) {
      setStatus('没找到可填的详情弹窗。请先打开新建/编辑弹窗再点填入。');
      renderPanel();
      return false;
    }
    if (formLooksReadOnly(holder.doc)) {
      setStatus('当前账号表单只读，请换有录入权限的账号，不要在只读号上保存。');
      renderPanel();
      return false;
    }
    var Ext = winExt(holder.win);
    var keys = row._keys || [];
    var auto = [];
    var needHuman = [];
    var missing = [];
    var failed = [];
    var kinds = {};
    var i, name, val, el, cmp, kind, ok;
    for (i = 0; i < keys.length; i++) {
      name = keys[i];
      if (!name || name.charAt(0) === '_' || isSheetMeta(name)) continue;
      val = coerceValue(row[name]);
      if (!val) continue;
      el = findByName(holder.doc, name);
      if (!el) { missing.push(name); continue; }
      cmp = cmpFromEl(Ext, el) || cmpByName(Ext, name);
      kind = classifyField(el, cmp);
      kinds[name] = kind;
      if (kind === 'skip' || kind === 'readonly') continue;
      ok = tryWrite(el, cmp, val);
      if (kind === 'lookup' || isPicker(el, cmp)) {
        if (!ok) tryWriteRaw(el, cmp, val);
        auto.push(name);
        needHuman.push({ name: name, value: val, kind: kind });
      } else if (ok) auto.push(name);
      else failed.push(name);
    }
    state.lastFingerprint = formFingerprint(holder.doc);
    state.queryStatus = needHuman.map(function (q) {
      return { name: q.name, hint: q.value, waiting: false, found: true, kind: q.kind };
    });
    console.log('[dcinput] fill', {
      fingerprint: state.lastFingerprint,
      kinds: kinds,
      auto: auto,
      needHuman: needHuman.map(function (q) { return q.name + ':' + q.kind; }),
      missing: missing,
      failed: failed
    });
    var bits = ['已写入 ' + auto.length];
    if (needHuman.length) bits.push('对照 ' + needHuman.length + ' 项请手工搜选');
    if (missing.length) bits.push('本页无此列 ' + missing.length);
    if (failed.length) bits.push('写入失败 ' + failed.length + '（' + failed.slice(0, 5).join('、') + (failed.length > 5 ? '…' : '') + '）');
    setStatus(bits.join('，') + '。请核对后保存');
    state.filledCurrent = true;
    renderPanel();
    return true;
  }
  function fillAndNext() {
    if (!fillCurrent()) return;
    mark('ok');
  }
  function goPrev() {
    state.filledCurrent = false;
    state.queryStatus = [];
    if (state.index > 0) state.index--;
    saveProgress();
    renderPanel();
  }
  function goNext() {
    var row = state.rows[state.index];
    var marked = false;
    if (row && state.filledCurrent && !row._status) {
      row._status = 'ok';
      marked = true;
    }
    state.filledCurrent = false;
    state.queryStatus = [];
    if (state.index < state.rows.length - 1) state.index++;
    saveProgress();
    renderPanel();
    setStatus(marked ? '已记成功，已到下一条' : '已到下一条');
  }
  function lookupSearchInputs(win) {
    if (!win) return [];
    var nodes = win.querySelectorAll('input.x-form-text, input[type=text], input[type=search]');
    var out = [];
    var i, el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.disabled) continue;
      if (isTableFieldId(el.id)) continue;
      if (el.readOnly || (el.className || '').indexOf('x-trigger-noedit') >= 0) continue;
      if ((el.offsetWidth || 0) < 8 && (el.offsetHeight || 0) < 8) continue;
      out.push(el);
    }
    return out;
  }
  function newestLookupWindow(fieldEl) {
    var best = null, bestZ = -1;
    eachVisibleWindow(function (win, title) {
      if (fieldEl && win.contains && win.contains(fieldEl)) return;
      var inputs = lookupSearchInputs(win);
      var hasGrid = !!win.querySelector('.x-grid, .x-grid-view, .x-tree, .x-boundlist');
      if (!inputs.length && !hasGrid && !isLookupWin(win, title)) return;
      if (!inputs.length && !hasGrid) return;
      var z = 0;
      try { z = parseInt(win.style && win.style.zIndex || '0', 10) || 0; } catch (e) {}
      if (z >= bestZ && (inputs.length || hasGrid)) {
        bestZ = z;
        best = win;
      }
    });
    return best;
  }
  function searchBoxHasWord(el, word) {
    var v = String((el && el.value) || '').trim();
    word = String(word || '').trim();
    return !!(word && v && (v === word || v.indexOf(word) >= 0));
  }
  function writeSearchBox(el, word) {
    if (!el || !word) return false;
    var Ext = winExt(el.ownerDocument && el.ownerDocument.defaultView);
    var cmp = cmpFromEl(Ext, el);
    try { if (cmp && typeof cmp.setRawValue === 'function') cmp.setRawValue(word); } catch (e) {}
    try {
      var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, word);
      else el.value = word;
    } catch (e2) { el.value = word; }
    return searchBoxHasWord(el, word);
  }
  function fillLookupKeyword(keyword, fieldEl) {
    var word = (valueCandidates(keyword)[0] || keyword || '').trim();
    if (!word) return false;
    var win = newestLookupWindow(fieldEl);
    if (!win) return false;
    var inputs = lookupSearchInputs(win);
    if (!inputs.length) return false;
    var el = inputs[0];
    if (searchBoxHasWord(el, word)) return true;
    if (!writeSearchBox(el, word)) return false;
    try { el.focus(); } catch (e) {}
    try { el.setSelectionRange(word.length, word.length); } catch (e2) {}
    return true;
  }
  function startHumanQueue(queue) {
    state.pickGen++;
    var gen = state.pickGen;
    var idx = 0;
    function runOne() {
      if (gen !== state.pickGen) return;
      if (idx >= queue.length) {
        setStatus('查询项已点完。请核对后保存');
        renderPanel();
        return;
      }
      var q = queue[idx];
      if (state.queryStatus[idx]) state.queryStatus[idx].waiting = true;
      setStatus('请选择「' + q.name + '」（' + (idx + 1) + '/' + queue.length + '）对照：' + (q.value || ''));
      renderPanel();
      if (q.kind === 'combo') {
        tryWriteCombo(q.el, q.cmp, q.value, true);
        clickBoundlist(q.cmp, q.el, q.value);
      } else {
        openPicker(q.el, q.cmp);
        (function (item) {
          var tries = 0;
          var timer = setInterval(function () {
            if (gen !== state.pickGen) { clearInterval(timer); return; }
            if (!isEmptyPick(currentShown(item.el, item.cmp))) { clearInterval(timer); return; }
            tries++;
            if (fillLookupKeyword(item.value, item.el)) { clearInterval(timer); return; }
            if (tries > 20) clearInterval(timer);
          }, 250);
        })(q);
      }
      watchPick(q, function () {
        if (gen !== state.pickGen) return;
        q.waiting = false;
        if (state.queryStatus[idx]) {
          state.queryStatus[idx].waiting = false;
          state.queryStatus[idx].chosen = currentShown(q.el, q.cmp);
        }
        idx++;
        renderPanel();
        runOne();
      });
    }
    runOne();
  }
  function isEmptyPick(shown) {
    var s = String(shown || '').trim();
    return !s || s.indexOf('请选择') >= 0 || /^-+$/.test(s);
  }
  function watchPick(q, done) {
    var last = currentShown(q.el, q.cmp);
    var finished = false;
    var timer = null;
    var offs = [];
    function picked() {
      var now = currentShown(q.el, q.cmp);
      if (isEmptyPick(now)) return false;
      return now !== last;
    }
    function finish() {
      if (finished) return;
      if (!picked()) return;
      finished = true;
      if (timer) clearInterval(timer);
      var i;
      for (i = 0; i < offs.length; i++) {
        try { offs[i](); } catch (e) {}
      }
      done();
    }
    function onExt() { setTimeout(finish, 50); }
    if (q.cmp && typeof q.cmp.on === 'function') {
      ['select', 'change'].forEach(function (ev) {
        try {
          q.cmp.on(ev, onExt);
          offs.push(function () { try { q.cmp.un(ev, onExt); } catch (e) {} });
        } catch (e2) {}
      });
    }
    if (q.el && q.el.addEventListener) {
      q.el.addEventListener('change', onExt);
      offs.push(function () { try { q.el.removeEventListener('change', onExt); } catch (e) {} });
    }
    timer = setInterval(function () {
      if (picked()) finish();
    }, 300);
  }

  function listDocNames(doc) {
    var nodes = doc.querySelectorAll('input[name], textarea[name]');
    var out = [];
    var i, el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!el.name) continue;
      if (isSearchField(el)) continue;
      out.push({ name: el.name, id: el.id || '', placeholder: el.placeholder || '', picker: isPicker(el, null), kind: classifyField(el, null) });
    }
    return out;
  }
  function listPageNames() {
    var docs = walkDocuments();
    var all = [];
    var i;
    for (i = 0; i < docs.length; i++) {
      if (docs[i].doc) all = all.concat(listDocNames(docs[i].doc));
    }
    return all;
  }
  function copyPageNames() {
    var docs = walkDocuments();
    var names = [];
    var d, els, e;
    for (d = 0; d < docs.length; d++) {
      if (!docs[d].doc) continue;
      els = listDetailInputs(docs[d].doc);
      for (e = 0; e < els.length; e++) {
        names.push({ name: els[e].name, id: els[e].id || '' });
      }
    }
    if (!names.length) names = listPageNames();
    var use = names.filter(function (n) { return isTableFieldId(n.id); });
    if (!use.length) {
      use = names.filter(function (n) { return n.name && !/^common_(tree_)?search/.test(n.name); });
    }
    if (!use.length) use = names;
    var header = [];
    var seen = {};
    var i, n;
    for (i = 0; i < use.length; i++) {
      n = use[i].name;
      if (!n || seen[n]) continue;
      seen[n] = 1;
      header.push(n);
    }
    var text = header.join(',');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    } catch (e) {}
    prompt('本页字段名（可作 CSV 表头）。查询项带请选择：', text);
    setStatus('已列出 ' + header.length + ' 个 name');
  }

  /* ---------- panel ---------- */
  function $(id) { return document.getElementById(id); }
  function setStatus(msg) {
    state.status = msg;
    var el = $('dcinput-status');
    if (el) el.textContent = msg;
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function renderPanel() {
    if (!$('dcinput-panel')) return;
    var row = state.rows[state.index];
    var n = state.rows.length;
    var i, okN = 0, markTxt;
    for (i = 0; i < n; i++) {
      if (state.rows[i]._status === 'ok') okN++;
    }
    $('dcinput-counter').textContent = (n ? state.index + 1 : 0) + ' / ' + n;
    markTxt = !row ? '' : (row._status === 'ok' ? ' · 成功' : ' · 未记');
    $('dcinput-name').textContent = previewName(row) + markTxt;
    $('dcinput-meta').textContent = row
      ? ('成功 ' + okN + ' · 未记 ' + (n - okN))
      : (state.encoding ? ('编码 ' + state.encoding) : '导入 CSV（列名=网页 name）');
    var qhtml = '';
    var i, st, lamp;
    for (i = 0; i < state.queryStatus.length; i++) {
      st = state.queryStatus[i];
      qhtml += '<div class="dc-q">' + escapeHtml(st.name) + ' <span>对照</span></div>';
      if (st.hint) qhtml += '<div class="dc-hint">' + escapeHtml(st.hint) + '</div>';
    }
    $('dcinput-queries').innerHTML = qhtml;
    if (state.status) $('dcinput-status').textContent = state.status;
  }
  function pasteIdFromMatrix(matrix) {
    if (!matrix || matrix.length < 2) return 'paste';
    var row = matrix[1];
    var parts = [];
    var i, v;
    for (i = 0; i < row.length; i++) {
      v = String(row[i] == null ? '' : row[i]).trim();
      if (!v) continue;
      parts.push(v);
      if (parts.length >= 4) break;
    }
    if (!parts.length) return 'paste';
    return 'paste:' + parts.join('|').slice(0, 100);
  }
  function applyImported(text, encoding, fileName) {
    var firstLine = (text.split(/\r?\n/)[0] || '');
    var delimiter = guessDelimiter(firstLine);
    var matrix = parseCsv(text, delimiter);
    state.delimiter = delimiter;
    state.rows = rowsToObjects(matrix);
    state.encoding = encoding || 'paste-unicode';
    state.filledCurrent = false;
    state.queryStatus = [];
    state.index = 0;
    if (fileName && fileName !== 'paste') state.fileName = fileName;
    else state.fileName = pasteIdFromMatrix(matrix);
    loadProgress();
    var saved = storeGet('progress:' + state.fileName, null);
    if (saved && saved.done) {
      var k;
      for (k in saved.done) {
        if (state.rows[k]) state.rows[k]._status = saved.done[k];
      }
    }
    setStatus(
      '已载入 ' + state.rows.length + ' 条，' +
      (state.index > 0 ? ('继续第 ' + (state.index + 1) + ' 条') : '从第 1 条开始') +
      '（' + state.encoding + '）'
    );
    renderPanel();
  }
  function onFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var decoded = decodeBuffer(reader.result);
      applyImported(decoded.text, decoded.encoding, file.name);
    };
    reader.readAsArrayBuffer(file);
  }
  function mark(status) {
    if (!state.rows[state.index]) return;
    state.rows[state.index]._status = status;
    state.filledCurrent = false;
    if (state.index < state.rows.length - 1) state.index++;
    saveProgress();
    state.queryStatus = [];
    renderPanel();
    setStatus(status === 'ok' ? '已记成功，已到下一条' : '已跳过，已到下一条');
  }
  function ensureStyle() {
    if ($('dcinput-style')) return;
    var css = document.createElement('style');
    css.id = 'dcinput-style';
    css.textContent = [
      '#dcinput-panel{position:fixed;bottom:10px;left:10px;z-index:2147483646;width:300px;max-height:calc(100vh - 20px);overflow:auto;background:#1b2838;color:#e8eef5;font:12px/1.3 "Microsoft YaHei",sans-serif;border:1px solid #3d5a73;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.35);padding:6px 8px 8px}',
      '#dcinput-panel *{box-sizing:border-box}',
      '#dcinput-panel h1{margin:0 0 2px;font-size:13px;color:#7fd4cf;display:flex;justify-content:space-between;align-items:center}',
      '#dcinput-panel .dc-row{display:flex;gap:4px;flex-wrap:wrap;margin:3px 0}',
      '#dcinput-panel button,#dcinput-panel label.dc-btn{background:#2c7a75;color:#fff;border:0;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:11px;line-height:1.4}',
      '#dcinput-panel button.dc-sub,#dcinput-panel label.dc-btn.dc-sub{background:#35536b}',
      '#dcinput-panel button.dc-danger{background:#8a3b3b}',
      '#dcinput-panel label{font-size:11px;color:#9bb0c3;white-space:nowrap}',
      '#dcinput-name{font-weight:700;color:#fff;word-break:break-all;font-size:12px;margin:1px 0}',
      '#dcinput-meta,#dcinput-status,.dc-hint{color:#9bb0c3;font-size:11px;margin:1px 0}',
      '#dcinput-status{max-height:2.6em;overflow:hidden}',
      '.dc-q{display:flex;justify-content:space-between;gap:6px;padding:1px 0;border-bottom:1px dashed #2a3f52;font-size:11px}',
      '.dc-q span{color:#f6d98a}',
      '#dcinput-panel .dc-foot{display:flex;justify-content:space-between;align-items:center;gap:4px;margin:2px 0 0;color:#7a90a4;font-size:11px}',
      '#dcinput-hide{position:fixed;bottom:10px;left:10px;z-index:2147483646;display:none;background:#2c7a75;color:#fff;border:0;border-radius:4px;padding:5px 8px;cursor:pointer;font-size:12px}'
    ].join('');
    document.documentElement.appendChild(css);
  }
  function buildPanel() {
    ensureStyle();
    if ($('dcinput-panel')) return;
    var wrap = document.createElement('div');
    wrap.id = 'dcinput-panel';
    wrap.innerHTML = [
      '<h1><span>调控云录入助手 <small style="color:#7a90a4">v' + VERSION + '</small></span>',
      '<button id="dcinput-min" class="dc-sub" type="button">收起</button></h1>',
      '<div class="dc-foot"><span id="dcinput-counter">0 / 0</span></div>',
      '<div id="dcinput-name">（未导入）</div>',
      '<div id="dcinput-meta">列名=网页 name</div>',
      '<div class="dc-row">',
      '<label class="dc-btn dc-sub">选择CSV<input id="dcinput-file" type="file" accept=".csv,text/csv,text/plain" style="display:none"></label>',
      '<button id="dcinput-paste" type="button">粘贴Excel</button>',
      '<button id="dcinput-names" class="dc-sub" type="button">复制name</button>',
      '<button id="dcinput-prev" class="dc-sub" type="button">上一条</button>',
      '</div>',
      '<div class="dc-row">',
      '<button id="dcinput-fill" type="button">填入本条 Alt+1</button>',
      '<button id="dcinput-ok" class="dc-sub" type="button">填入并下一条 Alt+2</button>',
      '<button id="dcinput-next" type="button">下一条</button>',
      '</div>',
      '<div id="dcinput-queries"></div>',
      '<div id="dcinput-status">打开详情弹窗后填入；多列少列自动跳过</div>'
    ].join('');
    document.body.appendChild(wrap);
    var hide = document.createElement('button');
    hide.id = 'dcinput-hide';
    hide.type = 'button';
    hide.textContent = '录入助手';
    document.body.appendChild(hide);

    $('dcinput-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onFile(e.target.files[0]);
    });
    $('dcinput-paste').addEventListener('click', function () {
      var t = prompt('从 Excel 复制后粘贴（含表头，表头=网页 name）：');
      if (t) applyImported(t, 'paste-unicode', 'paste');
    });
    $('dcinput-names').addEventListener('click', copyPageNames);
    $('dcinput-fill').addEventListener('click', fillCurrent);
    $('dcinput-ok').addEventListener('click', fillAndNext);
    $('dcinput-prev').addEventListener('click', goPrev);
    $('dcinput-next').addEventListener('click', goNext);
    $('dcinput-min').addEventListener('click', function () {
      wrap.style.display = 'none';
      hide.style.display = 'block';
      state.visible = false;
    });
    hide.addEventListener('click', function () {
      wrap.style.display = 'block';
      hide.style.display = 'none';
      state.visible = true;
    });
    document.addEventListener('keydown', function (e) {
      if (!e.altKey) return;
      if (e.key === '1') { e.preventDefault(); fillCurrent(); }
      if (e.key === '2') { e.preventDefault(); fillAndNext(); }
    });
    // 默认收起：只显示「录入助手」按钮
    wrap.style.display = 'none';
    hide.style.display = 'block';
    state.visible = false;
    renderPanel();
  }
  function shouldShowPanel() {
    try { return window.self === window.top; } catch (e) { return true; }
  }
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    if (!shouldShowPanel()) return;
    buildPanel();
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开录入助手', function () {
          var p = $('dcinput-panel');
          var h = $('dcinput-hide');
          if (p) {
            p.style.display = 'block';
            if (h) h.style.display = 'none';
            state.visible = true;
          } else buildPanel();
        });
        GM_registerMenuCommand('复制本页 name', copyPageNames);
      }
    } catch (e) {}
  }
  boot();
})();
