/*
 * 저장소 — claude.ai 아티팩트로 열리면 공유 DB(모든 사용자가 같은 데이터),
 * 그 외(GitHub Pages, 로컬 파일)에서는 이 브라우저의 localStorage에 저장합니다.
 *
 * 공유 DB 문서 구조 (문서당 256KiB 제한 때문에 행은 나눠 저장)
 *   app/settings        { settings, updatedAt }
 *   app/items           { items }
 *   sheets/<key>        { name, meta, headers, groups, editedAt, chunks }
 *   rows/<key>-<n>      { rows }
 */
(function (root) {
  'use strict';

  var E = root.SOPEngine;
  var LOCAL_KEY = 'sop-dashboard-v1';
  var CHUNK_BYTES = 180000;

  var mode = 'local';
  var db = null;
  var readOnly = false;
  var lastWritten = {};   // 경로 → 마지막으로 쓰거나 받은 JSON (중복 쓰기·자기 메아리 방지)
  var timer = null;
  var writing = Promise.resolve();
  var pendingState = null;
  var listeners = { saved: null, error: null, remote: null };
  var docs = { app: {}, sheets: {}, rows: {} };

  function normalize(s) {
    var base = E.emptyState();
    if (!s || typeof s !== 'object') return base;
    s.settings = Object.assign({}, base.settings, s.settings || {});
    s.items = Array.isArray(s.items) ? s.items : [];
    s.sheets = s.sheets || {};
    E.SHEETS.forEach(function (d) { if (!s.sheets[d.key]) s.sheets[d.key] = base.sheets[d.key]; });
    return s;
  }

  function loadLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); }
    catch (e) { return E.emptyState(); }
  }

  // ── 상태 ↔ 문서 ─────────────────────────────────────
  function toDocs(state) {
    var out = {};
    out['app/settings'] = { settings: state.settings, updatedAt: state.updatedAt || null };
    out['app/items'] = { items: state.items };
    E.SHEETS.forEach(function (d) {
      var sh = state.sheets[d.key];
      var chunks = [], cur = [], size = 0;
      sh.rows.forEach(function (r) {
        var n = JSON.stringify(r).length + 1;
        if (cur.length && size + n > CHUNK_BYTES) { chunks.push(cur); cur = []; size = 0; }
        cur.push(r); size += n;
      });
      if (cur.length) chunks.push(cur);
      out['sheets/' + d.key] = {
        name: sh.name, meta: sh.meta || '', headers: sh.headers, groups: sh.groups || [],
        editedAt: sh.editedAt || null, chunks: chunks.length
      };
      chunks.forEach(function (rows, i) { out['rows/' + d.key + '-' + i] = { rows: rows }; });
    });
    return out;
  }

  function fromDocs() {
    var s = E.emptyState();
    var set = docs.app.settings, items = docs.app.items;
    if (set) { s.settings = Object.assign({}, s.settings, set.settings || {}); s.updatedAt = set.updatedAt || null; }
    if (items) s.items = items.items || [];
    E.SHEETS.forEach(function (d) {
      var h = docs.sheets[d.key];
      if (!h) return;
      var rows = [];
      for (var i = 0; i < (h.chunks || 0); i++) {
        var c = docs.rows[d.key + '-' + i];
        if (c && c.rows) rows = rows.concat(c.rows);
      }
      s.sheets[d.key] = {
        name: h.name || d.name, meta: h.meta || '', headers: h.headers || [], groups: h.groups || [],
        editedAt: h.editedAt || null, rows: rows
      };
    });
    return normalize(s);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  // ── 공유 DB 연결 ────────────────────────────────────
  function readAll() {
    return Promise.all(['app', 'sheets', 'rows'].map(function (c) {
      return db.collection(c).get().then(function (snap) {
        docs[c] = {};
        snap.docs.forEach(function (d) {
          var body = d.data();
          docs[c][d.id] = clone(body);
          lastWritten[c + '/' + d.id] = JSON.stringify(body);
        });
      });
    }));
  }

  function subscribe() {
    ['app', 'sheets', 'rows'].forEach(function (c) {
      db.collection(c).onSnapshot(function (snap) {
        if (snap.metadata.hasPendingWrites) return;
        var changed = false;
        snap.docChanges().forEach(function (ch) {
          var path = c + '/' + ch.doc.id;
          if (ch.type === 'removed') {
            if (docs[c][ch.doc.id]) { delete docs[c][ch.doc.id]; delete lastWritten[path]; changed = true; }
            return;
          }
          var body = ch.doc.data();
          var json = JSON.stringify(body);
          if (lastWritten[path] === json) return; // 내가 쓴 내용의 메아리
          lastWritten[path] = json;
          docs[c][ch.doc.id] = clone(body);
          changed = true;
        });
        if (changed && listeners.remote) {
          clearTimeout(subscribe._t);
          // 여러 문서가 연달아 바뀌는 동안은 기다렸다가 한 번에 반영
          subscribe._t = setTimeout(function () { listeners.remote(fromDocs()); }, 400);
        }
      }, function (err) {
        if (listeners.error) listeners.error(err);
      });
    });
  }

  function init() {
    var local = loadLocal();
    var use = root.claude && typeof root.claude.use === 'function' ? root.claude.use.bind(root.claude) : null;
    if (!use) return Promise.resolve({ state: local, mode: 'local', readOnly: false });
    return use('db').then(function (d) {
      if (!d) return { state: local, mode: 'local', readOnly: false };
      db = d;
      mode = 'shared';
      return use('user').then(function (u) {
        return u ? Promise.resolve(u.can('data.write')).catch(function () { return null; }) : null;
      }).catch(function () { return null; }).then(function (can) {
        readOnly = can === false;
        return readAll().then(function () {
          subscribe();
          return { state: fromDocs(), mode: 'shared', readOnly: readOnly };
        });
      });
    }).catch(function () {
      mode = 'local'; db = null;
      return { state: local, mode: 'local', readOnly: false };
    });
  }

  // ── 저장 ───────────────────────────────────────────
  function writeShared(state) {
    var next = toDocs(state);
    var ops = [];
    Object.keys(next).forEach(function (path) {
      var json = JSON.stringify(next[path]);
      if (lastWritten[path] !== json) ops.push({ path: path, body: next[path], json: json });
    });
    // 행 수가 줄어 남은 조각 문서는 삭제
    Object.keys(lastWritten).forEach(function (path) {
      if (path.indexOf('rows/') === 0 && !next[path]) ops.push({ path: path, del: true });
    });
    if (!ops.length) return Promise.resolve();
    return ops.reduce(function (p, op) {
      return p.then(function () {
        var ref = db.doc(op.path);
        // 저장이 끝나기 전에 내 변경이 스냅샷으로 먼저 돌아오므로, 쓰기 전에 기록해 두어야 '다른 사람 변경'으로 오인하지 않음
        var prev = lastWritten[op.path];
        if (op.del) {
          delete lastWritten[op.path];
          return ref.delete().catch(function (e) { if (prev !== undefined) lastWritten[op.path] = prev; throw e; });
        }
        lastWritten[op.path] = op.json;
        return ref.set(op.body).catch(function (e) {
          if (prev === undefined) delete lastWritten[op.path]; else lastWritten[op.path] = prev;
          throw e;
        });
      });
    }, Promise.resolve()).then(function () {
      // 다른 사용자 변경을 다시 조립할 때 쓰는 사본도 최신으로
      Object.keys(next).forEach(function (path) {
        var parts = path.split('/');
        docs[parts[0]][parts[1]] = clone(next[path]);
      });
      Object.keys(docs.rows).forEach(function (id) { if (!next['rows/' + id]) delete docs.rows[id]; });
    });
  }

  function doFlush() {
    clearTimeout(timer);
    timer = null;
    var state = pendingState;
    pendingState = null;
    if (!state) return writing;
    if (mode === 'local') {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
        if (listeners.saved) listeners.saved();
      } catch (e) {
        if (listeners.error) listeners.error({ code: 'local_failed', message: e.message });
      }
      return writing;
    }
    if (readOnly) return writing;
    writing = writing.then(function () { return writeShared(state); }).then(function () {
      if (listeners.saved) listeners.saved();
    }).catch(function (err) {
      if (err && err.code === 'invalid_argument') readOnly = true;
      if (listeners.error) listeners.error(err || { code: 'unavailable' });
    });
    return writing;
  }

  function save(state) {
    pendingState = state;
    clearTimeout(timer);
    timer = setTimeout(doFlush, mode === 'shared' ? 800 : 250);
  }

  function clearLocal() {
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* 무시 */ }
  }

  root.SOPStore = {
    init: init,
    save: save,
    flush: doFlush,
    normalize: normalize,
    clearLocal: clearLocal,
    on: function (ev, fn) { listeners[ev] = fn; },
    get mode() { return mode; },
    get readOnly() { return readOnly; }
  };
})(window);
