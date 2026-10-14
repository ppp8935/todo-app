/*
 * 엑셀(.xlsx) ↔ 대시보드 데이터 변환. SheetJS(XLSX) 전역 객체를 사용합니다.
 */
(function (root) {
  'use strict';

  var E = root.SOPEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var MASTER_SHEET = 'Master_리덴스';      // 원본 엑셀의 시트명
  var EXPORT_SHEET = '리덴스_S&OP';         // 내보내기 시트명 (다시 불러올 때도 인식)

  function masterName(wb) {
    if (wb.SheetNames.indexOf(MASTER_SHEET) >= 0) return MASTER_SHEET;
    if (wb.SheetNames.indexOf(EXPORT_SHEET) >= 0) return EXPORT_SHEET;
    return null;
  }

  function getXLSX() {
    return root.XLSX || (typeof require !== 'undefined' ? require('xlsx') : null);
  }

  function isEmptyRow(row) {
    return !row || row.every(function (v) { return v === null || v === undefined || String(v).trim() === ''; });
  }

  function cleanValue(v) {
    if (v instanceof Date) {
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
    }
    if (typeof v === 'string') return v.replace(/\s+$/, '');
    return v === undefined ? null : v;
  }

  function readWorkbook(data) {
    return getXLSX().read(data, { type: 'array', cellDates: true, cellFormula: true });
  }

  // 기본 구조: 1행 = 제목/그룹, 2행 = 헤더, 3행~ = 데이터 (headerRow로 조정)
  function parseSheet(ws, name, headerRow) {
    var X = getXLSX();
    var hr = headerRow === undefined ? 1 : headerRow;
    var aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    var top = hr > 0 ? (aoa[0] || []).map(cleanValue) : [];
    var headers = (aoa[hr] || []).map(function (h) { return h === null ? '' : String(h).trim(); });
    var width = headers.length;
    while (width > 0 && headers[width - 1] === '') width--;
    headers = headers.slice(0, width);

    var groups = [];
    top.forEach(function (v, i) {
      if (v !== null && String(v).trim() !== '' && i < width) groups.push({ label: String(v).trim(), start: i, span: 1 });
    });
    groups.forEach(function (g, k) { g.span = (k + 1 < groups.length ? groups[k + 1].start : width) - g.start; });

    var meta = top.filter(function (v) { return v !== null && /UPDATE/i.test(String(v)); }).join(' ').trim();

    var rows = aoa.slice(hr + 1).map(function (r) {
      var out = [];
      for (var i = 0; i < width; i++) out.push(cleanValue(r[i]));
      return out;
    }).filter(function (r) {
      return !isEmptyRow(r) && String(r[0] || '').trim() !== '합계';
    });

    // 그룹 행이 사실상 제목뿐이면(예: '재고 현황') 그룹 표시는 생략
    if (groups.length < 3) groups = [];
    return { name: name, meta: meta, headers: headers, groups: groups, rows: rows };
  }

  function parseMaster(ws) {
    var X = getXLSX();
    var range = X.utils.decode_range(ws['!ref']);
    var items = [];
    function cell(r, c) { return ws[X.utils.encode_cell({ r: r, c: c })]; }
    function val(r, c) { var x = cell(r, c); return x ? cleanValue(x.v) : null; }
    // 이 대시보드에서 내보낸 파일은 수식이 없으므로 수기값 여부를 판단할 수 없음
    var exported = /대시보드 내보내기/.test(String(val(0, 0) || ''));
    for (var r = 2; r <= range.e.r; r++) {
      var erp = val(r, 0);
      if (erp === null || String(erp).trim() === '') continue;
      var e = cell(r, 4), f = cell(r, 5), n = cell(r, 13);
      items.push({
        erp: String(erp).trim(),
        semi: val(r, 1) === null ? '-' : String(val(r, 1)).trim(),
        name: val(r, 2) === null ? '' : String(val(r, 2)).trim(),
        group: val(r, 3) === null ? '' : String(val(r, 3)).trim(),
        lt: E.num(val(r, 8)),
        // 수식 대신 값이 직접 입력된 행(신제품 등)은 수기 입력값으로 보존
        stockOverride: !exported && e && !e.f ? E.num(e.v) : null,
        transitOverride: !exported && f && !f.f ? E.num(f.v) : null,
        sopMatch: n && n.f && /\$C:\$C/.test(n.f) ? 'name' : 'code',
        exported: exported,
        adjust: val(r, 26) === null ? '' : val(r, 26),
        note: val(r, 27) === null ? '' : String(val(r, 27)),
        note2: val(r, 28) === null ? '' : String(val(r, 28))
      });
    }
    return items;
  }

  // 워크북에서 인식 가능한 시트 목록
  function detect(wb) {
    var found = [];
    var mn = masterName(wb);
    if (mn) found.push({ key: 'items', name: mn });
    E.SHEETS.forEach(function (d) {
      if (wb.SheetNames.indexOf(d.name) >= 0) found.push({ key: d.key, name: d.name });
    });
    return found;
  }

  function applyWorkbook(state, wb, keys) {
    keys.forEach(function (key) {
      if (key === 'items') {
        var prev = {};
        state.items.forEach(function (it) { prev[it.erp] = it; });
        state.items = parseMaster(wb.Sheets[masterName(wb)]).map(function (it) {
          // 내보낸 파일을 다시 불러오면 기존 수기값·매칭 기준은 유지
          if (it.exported && prev[it.erp]) {
            it.stockOverride = prev[it.erp].stockOverride;
            it.transitOverride = prev[it.erp].transitOverride;
            it.sopMatch = prev[it.erp].sopMatch;
          }
          delete it.exported;
          return it;
        });
        return;
      }
      var def = E.SHEETS.filter(function (d) { return d.key === key; })[0];
      if (def) state.sheets[key] = parseSheet(wb.Sheets[def.name], def.name, def.headerRow);
    });
    state.updatedAt = new Date().toISOString();
    return state;
  }

  // ── 내보내기 ───────────────────────────────────────────
  function masterAoa(results, settings) {
    var months = E.windowMonths(settings);
    var head = ['ERP코드', '반제품코드', '상품명', '품목군', '현재고', '미입고', '가용재고(현+미입고)', 'S&OP 합계', 'LT']
      .concat(months.map(function (m) { return m + '월 입고예정'; }))
      .concat(months.map(function (m) { return m + '월 S&OP'; }))
      .concat(months.map(function (m) { return m + '월 월말잔여'; }))
      .concat(['안전재고(일평균×LT)', '품절 예상월', '발주 여부', '발주 기한', '권장발주량', '발주 조정', '비고', '비고2']);
    var rows = results.map(function (r) {
      var it = r.item;
      return [it.erp, it.semi, it.name, it.group, r.stock, r.transit, r.available, r.demandTotal, r.lt]
        .concat(r.inbound).concat(r.demand).concat(r.balance)
        .concat([r.safety, r.stockoutMonth ? r.stockoutMonth + '월' : '', r.review, r.deadline,
          r.recommended === null ? '' : r.recommended, it.adjust, it.note, it.note2]);
    });
    return [[EXPORT_SHEET + ' (대시보드 내보내기)'], head].concat(rows);
  }

  function sheetAoa(sheet, def) {
    if (def.headerRow === 0) return [sheet.headers].concat(sheet.rows);
    var top = [];
    if (sheet.groups && sheet.groups.length) {
      sheet.groups.forEach(function (g) { top[g.start] = g.label; });
    } else {
      top = [sheet.name, sheet.meta || ''];
    }
    return [top, sheet.headers].concat(sheet.rows);
  }

  function exportWorkbook(state, results) {
    var X = getXLSX();
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(masterAoa(results, state.settings)), EXPORT_SHEET);
    E.SHEETS.forEach(function (d) {
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sheetAoa(state.sheets[d.key], d)), d.name);
    });
    return wb;
  }

  var api = {
    MASTER_SHEET: MASTER_SHEET,
    readWorkbook: readWorkbook,
    parseSheet: parseSheet,
    parseMaster: parseMaster,
    detect: detect,
    applyWorkbook: applyWorkbook,
    exportWorkbook: exportWorkbook
  };
  root.SOPImporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
