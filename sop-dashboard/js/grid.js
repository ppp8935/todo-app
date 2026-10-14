/*
 * 편집 가능한 표 — 셀 클릭 후 입력, Enter/Tab 이동, 엑셀 범위 붙여넣기 지원.
 *
 * new SOPGrid(container, {
 *   columns: [{ label, key, type: 'text'|'number'|'select', options, readOnly, width }],
 *   groups:  [{ label, start, span }],
 *   rows:    () => 2차원 배열(실제 데이터, 직접 수정됨),
 *   filter:  (row) => boolean,
 *   stickyCols: 앞쪽 고정 열 개수,
 *   onChange: (rowIndex) => void   // 값이 바뀐 행 (여러 행이면 -1)
 *   onDelete: (rowIndex) => void
 *   newRow:   () => 새 빈 행 (붙여넣기로 행이 늘어날 때)
 *   rowClass: (row) => string
 * })
 */
(function (root) {
  'use strict';

  var ROWNUM_W = 52;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(v, col) {
    if (v === null || v === undefined || v === '') return '';
    if (col.type === 'number' && typeof v === 'number') {
      return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }); // 표시는 정수, 편집 시 원래 값
    }
    if (col.type === 'select' && col.options) {
      var o = col.options.filter(function (x) { return x.value === v; })[0];
      return o ? o.label : v;
    }
    return v;
  }

  function parseInput(text, col) {
    var t = String(text).replace(/ /g, ' ').trim();
    if (t === '') return col.type === 'number' ? null : '';
    if (col.type === 'number') {
      var n = Number(t.replace(/,/g, ''));
      return isFinite(n) ? n : t; // '-' 같은 표기는 그대로 보존
    }
    return t;
  }

  // 열에 key가 있으면 객체 행(row[key]), 없으면 배열 행(row[index])
  function getv(row, col, ci) { return col.key ? row[col.key] : row[ci]; }
  function setv(row, col, ci, v) { if (col.key) row[col.key] = v; else row[ci] = v; }

  function SOPGrid(el, opts) {
    this.el = el;
    this.o = opts;
    this.editing = null;
    this.limit = 300; // 한 번에 그리는 행 수 (스크롤 시 더 보기)
    this._bind();
  }

  SOPGrid.prototype.visibleRows = function () {
    var rows = this.o.rows(), out = [];
    var f = this.o.filter;
    for (var i = 0; i < rows.length; i++) if (!f || f(rows[i])) out.push(i);
    return out;
  };

  SOPGrid.prototype.colLefts = function () {
    var lefts = [], x = ROWNUM_W;
    var n = this.o.stickyCols || 0;
    for (var i = 0; i < n; i++) { lefts.push(x); x += this.o.columns[i].width || 110; }
    return lefts;
  };

  SOPGrid.prototype.render = function () {
    var cols = this.o.columns, self = this;
    var lefts = this.colLefts();
    var vis = this.visibleRows();
    this._vis = vis;

    var total = ROWNUM_W + 40;
    cols.forEach(function (c) { total += c.width || 110; });
    var h = '<table class="grid" style="width:' + total + 'px"><colgroup><col style="width:' + ROWNUM_W + 'px">';
    cols.forEach(function (c) { h += '<col style="width:' + (c.width || 110) + 'px">'; });
    h += '<col style="width:40px"></colgroup><thead>';
    if (this.o.groups && this.o.groups.length) {
      h += '<tr class="grp"><th class="sticky rn" style="left:0"></th>';
      var covered = 0;
      this.o.groups.forEach(function (g) {
        if (g.start > covered) { h += '<th colspan="' + (g.start - covered) + '"></th>'; }
        h += '<th colspan="' + g.span + '">' + esc(g.label) + '</th>';
        covered = g.start + g.span;
      });
      if (covered < cols.length) h += '<th colspan="' + (cols.length - covered) + '"></th>';
      h += '<th></th></tr>';
    }
    h += '<tr><th class="sticky rn" style="left:0">#</th>';
    cols.forEach(function (c, i) {
      var cls = (i < lefts.length ? 'sticky ' : '') + (c.readOnly ? 'ro' : '') + (c.type === 'number' ? ' num' : '');
      h += '<th class="' + cls + '"' + (i < lefts.length ? ' style="left:' + lefts[i] + 'px"' : '') +
        (c.readOnly ? ' title="자동 계산"' : '') + '>' + esc(c.label) + '</th>';
    });
    h += '<th></th></tr></thead><tbody>';
    var shown = vis.slice(0, this.limit);
    shown.forEach(function (ri) { h += self.rowHtml(ri, lefts); });
    h += '</tbody></table>';
    if (vis.length > shown.length) {
      h += '<div class="grid-more"><button class="btn" type="button" data-more>나머지 ' +
        (vis.length - shown.length).toLocaleString('ko-KR') + '행 더 보기</button></div>';
    }
    if (!vis.length) h += '<p class="grid-empty">표시할 행이 없습니다.</p>';
    this.el.innerHTML = h;
  };

  SOPGrid.prototype.rowHtml = function (ri, lefts) {
    var row = this.o.rows()[ri], cols = this.o.columns;
    lefts = lefts || this.colLefts();
    var rc = this.o.rowClass ? this.o.rowClass(row) : '';
    var h = '<tr data-r="' + ri + '"' + (rc ? ' class="' + rc + '"' : '') + '><td class="sticky rn" style="left:0">' + (ri + 1) + '</td>';
    cols.forEach(function (c, ci) {
      var v = getv(row, c, ci);
      var cls = [];
      if (ci < lefts.length) cls.push('sticky');
      if (c.readOnly) cls.push('ro');
      if (c.type === 'number') cls.push('num');
      if (c.type === 'number' && typeof v === 'number' && v < 0) cls.push('neg');
      h += '<td data-c="' + ci + '" class="' + cls.join(' ') + '"' +
        (ci < lefts.length ? ' style="left:' + lefts[ci] + 'px"' : '') +
        (c.readOnly ? '' : ' tabindex="-1"') + '>' + esc(fmt(v, c)) + '</td>';
    });
    h += '<td class="act">' + (this.o.onDelete ? '<button type="button" class="icon-btn" data-del aria-label="행 삭제" title="행 삭제">×</button>' : '') + '</td></tr>';
    return h;
  };

  SOPGrid.prototype.refreshRow = function (ri) {
    var tr = this.el.querySelector('tr[data-r="' + ri + '"]');
    if (!tr) return;
    var tmp = document.createElement('tbody');
    tmp.innerHTML = this.rowHtml(ri);
    tr.replaceWith(tmp.firstChild);
  };

  SOPGrid.prototype._bind = function () {
    var self = this;
    this.el.addEventListener('click', function (e) {
      if (e.target.closest('[data-more]')) { self.limit += 500; self.render(); return; }
      var del = e.target.closest('[data-del]');
      if (del) {
        var ri = Number(del.closest('tr').dataset.r);
        self.o.onDelete(ri);
        return;
      }
      var td = e.target.closest('td[data-c]');
      if (td && !td.classList.contains('ro') && td !== self.editing) self.startEdit(td);
    });
    this.el.addEventListener('keydown', function (e) {
      var td = self.editing;
      if (!td) return;
      if (e.key === 'Escape') { e.preventDefault(); self.cancelEdit(); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); self.commit(); self.move(td, 1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); self.commit(); self.move(td, 0, e.shiftKey ? -1 : 1); }
    });
    this.el.addEventListener('focusout', function (e) {
      if (self.editing && e.target === self.editing) self.commit();
    });
    this.el.addEventListener('paste', function (e) {
      if (!self.editing) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // 단일 값은 기본 동작
      e.preventDefault();
      var td = self.editing;
      self.cancelEdit();
      self.pasteBlock(td, text);
    });
  };

  SOPGrid.prototype.startEdit = function (td) {
    if (this.editing) this.commit();
    var ri = Number(td.parentNode.dataset.r), ci = Number(td.dataset.c);
    var col = this.o.columns[ci];
    if (col.type === 'select') { this.editSelect(td, ri, ci, col); return; }
    var v = getv(this.o.rows()[ri], col, ci);
    td.textContent = v === null || v === undefined ? '' : String(v);
    td.contentEditable = 'plaintext-only';
    if (td.contentEditable !== 'plaintext-only') td.contentEditable = 'true';
    td.classList.add('editing');
    this.editing = td;
    td.focus();
    var range = document.createRange();
    range.selectNodeContents(td);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  SOPGrid.prototype.editSelect = function (td, ri, ci, col) {
    var self = this, row = this.o.rows()[ri];
    var s = document.createElement('select');
    col.options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      if (getv(row, col, ci) === o.value) op.selected = true;
      s.appendChild(op);
    });
    td.textContent = '';
    td.appendChild(s);
    s.focus();
    var done = function () {
      setv(row, col, ci, s.value);
      self.o.onChange(ri);
      self.refreshRow(ri);
    };
    s.addEventListener('change', done);
    s.addEventListener('blur', function () { if (s.isConnected) self.refreshRow(ri); });
  };

  SOPGrid.prototype.commit = function () {
    var td = this.editing;
    if (!td) return;
    this.editing = null;
    var ri = Number(td.parentNode.dataset.r), ci = Number(td.dataset.c);
    var row = this.o.rows()[ri];
    var col = this.o.columns[ci];
    var nv = parseInput(td.textContent, col);
    td.contentEditable = 'false';
    td.classList.remove('editing');
    var old = getv(row, col, ci);
    if (nv !== old && !(nv === null && (old === null || old === undefined || old === ''))) {
      setv(row, col, ci, nv);
      this.o.onChange(ri);
    }
    this.refreshRow(ri);
  };

  SOPGrid.prototype.cancelEdit = function () {
    var td = this.editing;
    if (!td) return;
    this.editing = null;
    td.contentEditable = 'false';
    this.refreshRow(Number(td.parentNode.dataset.r));
  };

  SOPGrid.prototype.move = function (td, dr, dc) {
    var ri = Number(td.parentNode.dataset.r), ci = Number(td.dataset.c);
    var vis = this._vis, pos = vis.indexOf(ri), cols = this.o.columns;
    var nci = ci + dc, npos = pos + dr;
    while (nci >= 0 && nci < cols.length && cols[nci].readOnly) nci += dc || 1;
    if (nci < 0 || nci >= cols.length || npos < 0 || npos >= vis.length) return;
    var next = this.el.querySelector('tr[data-r="' + vis[npos] + '"] td[data-c="' + nci + '"]');
    if (next) this.startEdit(next);
  };

  // 엑셀에서 복사한 여러 셀을 현재 셀 기준으로 펼쳐 넣기 (필요하면 행 추가)
  SOPGrid.prototype.pasteBlock = function (td, text) {
    var self = this, rows = this.o.rows(), cols = this.o.columns;
    var lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (l) { return l.split('\t'); });
    var ri = Number(td.parentNode.dataset.r), ci = Number(td.dataset.c);
    var vis = this._vis, pos = vis.indexOf(ri);
    lines.forEach(function (cells, k) {
      var target = pos + k < vis.length ? vis[pos + k] : null;
      if (target === null) {
        rows.push(self.o.newRow ? self.o.newRow() : cols.map(function () { return null; }));
        target = rows.length - 1;
      }
      cells.forEach(function (val, j) {
        var c = ci + j;
        if (c < cols.length && !cols[c].readOnly) setv(rows[target], cols[c], c, parseInput(val, cols[c]));
      });
    });
    this.o.onChange(-1);
    this.render();
  };

  SOPGrid.parseInput = parseInput;
  SOPGrid.esc = esc;
  root.SOPGrid = SOPGrid;
})(window);
