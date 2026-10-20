/*
 * S&OP 계산 엔진 — 엑셀 "Master_리덴스" 시트의 수식을 그대로 재현합니다.
 * 브라우저(window.SOPEngine)와 Node(require) 양쪽에서 사용할 수 있습니다.
 */
(function (root) {
  'use strict';

  // 시트 정의: 엑셀 시트명, 저장 키, 계산 컬럼(읽기 전용)
  var SHEETS = [
    { key: 'sop',     name: 'S&OP',        computed: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
    { key: 'stock',   name: '재고 현황',     computed: [4] },
    { key: 'sales',   name: '판매 실적 현황', computed: [] },
    { key: 'transit', name: '발주 현황',      computed: [] },
    { key: 'raw',     name: '재고 현황_RAW', computed: [] },
    { key: 'semi',    name: '반제품코드',     computed: [], headerRow: 0 } // 제목 행 없이 1행이 헤더
  ];

  var DEFAULT_SETTINGS = {
    year: 2026,        // 계획 연도
    startMonth: 9,     // 검토 시작월
    months: 4,         // 검토 개월 수 (엑셀: 9~12월)
    moq: 10000,        // 최소 발주량 (MOQ)
    roundUnit: 5000,   // 권장발주량 올림 단위
    salesAvgMonths: 3, // 안전재고 산정용 판매 평균 개월 수
    baseDate: ''       // 기준일 (비우면 오늘)
  };

  // ── 값 정규화 ─────────────────────────────────────────
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = Number(String(v).replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
  }

  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 납기일자 → "YYYY-MM" (엑셀 LEFT(납기일자,7) 과 동일한 비교용)
  function yearMonth(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return v.getFullYear() + '-' + pad2(v.getMonth() + 1);
    if (typeof v === 'number') { // 엑셀 날짜 일련번호
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
    }
    var s = String(v).trim().replace(/[./]/g, '-');
    var m = s.match(/^(\d{4})-(\d{1,2})/);
    return m ? m[1] + '-' + pad2(Number(m[2])) : s.slice(0, 7);
  }

  function dayNumber(d) { // 자정 기준 일 수 (엑셀 날짜 차이 계산용)
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function windowMonths(settings) {
    var out = [];
    for (var i = 0; i < settings.months; i++) {
      var m = settings.startMonth + i;
      if (m > 12) break;
      out.push(m);
    }
    return out;
  }

  // ── 시트별 계산 컬럼 ──────────────────────────────────
  // S&OP: 채널 블록(KR Sales, B2B …)에서 월 헤더가 같은 값을 합산
  function sopLayout(sheet) {
    var headers = sheet.headers || [];
    var groups = sheet.groups || [];
    var channelStart = 14;
    groups.forEach(function (g) {
      if (str(g.label) === '채널 합계') channelStart = g.start + g.span;
    });
    var monthCols = {};   // 채널 합계 영역의 월 → 컬럼
    var channelCols = {}; // 월 → 채널 컬럼 목록
    headers.forEach(function (h, i) {
      var m = str(h).match(/^(\d{1,2})월$/);
      if (!m) return;
      var month = Number(m[1]);
      if (i < channelStart) {
        if (i >= 5) monthCols[month] = i;
      } else {
        (channelCols[month] = channelCols[month] || []).push(i);
      }
    });
    return { monthCols: monthCols, channelCols: channelCols, channelStart: channelStart };
  }

  function recalcSop(sheet, settings) {
    var lay = sopLayout(sheet);
    var months = windowMonths(settings);
    sheet.rows.forEach(function (row) {
      Object.keys(lay.monthCols).forEach(function (m) {
        var cols = lay.channelCols[m] || [];
        var s = 0;
        cols.forEach(function (c) { s += num(row[c]); });
        row[lay.monthCols[m]] = s;
      });
      var total = 0;
      months.forEach(function (m) { if (lay.monthCols[m] !== undefined) total += num(row[lay.monthCols[m]]); });
      row[4] = total;
    });
    return lay;
  }

  // 재고 현황 E열 = SUMIFS(재고 현황_RAW!H, 재고 현황_RAW!A, A)
  function recalcStock(stock, raw) {
    var byCode = {};
    (raw.rows || []).forEach(function (r) {
      var k = str(r[0]);
      if (k) byCode[k] = (byCode[k] || 0) + num(r[7]);
    });
    stock.rows.forEach(function (row) { row[4] = byCode[str(row[0])] || 0; });
  }

  // ── Master_리덴스 계산 ─────────────────────────────────
  function buildIndex(rows, keyCol) {
    var idx = {};
    rows.forEach(function (r) {
      var k = str(r[keyCol]);
      if (!k) return;
      (idx[k] = idx[k] || []).push(r);
    });
    return idx;
  }

  function codesFor(item) {
    var codes = [str(item.erp)];
    var semi = str(item.semi);
    // 엑셀은 ERP코드·반제품코드 두 번 SUMIFS 합니다. 두 코드가 같으면 중복 합산을 막습니다.
    if (semi && semi !== '-' && semi !== codes[0]) codes.push(semi);
    return codes;
  }

  function computeMaster(state) {
    var settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    var sheets = state.sheets;
    var months = windowMonths(settings);
    var lay = recalcSop(sheets.sop, settings);
    recalcStock(sheets.stock, sheets.raw);

    var today = settings.baseDate ? new Date(settings.baseDate + 'T00:00:00') : new Date();
    var todayN = dayNumber(today);

    var stockIdx = buildIndex(sheets.stock.rows, 1);       // ERP 코드 조정
    var transitIdx = buildIndex(sheets.transit.rows, 7);   // 품번
    var sopByCode = buildIndex(sheets.sop.rows, 1);        // ERP 코드 조정
    var sopByName = buildIndex(sheets.sop.rows, 2);        // 상품명
    var salesIdx = buildIndex(sheets.sales.rows, 1);       // ERP 코드 조정
    var salesMonthCols = [];
    (sheets.sales.headers || []).forEach(function (h, i) { if (/^\d{1,2}월$/.test(str(h))) salesMonthCols.push(i); });
    var avgCols = salesMonthCols.slice(-Math.max(1, settings.salesAvgMonths));

    var windowStartYm = settings.year + '-' + pad2(months[0] || 1);

    return state.items.map(function (item, i) {
      var codes = codesFor(item);
      var r = { item: item, index: i, months: months };

      // E 현재고
      var stockRows = stockIdx[str(item.erp)] || [];
      r.stockLookup = stockRows.reduce(function (s, row) { return s + num(row[4]); }, 0);
      r.stockOverridden = item.stockOverride !== null && item.stockOverride !== undefined && item.stockOverride !== '';
      r.stock = r.stockOverridden ? num(item.stockOverride) : r.stockLookup;
      r.stockRows = stockRows;

      // F 미입고 · J~M 월별 입고예정
      r.poLines = [];
      codes.forEach(function (c) { r.poLines = r.poLines.concat(transitIdx[c] || []); });
      r.transitLookup = r.poLines.reduce(function (s, row) { return s + num(row[14]); }, 0);
      r.transitOverridden = item.transitOverride !== null && item.transitOverride !== undefined && item.transitOverride !== '';
      r.transit = r.transitOverridden ? num(item.transitOverride) : r.transitLookup;
      r.inbound = months.map(function (m) {
        var ym = settings.year + '-' + pad2(m);
        return r.poLines.reduce(function (s, row) { return s + (yearMonth(row[17]) === ym ? num(row[14]) : 0); }, 0);
      });
      // 검토 기간 이전 납기인데 아직 남은 잔량 (월별 입고예정에 잡히지 않음)
      r.overdue = r.poLines.filter(function (row) {
        var ym = yearMonth(row[17]);
        return ym && ym < windowStartYm && num(row[14]) > 0;
      });

      // G 가용재고
      r.available = r.stock + r.transit;

      // N~Q 월별 S&OP
      var sopRows = item.sopMatch === 'name' ? (sopByName[str(item.name)] || []) : (sopByCode[str(item.erp)] || []);
      r.sopRows = sopRows;
      r.demand = months.map(function (m) {
        var c = lay.monthCols[m];
        return c === undefined ? 0 : sopRows.reduce(function (s, row) { return s + num(row[c]); }, 0);
      });
      r.demandTotal = r.demand.reduce(function (a, b) { return a + b; }, 0); // H

      // R~U 월말 잔여
      var bal = r.stock;
      r.balance = months.map(function (m, k) { bal = bal + r.inbound[k] - r.demand[k]; return bal; });

      // V 안전재고 (일평균 판매 × LT)
      var salesRows = salesIdx[str(item.erp)] || [];
      r.salesRows = salesRows;
      var salesSum = 0;
      avgCols.forEach(function (c) { salesRows.forEach(function (row) { salesSum += num(row[c]); }); });
      r.dailyAvg = avgCols.length ? salesSum / avgCols.length / 30 : 0;
      r.lt = num(item.lt);
      r.safety = Math.round(r.dailyAvg * r.lt);

      // W 품절 예상월
      r.stockoutIndex = -1;
      for (var k = 0; k < r.balance.length; k++) { if (r.balance[k] <= 0) { r.stockoutIndex = k; break; } }
      r.stockoutMonth = r.stockoutIndex >= 0 ? months[r.stockoutIndex] : null;

      // X 발주 여부 · Y 발주 기한 · Z 권장발주량
      r.review = '';
      r.deadline = '';
      r.deadlineDate = null;
      r.recommended = null;
      if (r.stockoutMonth) {
        var first = dayNumber(new Date(settings.year, r.stockoutMonth - 1, 1));
        if (first - todayN <= r.lt) r.review = '발주 검토';
        var orderBy = first - 1 - r.lt;
        r.deadlineDate = new Date(orderBy * 86400000);
        if (orderBy <= todayN) r.deadline = '즉시 발주';
        else r.deadline = (r.deadlineDate.getUTCMonth() + 1) + '월 발주';
        var minBal = Math.min.apply(null, r.balance);
        var shortage = -Math.min(0, minBal);
        r.recommended = Math.max(settings.moq, Math.ceil(shortage / settings.roundUnit) * settings.roundUnit);
      }
      r.status = r.deadline === '즉시 발주' ? 'urgent' : r.review ? 'review' : r.stockoutMonth ? 'watch' : 'ok';
      return r;
    });
  }

  function emptySheet(def) {
    return { name: def.name, meta: '', headers: [], groups: [], rows: [] };
  }

  function emptyState() {
    var sheets = {};
    SHEETS.forEach(function (d) { sheets[d.key] = emptySheet(d); });
    return { version: 1, settings: Object.assign({}, DEFAULT_SETTINGS), items: [], sheets: sheets, updatedAt: null };
  }

  var api = {
    SHEETS: SHEETS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    num: num,
    str: str,
    yearMonth: yearMonth,
    windowMonths: windowMonths,
    sopLayout: sopLayout,
    computeMaster: computeMaster,
    emptyState: emptyState
  };

  root.SOPEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
