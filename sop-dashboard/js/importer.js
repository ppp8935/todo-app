/*
 * 엑셀(.xlsx) ↔ 대시보드 데이터 변환. SheetJS(XLSX) 전역 객체를 사용합니다.
 */
(function (root) {
  'use strict';

  var E = root.SOPEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var EXPORT_SHEET = '리덴스_S&OP';         // 내보내기 시트명

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

  function norm(h) { return String(h === null || h === undefined ? '' : h).replace(/\s+/g, '').toLowerCase(); }

  // ── 구조로 시트 종류 알아내기 ─────────────────────────
  // 파일명·시트명과 관계없이, 위쪽 10행 안에서 헤더 행을 찾아 열 구성으로 판단합니다.
  function has(set, names) { return names.some(function (n) { return set.indexOf(norm(n)) >= 0; }); }
  function monthCount(set) { return set.filter(function (h) { return /^\d{1,2}월$/.test(h); }).length; }

  var SIGNATURES = [
    { key: 'items', test: function (h) { return has(h, ['ERP코드']) && has(h, ['반제품코드']) && has(h, ['현재고']) && has(h, ['LT']); } },
    { key: 'sop', test: function (h) { return has(h, ['ERP 코드 조정']) && has(h, ['총합계']) && monthCount(h) >= 9; } },
    { key: 'transit', test: function (h) { return has(h, ['발주번호']) && has(h, ['품번', '품목코드']) && has(h, ['발주잔량', '잔량', '미입고수량']); } },
    { key: 'semi', test: function (h) { return has(h, ['모품번']) && has(h, ['자품번']); } },
    { key: 'raw', test: function (h) { return has(h, ['물류센터', '센터', '창고', '창고명']) && has(h, ['가용재고', '가용수량', '재고수량']) && has(h, ['상품명', '품명']); } },
    { key: 'sales', test: function (h) { return has(h, ['ERP 코드 조정']) && has(h, ['상품코드']) && monthCount(h) >= 1; } },
    { key: 'stock', test: function (h) { return has(h, ['ERP 코드 조정']) && has(h, ['가용재고']); } }
  ];

  function classify(ws) {
    var X = getXLSX();
    var aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    for (var r = 0; r < Math.min(10, aoa.length); r++) {
      var h = (aoa[r] || []).map(norm).filter(Boolean);
      if (h.length < 3) continue;
      for (var k = 0; k < SIGNATURES.length; k++) {
        if (SIGNATURES[k].test(h)) return { key: SIGNATURES[k].key, hr: r };
      }
    }
    return null;
  }

  // 파일 하나에서 인식된 시트 목록: [{ key, sheet, hr }]
  function scanWorkbook(wb) {
    var out = [];
    wb.SheetNames.forEach(function (name) {
      var c = classify(wb.Sheets[name]);
      if (c) out.push({ key: c.key, sheet: name, hr: c.hr });
    });
    return out;
  }

  // 열 순서가 다른 원본(WMS·ERP 다운로드)도 계산에 쓰는 순서로 맞춤
  var CANON = {
    raw: [
      ['대표코드(ERP)', ['대표코드(ERP)', '대표코드', 'ERP코드', 'ERP']],
      ['상품코드', ['상품코드', '상품번호']],
      ['상품명', ['상품명', '품명']],
      ['바코드', ['바코드']],
      ['물류센터', ['물류센터', '센터', '센터명']],
      ['창고', ['창고', '창고명']],
      ['유통기한', ['유통기한', '소비기한', '유효기한']],
      ['가용재고', ['가용재고', '가용수량', '재고수량']]
    ],
    transit: [
      ['No', ['No', 'No.']], ['마감여부', ['마감여부']], ['발주번호', ['발주번호']], ['L/C', ['L/C']],
      ['발주일자', ['발주일자', '발주일']], ['거래처', ['거래처', '거래처명']], ['순번', ['순번']],
      ['품번', ['품번', '품목코드']], ['품명', ['품명', '품목명']], ['규격', ['규격']], ['관리단위', ['관리단위', '단위']],
      ['환종', ['환종']], ['환율', ['환율']], ['발주수량', ['발주수량']], ['발주잔량', ['발주잔량', '잔량', '미입고수량']],
      ['마감일자', ['마감일자']], ['마감사유', ['마감사유']], ['납기일자', ['납기일자', '납기일', '입고예정일']],
      ['담당자', ['담당자']], ['관리번호', ['관리번호']], ['비고(건)', ['비고(건)']], ['관리구분', ['관리구분']],
      ['프로젝트', ['프로젝트']], ['비고(내역)', ['비고(내역)']]
    ]
  };

  function canonicalize(sheet, key) {
    var spec = CANON[key];
    if (!spec) return sheet;
    var src = sheet.headers.map(norm);
    var used = {};
    var map = spec.map(function (s) {
      for (var i = 0; i < s[1].length; i++) {
        var j = src.indexOf(norm(s[1][i]));
        if (j >= 0 && !used[j]) { used[j] = true; return j; }
      }
      return -1;
    });
    var extra = [];
    src.forEach(function (h, j) { if (!used[j] && h) extra.push(j); });
    sheet.headers = spec.map(function (s) { return s[0]; }).concat(extra.map(function (j) { return sheet.headers[j]; }));
    sheet.rows = sheet.rows.map(function (r) {
      return map.map(function (j) { return j >= 0 ? r[j] : null; }).concat(extra.map(function (j) { return r[j]; }));
    });
    sheet.groups = [];
    return sheet;
  }

  // 헤더 행(hr) 위는 제목·그룹, 아래는 데이터
  function parseSheet(ws, name, headerRow) {
    var X = getXLSX();
    var hr = headerRow === undefined ? 1 : headerRow;
    var aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    var top = hr > 0 ? (aoa[hr - 1] || []).map(cleanValue) : [];
    var headers = (aoa[hr] || []).map(function (h) { return h === null ? '' : String(h).trim(); });
    var width = headers.length;
    while (width > 0 && headers[width - 1] === '') width--;
    headers = headers.slice(0, width);

    var groups = [];
    top.forEach(function (v, i) {
      if (v !== null && String(v).trim() !== '' && i < width) groups.push({ label: String(v).trim(), start: i, span: 1 });
    });
    groups.forEach(function (g, k) { g.span = (k + 1 < groups.length ? groups[k + 1].start : width) - g.start; });

    var meta = aoa.slice(0, hr).reduce(function (acc, row) { return acc.concat(row || []); }, [])
      .filter(function (v) { return v !== null && /UPDATE/i.test(String(v)); }).join(' ').trim();

    var rows = aoa.slice(hr + 1).map(function (r) {
      var out = [];
      for (var i = 0; i < width; i++) out.push(cleanValue((r || [])[i]));
      return out;
    }).filter(function (r) {
      return !isEmptyRow(r) && String(r[0] || '').trim() !== '합계';
    });

    // 그룹 행이 사실상 제목뿐이면(예: '재고 현황') 그룹 표시는 생략
    if (groups.length < 3) groups = [];
    return { name: name, meta: meta, headers: headers, groups: groups, rows: rows };
  }

  // 품목 목록(Master_리덴스, Master_전체, 대시보드 내보내기)을 헤더 이름으로 읽음
  function parseMaster(ws, headerRow) {
    var X = getXLSX();
    var range = X.utils.decode_range(ws['!ref']);
    var items = [];
    var hr = headerRow === undefined ? 1 : headerRow;
    function cell(r, c) { return ws[X.utils.encode_cell({ r: r, c: c })]; }
    function val(r, c) { if (c < 0) return null; var x = cell(r, c); return x ? cleanValue(x.v) : null; }
    var heads = [];
    for (var c = 0; c <= range.e.c; c++) heads.push(norm(val(hr, c)));
    function col(names) {
      for (var i = 0; i < names.length; i++) { var j = heads.indexOf(norm(names[i])); if (j >= 0) return j; }
      return -1;
    }
    var cErp = col(['ERP코드']), cSemi = col(['반제품코드']), cName = col(['상품명']), cGroup = col(['품목군']);
    var cStock = col(['현재고']), cTransit = col(['미입고']), cLt = col(['LT', 'LT(일)']);
    var cAdj = col(['발주조정']), cNote = col(['비고']);
    var cNote2 = cNote >= 0 && !heads[cNote + 1] ? cNote + 1 : col(['비고2']);
    var cSop = heads.findIndex(function (h) { return /^\d{1,2}월s&op$/.test(h); });
    // 이 대시보드에서 내보낸 파일은 수식이 없으므로 수기값 여부를 판단할 수 없음
    var exported = /대시보드 내보내기/.test(String(val(0, 0) || ''));
    for (var r = hr + 1; r <= range.e.r; r++) {
      var erp = val(r, cErp);
      if (erp === null || String(erp).trim() === '') continue;
      var e = cStock >= 0 ? cell(r, cStock) : null, f = cTransit >= 0 ? cell(r, cTransit) : null, n = cSop >= 0 ? cell(r, cSop) : null;
      var str = function (v, d) { return v === null ? d : String(v).trim(); };
      items.push({
        erp: String(erp).trim(),
        semi: str(val(r, cSemi), '-'),
        name: str(val(r, cName), ''),
        group: str(val(r, cGroup), ''),
        lt: E.num(val(r, cLt)),
        // 수식 대신 값이 직접 입력된 행(신제품 등)은 수기 입력값으로 보존
        stockOverride: !exported && e && !e.f ? E.num(e.v) : null,
        transitOverride: !exported && f && !f.f ? E.num(f.v) : null,
        sopMatch: n && n.f && /\$C:\$C/.test(n.f) ? 'name' : 'code',
        exported: exported,
        adjust: val(r, cAdj) === null ? '' : val(r, cAdj),
        note: str(val(r, cNote), ''),
        note2: str(val(r, cNote2), '')
      });
    }
    return items;
  }

  // 인식된 시트 하나를 상태에 반영
  function applyEntry(state, wb, entry) {
    var ws = wb.Sheets[entry.sheet];
    if (entry.key === 'items') {
      var prev = {};
      state.items.forEach(function (it) { prev[it.erp] = it; });
      state.items = parseMaster(ws, entry.hr).map(function (it) {
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
    var def = E.SHEETS.filter(function (d) { return d.key === entry.key; })[0];
    if (!def) return;
    state.sheets[entry.key] = canonicalize(parseSheet(ws, def.name, entry.hr), entry.key);
  }

  // 예전 방식 호환: 워크북에서 종류별 첫 시트
  function detect(wb) {
    var seen = {};
    return scanWorkbook(wb).filter(function (e) { if (seen[e.key]) return false; seen[e.key] = true; return true; })
      .map(function (e) { return { key: e.key, name: e.sheet, hr: e.hr, sheet: e.sheet }; });
  }

  function applyWorkbook(state, wb, keys) {
    detect(wb).forEach(function (e) { if (keys.indexOf(e.key) >= 0) applyEntry(state, wb, e); });
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
    readWorkbook: readWorkbook,
    scanWorkbook: scanWorkbook,
    applyEntry: applyEntry,
    parseSheet: parseSheet,
    parseMaster: parseMaster,
    detect: detect,
    applyWorkbook: applyWorkbook,
    exportWorkbook: exportWorkbook
  };
  root.SOPImporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
