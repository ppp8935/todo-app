/* 리덴스 S&OP 대시보드 — 화면 구성과 저장 */
(function () {
  'use strict';

  var E = window.SOPEngine, I = window.SOPImporter, Grid = window.SOPGrid, esc = Grid.esc;
  var STORE_KEY = 'sop-dashboard-v1';
  var PREF_KEY = 'sop-dashboard-prefs';

  var state = load();
  var prefs = loadPrefs();
  var results = [];
  var currentGrid = null;

  var TABS = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'items', label: '품목 설정' },
    { key: 'sop', label: 'S&OP' },
    { key: 'stock', label: '재고 현황' },
    { key: 'sales', label: '판매 실적 현황' },
    { key: 'transit', label: '미입고 현황' },
    { key: 'raw', label: '재고 현황_RAW' },
    { key: 'semi', label: '반제품코드' }
  ];

  // ── 저장 ─────────────────────────────────────────────
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.sheets && s.items) {
        var base = E.emptyState();
        s.settings = Object.assign({}, base.settings, s.settings);
        E.SHEETS.forEach(function (d) { if (!s.sheets[d.key]) s.sheets[d.key] = base.sheets[d.key]; });
        return s;
      }
    } catch (e) { /* 저장소 사용 불가 */ }
    return E.emptyState();
  }

  function loadPrefs() {
    try { return Object.assign({ tab: 'dashboard', hideDiscontinued: false, status: 'all' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch (e) { return { tab: 'dashboard', hideDiscontinued: false, status: 'all' }; }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 무시 */ }
  }

  var saveTimer = null;
  function persist() {
    state.updatedAt = new Date().toISOString();
    setSaveState('저장 중…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }

  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      setSaveState('저장됨 ' + timeLabel(new Date()));
    } catch (e) {
      setSaveState('브라우저 저장 실패 — 설정에서 백업 파일로 저장하세요', true);
    }
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  function setSaveState(text, error) {
    var el = document.getElementById('saveState');
    el.textContent = text;
    el.classList.toggle('error', !!error);
  }

  function timeLabel(d) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function markEdited(key) {
    if (state.sheets[key]) state.sheets[key].editedAt = new Date().toISOString();
  }

  // ── 공통 ─────────────────────────────────────────────
  function n0(v) {
    if (v === null || v === undefined || v === '') return '';
    return Math.round(v).toLocaleString('ko-KR');
  }
  function signed(v) {
    var s = n0(Math.abs(v));
    return v < 0 ? '−' + s : s;
  }
  function hasData() { return state.items.length > 0 || state.sheets.sop.rows.length > 0; }
  function isDiscontinued(item) { return /단종/.test(item.note || '') || /단종/.test(item.note2 || ''); }
  function todayStr() {
    var d = state.settings.baseDate ? new Date(state.settings.baseDate + 'T00:00:00') : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + timeLabel(d);
  }

  function recompute() { results = E.computeMaster(state); }

  function updateHeader() {
    var months = E.windowMonths(state.settings);
    var sub = document.getElementById('headerSub');
    if (!hasData()) { sub.textContent = '엑셀 파일을 불러오면 대시보드가 생성됩니다'; return; }
    sub.textContent = '기준일 ' + todayStr() + ' · 검토 기간 ' + state.settings.year + '년 ' +
      months[0] + '~' + months[months.length - 1] + '월 · 품목 ' + state.items.length + '개';
  }

  // ── 탭 ───────────────────────────────────────────────
  function renderTabs() {
    var nav = document.getElementById('tabs');
    nav.innerHTML = TABS.map(function (t, i) {
      var group = i === 1 ? '<span class="tab-sep" aria-hidden="true"></span>' : '';
      return group + '<button type="button" class="tab' + (prefs.tab === t.key ? ' active' : '') +
        '" data-tab="' + t.key + '"' + (prefs.tab === t.key ? ' aria-current="page"' : '') + '>' + esc(t.label) + '</button>';
    }).join('');
  }

  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    prefs.tab = b.dataset.tab;
    savePrefs();
    render();
  });

  function render() {
    renderTabs();
    recompute();
    updateHeader();
    var view = document.getElementById('view');
    currentGrid = null;
    if (!hasData() && prefs.tab === 'dashboard') { view.innerHTML = emptyHtml(); return; }
    if (prefs.tab === 'dashboard') renderDashboard(view);
    else if (prefs.tab === 'items') renderItems(view);
    else renderSheet(view, prefs.tab);
  }

  function emptyHtml() {
    return '<section class="empty">' +
      '<h2>S&amp;OP 엑셀 파일을 불러오세요</h2>' +
      '<p class="muted">원본 엑셀(S&amp;OP 관리 파일)을 한 번 불러오면 Master_리덴스 품목과 S&amp;OP · 재고 · 판매 · 미입고 · 반제품코드 시트가 웹으로 옮겨집니다.<br>이후에는 각 탭에서 직접 수정하거나, 시트별로 엑셀에서 다시 불러오거나 붙여넣어 갱신할 수 있습니다.</p>' +
      '<button class="btn btn-primary" type="button" data-open-import>엑셀 불러오기</button>' +
      '<p class="muted small">데이터는 서버로 전송되지 않고 이 브라우저에만 저장됩니다.</p>' +
      '</section>';
  }

  // ── 대시보드 ─────────────────────────────────────────
  var STATUS = {
    urgent: { label: '즉시 발주', icon: '!', cls: 'st-critical' },
    review: { label: '발주 검토', icon: '▲', cls: 'st-warning' },
    watch:  { label: '품절 예상', icon: '●', cls: 'st-serious' },
    ok:     { label: '정상', icon: '✓', cls: 'st-good' }
  };

  function filteredResults() {
    var q = (prefs.query || '').trim().toLowerCase();
    return results.filter(function (r) {
      if (prefs.hideDiscontinued && isDiscontinued(r.item)) return false;
      if (prefs.status !== 'all' && r.status !== prefs.status) return false;
      if (!q) return true;
      var it = r.item;
      return [it.erp, it.semi, it.name, it.note, it.note2].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderDashboard(view) {
    var scope = results.filter(function (r) { return !(prefs.hideDiscontinued && isDiscontinued(r.item)); });
    var count = function (st) { return scope.filter(function (r) { return r.status === st; }).length; };
    var stockout = scope.filter(function (r) { return r.stockoutMonth; }).length;
    var sum = function (k) { return scope.reduce(function (s, r) { return s + r[k]; }, 0); };
    var months = E.windowMonths(state.settings);
    var discCount = results.filter(function (r) { return isDiscontinued(r.item); }).length;

    var h = '<section class="kpis">' +
      kpi('즉시 발주', count('urgent'), '품목', 'st-critical', '발주 기한이 이미 지났거나 오늘인 품목') +
      kpi('발주 검토', count('review'), '품목', 'st-warning', 'LT 안에 품절 예상 · 발주 기한은 남음') +
      kpi('품절 예상', stockout, '품목', '', months[0] + '~' + months[months.length - 1] + '월 중 월말잔여 ≤ 0') +
      kpi('현재고 합계', n0(sum('stock')), 'EA', '', '재고 현황 기준') +
      kpi('미입고 합계', n0(sum('transit')), 'EA', '', '미입고 현황 발주잔량') +
      '</section>';

    // 조치 필요 목록
    var action = scope.filter(function (r) { return r.status === 'urgent' || r.status === 'review'; })
      .sort(function (a, b) { return a.stockoutIndex - b.stockoutIndex || a.balance[a.stockoutIndex] - b.balance[b.stockoutIndex]; });
    h += '<section class="panel"><div class="panel-head"><h2>조치 필요 품목</h2><span class="muted">' + action.length + '개 · 품절 예상월 빠른 순</span></div>';
    if (action.length) {
      h += '<ul class="action-list">' + action.map(function (r) {
        var st = STATUS[r.status];
        return '<li><button type="button" class="action-item" data-detail="' + r.index + '">' +
          '<span class="chip ' + st.cls + '"><span aria-hidden="true">' + st.icon + '</span>' + esc(r.deadline || st.label) + '</span>' +
          '<span class="ai-name">' + esc(r.item.name) + '<span class="ai-code">' + esc(r.item.erp) + '</span></span>' +
          '<span class="ai-meta"><span>품절 예상 <b>' + r.stockoutMonth + '월</b></span>' +
          '<span>최저 잔여 <b class="' + (Math.min.apply(null, r.balance) < 0 ? 'neg' : '') + '">' + signed(Math.min.apply(null, r.balance)) + '</b></span>' +
          '<span>권장 <b>' + n0(r.recommended) + '</b></span></span>' +
          '</button></li>';
      }).join('') + '</ul>';
    } else {
      h += '<p class="muted pad">현재 조치가 필요한 품목이 없습니다.</p>';
    }
    h += '</section>';

    // 필터 + Master 표
    var statuses = [['all', '전체'], ['urgent', '즉시 발주'], ['review', '발주 검토'], ['watch', '품절 예상(여유)'], ['ok', '정상']];
    h += '<section class="panel"><div class="panel-head"><h2>Master_리덴스</h2>' +
      '<span class="muted">LT · 발주 조정 · 비고는 표에서 바로 수정할 수 있습니다</span></div>' +
      '<div class="filters">' +
      '<input type="search" id="dashSearch" placeholder="코드·상품명·비고 검색" value="' + esc(prefs.query || '') + '" />' +
      '<div class="seg" role="group" aria-label="상태 필터">' + statuses.map(function (s) {
        return '<button type="button" data-status="' + s[0] + '" class="' + (prefs.status === s[0] ? 'on' : '') + '" aria-pressed="' + (prefs.status === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="check"><input type="checkbox" id="hideDisc"' + (prefs.hideDiscontinued ? ' checked' : '') + ' /> 단종 품목 숨기기 (' + discCount + ')</label>' +
      '</div>' +
      '<div class="table-wrap" id="masterWrap">' + masterTable(months) + '</div></section>';

    view.innerHTML = h;
  }

  function kpi(label, value, unit, cls, hint) {
    return '<div class="kpi ' + cls + '" title="' + esc(hint) + '"><span class="kpi-label">' +
      (cls ? '<span class="dot" aria-hidden="true"></span>' : '') + esc(label) + '</span>' +
      '<span class="kpi-value">' + value + '<small>' + unit + '</small></span><span class="kpi-hint">' + esc(hint) + '</span></div>';
  }

  function masterTable(months) {
    var rows = filteredResults();
    var mN = months.length;
    var h = '<table class="master"><thead><tr class="grp">' +
      '<th colspan="2" class="sticky-l">기본 정보</th><th colspan="5">재고 현황</th>' +
      '<th colspan="' + mN + '">입고예정</th><th colspan="' + mN + '">S&amp;OP</th><th colspan="' + mN + '">월말 잔여</th>' +
      '<th>안전재고</th><th colspan="5">검토</th><th>비고</th></tr><tr>' +
      '<th class="sticky-l">ERP코드<br><span class="sub">반제품</span></th><th class="sticky-l2">상품명</th>' +
      '<th class="num">현재고</th><th class="num">미입고</th><th class="num">가용재고</th><th class="num">S&amp;OP 합계</th><th class="num">LT(일)</th>' +
      months.map(function (m) { return '<th class="num">' + m + '월</th>'; }).join('') +
      months.map(function (m) { return '<th class="num">' + m + '월</th>'; }).join('') +
      months.map(function (m) { return '<th class="num">' + m + '월</th>'; }).join('') +
      '<th class="num" title="최근 ' + state.settings.salesAvgMonths + '개월 판매 평균 ÷ 30 × LT">일평균×LT</th>' +
      '<th>품절 예상월</th><th>발주 여부</th><th>발주 기한</th><th class="num">권장발주량</th><th class="num">발주 조정</th>' +
      '<th>비고</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var it = r.item;
      var disc = isDiscontinued(it);
      h += '<tr data-i="' + r.index + '" class="' + (disc ? 'disc' : '') + '">' +
        '<td class="sticky-l code">' + esc(it.erp) + (it.semi && it.semi !== '-' && it.semi !== it.erp ? '<span class="sub">' + esc(it.semi) + '</span>' : '') + '</td>' +
        '<td class="sticky-l2 name"><button type="button" class="link" data-detail="' + r.index + '">' + esc(it.name) + '</button></td>' +
        numCell(r.stock, r.stockOverridden ? '수기 입력값 (조회값 ' + n0(r.stockLookup) + ')' : '') +
        numCell(r.transit, r.transitOverridden ? '수기 입력값 (조회값 ' + n0(r.transitLookup) + ')' : '') +
        numCell(r.available) + numCell(r.demandTotal) +
        '<td class="num edit"><input type="number" min="0" data-field="lt" value="' + esc(it.lt) + '" aria-label="LT" /></td>' +
        r.inbound.map(function (v) { return numCell(v, '', v ? 'in' : 'zero'); }).join('') +
        r.demand.map(function (v) { return numCell(v, '', v ? '' : 'zero'); }).join('') +
        r.balance.map(function (v) { return '<td class="num bal ' + (v <= 0 ? 'bal-neg' : '') + '">' + signed(v) + '</td>'; }).join('') +
        numCell(r.safety, '', r.safety ? '' : 'zero') +
        '<td class="ctr">' + (r.stockoutMonth ? '<b>' + r.stockoutMonth + '월</b>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="ctr">' + (r.review ? '<span class="chip st-warning"><span aria-hidden="true">▲</span>' + esc(r.review) + '</span>' : '') + '</td>' +
        '<td class="ctr">' + (r.deadline ? '<span class="chip ' + (r.deadline === '즉시 발주' ? 'st-critical' : 'st-neutral') + '">' +
          (r.deadline === '즉시 발주' ? '<span aria-hidden="true">!</span>' : '') + esc(r.deadline) + '</span>' : '') + '</td>' +
        numCell(r.recommended) +
        '<td class="num edit"><input type="text" inputmode="numeric" data-field="adjust" value="' + esc(it.adjust) + '" aria-label="발주 조정" /></td>' +
        '<td class="edit note"><input type="text" data-field="note" value="' + esc(it.note) + '" aria-label="비고" /></td>' +
        '</tr>';
    });
    if (!rows.length) h += '<tr><td colspan="' + (12 + mN * 3 + 2) + '" class="muted pad">조건에 맞는 품목이 없습니다.</td></tr>';
    h += '</tbody></table>';
    return h;
  }

  function numCell(v, title, cls) {
    var neg = typeof v === 'number' && v < 0;
    return '<td class="num ' + (cls || '') + (neg ? ' neg' : '') + (title ? ' overridden' : '') + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '>' + (v === null ? '' : signed(v)) + '</td>';
  }

  // 대시보드 이벤트
  var view = document.getElementById('view');
  view.addEventListener('input', function (e) {
    if (e.target.id === 'dashSearch') {
      prefs.query = e.target.value;
      savePrefs();
      document.getElementById('masterWrap').innerHTML = masterTable(E.windowMonths(state.settings));
    }
  });
  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'hideDisc') { prefs.hideDiscontinued = t.checked; savePrefs(); render(); return; }
    if (t.dataset.field) {
      var i = Number(t.closest('tr').dataset.i);
      var it = state.items[i];
      if (t.dataset.field === 'lt') it.lt = E.num(t.value);
      else if (t.dataset.field === 'adjust') it.adjust = Grid.parseInput(t.value, { type: 'number' }) ?? '';
      else it[t.dataset.field] = t.value;
      persist();
      var y = window.scrollY, wrap = document.getElementById('masterWrap'), sx = wrap.scrollLeft;
      render();
      window.scrollTo(0, y);
      document.getElementById('masterWrap').scrollLeft = sx;
    }
  });
  view.addEventListener('click', function (e) {
    var s = e.target.closest('[data-status]');
    if (s) { prefs.status = s.dataset.status; savePrefs(); render(); return; }
    var d = e.target.closest('[data-detail]');
    if (d) { openDetail(Number(d.dataset.detail)); return; }
    if (e.target.closest('[data-open-import]')) { openImport(); return; }
    var act = e.target.closest('[data-act]');
    if (act) sheetAction(act.dataset.act);
  });

  // ── 상세 패널 ───────────────────────────────────────
  function openDetail(i) {
    var r = results[i];
    if (!r) return;
    var it = r.item, months = r.months;
    document.getElementById('drawerCode').textContent = it.erp + (it.semi && it.semi !== '-' ? ' · 반제품 ' + it.semi : '') + (it.note ? ' · ' + it.note : '');
    document.getElementById('drawerTitle').textContent = it.name;
    var st = STATUS[r.status];
    var h = '<div class="d-status"><span class="chip ' + st.cls + '"><span aria-hidden="true">' + st.icon + '</span>' + esc(r.deadline || st.label) + '</span>' +
      (r.stockoutMonth ? '<span>품절 예상 <b>' + r.stockoutMonth + '월</b> · 권장발주량 <b>' + n0(r.recommended) + '</b>' +
        (r.deadlineDate && r.deadline !== '즉시 발주' ? ' · 발주 기한 ' + r.deadlineDate.toISOString().slice(0, 10) : '') + '</span>' : '<span class="muted">검토 기간 내 품절 예상 없음</span>') + '</div>';
    h += '<div class="d-kpis">' +
      mini('현재고', r.stock, r.stockOverridden ? '수기값' : '') + mini('미입고', r.transit, r.transitOverridden ? '수기값' : '') +
      mini('가용재고', r.available) + mini('S&OP 합계', r.demandTotal) + mini('LT', r.lt, '일') + mini('안전재고', r.safety) + '</div>';

    if (r.stockOverridden || r.transitOverridden) {
      h += '<p class="note-box">이 품목은 엑셀에서 현재고/미입고가 수식 대신 값으로 입력되어 있어 수기값을 사용합니다' +
        ' (조회값: 현재고 ' + n0(r.stockLookup) + ', 미입고 ' + n0(r.transitLookup) + '). <b>품목 설정</b> 탭에서 수기값을 비우면 자동 계산으로 바뀝니다.</p>';
    }
    if (r.overdue.length) {
      h += '<p class="note-box warn"><span aria-hidden="true">▲ </span>납기일이 검토 기간(' + months[0] + '월) 이전인데 잔량이 남은 발주 ' + r.overdue.length +
        '건(' + n0(r.overdue.reduce(function (s, x) { return s + E.num(x[14]); }, 0)) + ' EA)은 월별 입고예정에 포함되지 않습니다.</p>';
    }

    h += '<h3>월별 입고예정 vs S&amp;OP</h3>' + groupedBars(months, r.inbound, r.demand);
    h += '<h3>월말 잔여 재고</h3>' + balanceBars(months, r.balance);

    h += '<h3>미입고 발주 (' + r.poLines.length + '건)</h3>';
    h += r.poLines.length ? miniTable(['발주번호', '거래처', '품번', '발주수량', '잔량', '납기일자', '담당자'],
      r.poLines.map(function (p) { return [p[2], p[5], p[7], { n: p[13] }, { n: p[14] }, p[17], p[18]]; })) : '<p class="muted">없음</p>';

    var rawRows = [];
    var stockCodes = r.stockRows.map(function (s) { return E.str(s[0]); });
    state.sheets.raw.rows.forEach(function (x) { if (stockCodes.indexOf(E.str(x[0])) >= 0) rawRows.push(x); });
    h += '<h3>재고 구성 (재고 현황 ' + r.stockRows.length + '행 · RAW ' + rawRows.length + '행)</h3>';
    h += r.stockRows.length ? miniTable(['ERP코드', '상품명', '가용재고'], r.stockRows.map(function (s) { return [s[0], s[2], { n: s[4] }]; })) : '<p class="muted">재고 현황에 연결된 행이 없습니다 (ERP 코드 조정 = ' + esc(it.erp) + ').</p>';
    if (rawRows.length) {
      h += miniTable(['ERP코드', '물류센터', '창고', '유통기한', '가용재고'], rawRows.map(function (x) { return [x[0], x[4], x[5], x[6], { n: x[7] }]; }));
    }

    if (r.salesRows.length) {
      var sh = state.sheets.sales.headers, mcols = [];
      sh.forEach(function (hd, k) { if (/^\d{1,2}월$/.test(E.str(hd))) mcols.push(k); });
      h += '<h3>판매 실적</h3>' + miniTable(['ERP코드'].concat(mcols.map(function (k) { return sh[k]; })),
        r.salesRows.map(function (s) { return [s[0]].concat(mcols.map(function (k) { return { n: s[k] }; })); }));
    }

    document.getElementById('drawerBody').innerHTML = h;
    var dr = document.getElementById('drawer');
    dr.classList.add('open');
    dr.setAttribute('aria-hidden', 'false');
    dr.querySelector('.btn[data-close]').focus();
  }

  function mini(label, v, unit) {
    return '<div class="mini"><span>' + esc(label) + '</span><b class="' + (v < 0 ? 'neg' : '') + '">' + signed(v) +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</b></div>';
  }

  function miniTable(head, rows) {
    return '<div class="table-wrap"><table class="mini-table"><thead><tr>' + head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c) {
          return c && typeof c === 'object' ? '<td class="num">' + n0(E.num(c.n)) + '</td>' : '<td>' + esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ── 차트 (SVG) ──────────────────────────────────────
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }
  function shortNum(v) {
    var a = Math.abs(v);
    if (a >= 10000) return (v / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function barPath(x, y0, w, y1, r) {
    // y0 = 기준선, y1 = 끝점 (위 또는 아래). 끝쪽 모서리만 둥글게
    var up = y1 < y0, h = Math.abs(y1 - y0);
    r = Math.min(r, h, w / 2);
    if (h < 0.5) return '';
    if (up) {
      return 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) +
        'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z';
    }
    return 'M' + x + ',' + y0 + 'V' + (y1 - r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) +
      'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - r) + 'V' + y0 + 'Z';
  }

  function axis(W, padL, padR, ticks, scale) {
    return ticks.map(function (t) {
      var y = scale(t);
      return '<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="tick" x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + shortNum(t) + '</text>';
    }).join('');
  }

  function groupedBars(months, a, b) {
    var W = 560, H = 210, padL = 48, padR = 8, padT = 12, padB = 26;
    var max = niceMax(Math.max.apply(null, a.concat(b)));
    var sy = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
    var ticks = [0, max / 2, max];
    var band = (W - padL - padR) / months.length, bw = Math.min(28, band / 3.2), gap = 2;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="월별 입고예정과 S&OP 수요 비교">' + axis(W, padL, padR, ticks, sy);
    months.forEach(function (m, i) {
      var cx = padL + band * i + band / 2;
      var x1 = cx - bw - gap / 2, x2 = cx + gap / 2;
      s += '<path class="bar s1" d="' + barPath(x1, sy(0), bw, sy(a[i]), 4) + '"/>';
      s += '<path class="bar s2" d="' + barPath(x2, sy(0), bw, sy(b[i]), 4) + '"/>';
      s += '<rect class="hit" x="' + (cx - band / 2) + '" y="' + padT + '" width="' + band + '" height="' + (H - padT - padB) + '" data-tip="' +
        esc(m + '월|입고예정|' + n0(a[i]) + '|S&OP|' + n0(b[i])) + '"/>';
      s += '<text class="tick" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + m + '월</text>';
    });
    s += '<line class="baseline" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/></svg>';
    var legend = '<div class="legend"><span><i class="sw s1"></i>입고예정</span><span><i class="sw s2"></i>S&amp;OP 수요</span></div>';
    return legend + s;
  }

  function balanceBars(months, bal) {
    var W = 560, H = 210, padL = 48, padR = 8, padT = 18, padB = 34;
    var hi = Math.max(0, Math.max.apply(null, bal)), lo = Math.min(0, Math.min.apply(null, bal));
    var span = niceMax(Math.max(hi - lo, 1));
    var top = hi > 0 ? niceMax(hi) : 0, bottom = lo < 0 ? -niceMax(-lo) : 0;
    if (top === 0 && bottom === 0) top = span;
    var sy = function (v) { return padT + (H - padT - padB) * (top - v) / (top - bottom); };
    var ticks = [bottom, 0, top].filter(function (v, k, arr) { return arr.indexOf(v) === k; });
    var band = (W - padL - padR) / months.length, bw = Math.min(40, band / 2.2);
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="월말 잔여 재고">' + axis(W, padL, padR, ticks, sy);
    months.forEach(function (m, i) {
      var cx = padL + band * i + band / 2, v = bal[i];
      s += '<path class="bar ' + (v <= 0 ? 'bneg' : 's1') + '" d="' + barPath(cx - bw / 2, sy(0), bw, sy(v), 4) + '"/>';
      var ly = v >= 0 ? sy(v) - 5 : sy(v) + 13;
      s += '<text class="val' + (v <= 0 ? ' val-neg' : '') + '" x="' + cx + '" y="' + ly + '" text-anchor="middle">' + signed(v) + '</text>';
      s += '<rect class="hit" x="' + (cx - band / 2) + '" y="' + padT + '" width="' + band + '" height="' + (H - padT - padB) + '" data-tip="' +
        esc(m + '월|월말 잔여|' + signed(v)) + '"/>';
      s += '<text class="tick" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + m + '월</text>';
    });
    s += '<line class="baseline" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/></svg>';
    return s;
  }

  // 툴팁
  var tip = document.getElementById('tooltip');
  document.addEventListener('mousemove', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    var parts = t.dataset.tip.split('|');
    var h = '<b>' + esc(parts[0]) + '</b>';
    for (var k = 1; k < parts.length; k += 2) h += '<div><span>' + esc(parts[k]) + '</span><b>' + esc(parts[k + 1]) + '</b></div>';
    tip.innerHTML = h;
    tip.hidden = false;
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  });

  function closeDrawer() {
    var dr = document.getElementById('drawer');
    dr.classList.remove('open');
    dr.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('drawer').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('drawer').classList.contains('open')) closeDrawer();
  });

  // ── 품목 설정 ───────────────────────────────────────
  var ITEM_COLS = [
    { label: 'ERP코드', key: 'erp', width: 96 },
    { label: '반제품코드', key: 'semi', width: 96 },
    { label: '상품명', key: 'name', width: 320 },
    { label: '품목군', key: 'group', width: 80 },
    { label: 'LT(일)', key: 'lt', type: 'number', width: 76 },
    { label: '현재고 수기값', key: 'stockOverride', type: 'number', width: 110 },
    { label: '미입고 수기값', key: 'transitOverride', type: 'number', width: 110 },
    { label: 'S&OP 매칭', key: 'sopMatch', type: 'select', width: 110,
      options: [{ value: 'code', label: 'ERP코드' }, { value: 'name', label: '상품명' }] },
    { label: '발주 조정', key: 'adjust', type: 'number', width: 96 },
    { label: '비고', key: 'note', width: 120 },
    { label: '비고2', key: 'note2', width: 140 }
  ];

  function newItem() {
    return { erp: '', semi: '-', name: '', group: '리덴스', lt: 80, stockOverride: null, transitOverride: null, sopMatch: 'code', adjust: '', note: '', note2: '' };
  }

  function renderItems(view) {
    view.innerHTML = sheetShell({
      title: '품목 설정 (Master_리덴스 품목 목록)',
      desc: '대시보드에 표시할 품목과 LT를 관리합니다. <b>현재고/미입고 수기값</b>을 입력하면 시트 조회값 대신 그 값을 씁니다(비우면 자동 계산). ' +
        '<b>S&amp;OP 매칭</b>은 S&amp;OP 시트에서 ERP 코드 조정 열로 찾을지, 상품명으로 찾을지 정합니다.',
      count: state.items.length,
      actions: ['add', 'paste'],
      sheetKey: 'items'
    });
    currentGrid = new Grid(document.getElementById('gridHost'), {
      columns: ITEM_COLS,
      rows: function () { return state.items; },
      stickyCols: 1,
      filter: searchFilter(function (it) { return [it.erp, it.semi, it.name, it.note].join(' '); }),
      newRow: newItem,
      onChange: function () { persist(); },
      onDelete: function (ri) {
        if (!confirm('"' + (state.items[ri].name || state.items[ri].erp) + '" 품목을 삭제할까요?')) return;
        state.items.splice(ri, 1); persist(); currentGrid.render(); updateCount(state.items.length);
      }
    });
    currentGrid.render();
  }

  // ── 원본 시트 ───────────────────────────────────────
  var NAME_HEADERS = /상품명|품명|모품명|자품명/;

  function sheetColumns(key) {
    var sheet = state.sheets[key];
    var def = E.SHEETS.filter(function (d) { return d.key === key; })[0];
    return sheet.headers.map(function (hd, i) {
      var numeric = 0, filled = 0;
      for (var k = 0; k < sheet.rows.length && filled < 60; k++) {
        var v = sheet.rows[k][i];
        if (v === null || v === undefined || v === '') continue;
        filled++;
        if (typeof v === 'number') numeric++;
      }
      var isNum = filled > 0 && numeric / filled > 0.6 && !/코드|번호|No|순번/.test(hd);
      var ro = def.computed.indexOf(i) >= 0;
      var width = NAME_HEADERS.test(hd) ? 260 : isNum || ro ? 84 : /일자|기한|일$/.test(hd) ? 100 : 100;
      return { label: hd || '(빈 열)', type: isNum || ro ? 'number' : 'text', readOnly: ro, width: width };
    });
  }

  var SHEET_HELP = {
    sop: '채널별 월 수요 계획을 입력합니다. <b>총합계·채널 합계</b>(회색)는 채널 값을 더해 자동 계산됩니다. Master는 <b>ERP 코드 조정</b> 열 기준으로 합산합니다.',
    stock: 'ERP코드 ↔ 조정 코드 매핑표입니다. <b>가용재고</b>(회색)는 재고 현황_RAW에서 ERP코드별로 자동 합산되고, Master는 <b>ERP 코드 조정</b> 기준으로 다시 합산합니다.',
    sales: '월별 판매 실적입니다. 대시보드의 안전재고(최근 판매 평균 ÷ 30 × LT) 계산에 쓰입니다.',
    transit: '발주 잔량 목록입니다. Master는 <b>품번</b>이 ERP코드 또는 반제품코드와 같은 행의 <b>발주잔량</b>을 미입고로, <b>납기일자</b>의 연-월로 월별 입고예정을 계산합니다.',
    raw: '물류센터 재고 원본입니다. WMS에서 내려받은 표를 그대로 붙여넣으세요(‘붙여넣기로 갱신’ → 전체 교체).',
    semi: '제품 ↔ 반제품(자품번) BOM 참고표입니다.'
  };

  function renderSheet(view, key) {
    var sheet = state.sheets[key];
    view.innerHTML = sheetShell({
      title: sheet.name || key,
      desc: SHEET_HELP[key] || '',
      count: sheet.rows.length,
      actions: ['add', 'paste', 'import'],
      sheetKey: key,
      meta: sheet.meta,
      editedAt: sheet.editedAt
    });
    if (!sheet.headers.length) {
      document.getElementById('gridHost').innerHTML = '<p class="grid-empty">아직 데이터가 없습니다. ‘엑셀에서 불러오기’로 이 시트를 가져오세요.</p>';
      return;
    }
    var cols = sheetColumns(key);
    currentGrid = new Grid(document.getElementById('gridHost'), {
      columns: cols,
      groups: sheet.groups,
      rows: function () { return state.sheets[key].rows; },
      stickyCols: key === 'sop' || key === 'stock' || key === 'sales' ? Math.min(3, cols.length) : 1,
      filter: searchFilter(function (row) { return row.join(' '); }),
      onChange: function (ri) {
        markEdited(key);
        persist();
        recompute(); // 계산 열(S&OP 합계, 재고 가용재고) 갱신
        if (ri >= 0) currentGrid.refreshRow(ri);
        else currentGrid.render();
        updateCount(state.sheets[key].rows.length);
      },
      onDelete: function (ri) {
        state.sheets[key].rows.splice(ri, 1);
        markEdited(key); persist(); recompute(); currentGrid.render(); updateCount(state.sheets[key].rows.length);
      }
    });
    currentGrid.render();
  }

  function searchFilter(text) {
    var q = (prefs['q_' + prefs.tab] || '').trim().toLowerCase();
    if (!q) return null;
    return function (row) { return String(text(row)).toLowerCase().indexOf(q) >= 0; };
  }

  function sheetShell(o) {
    var acts = {
      add: '<button class="btn" type="button" data-act="add">+ 행 추가</button>',
      paste: '<button class="btn" type="button" data-act="paste">붙여넣기로 갱신</button>',
      import: '<button class="btn" type="button" data-act="import">엑셀에서 불러오기</button>'
    };
    var metaField = o.sheetKey !== 'items'
      ? '<label class="meta-field">업데이트 표기<input type="text" data-meta value="' + esc(o.meta || '') + '" placeholder="예: UPDATE : ' + todayStr() + '" /></label>'
      : '';
    return '<section class="panel sheet">' +
      '<div class="panel-head"><div><h2>' + esc(o.title) + '</h2><p class="muted desc">' + o.desc + '</p></div>' +
      '<div class="sheet-meta muted"><span id="rowCount">' + o.count.toLocaleString('ko-KR') + '행</span>' +
      (o.editedAt ? '<span>마지막 수정 ' + dateLabel(o.editedAt) + '</span>' : '') + '</div></div>' +
      '<div class="toolbar"><input type="search" data-sheet-search placeholder="검색" value="' + esc(prefs['q_' + prefs.tab] || '') + '" />' +
      o.actions.map(function (a) { return acts[a]; }).join('') + metaField + '</div>' +
      '<p class="muted small hint">셀을 클릭해 수정 · Enter 아래로 · Tab 오른쪽으로 · 엑셀에서 복사한 범위를 셀에 붙여넣으면 그 위치부터 채워집니다.</p>' +
      '<div class="table-wrap grid-wrap" id="gridHost"></div></section>';
  }

  function updateCount(n) {
    var el = document.getElementById('rowCount');
    if (el) el.textContent = n.toLocaleString('ko-KR') + '행';
  }

  var searchTimer = null;
  view.addEventListener('input', function (e) {
    if (e.target.matches('[data-sheet-search]')) {
      prefs['q_' + prefs.tab] = e.target.value;
      savePrefs();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (!currentGrid) return;
        currentGrid.o.filter = prefs.tab === 'items'
          ? searchFilter(function (it) { return [it.erp, it.semi, it.name, it.note].join(' '); })
          : searchFilter(function (row) { return row.join(' '); });
        currentGrid.render();
      }, 150);
    }
  });
  view.addEventListener('change', function (e) {
    if (e.target.matches('[data-meta]')) {
      state.sheets[prefs.tab].meta = e.target.value.trim();
      persist();
    }
  });

  function sheetAction(act) {
    var key = prefs.tab;
    if (act === 'add') {
      if (key === 'items') state.items.push(newItem());
      else state.sheets[key].rows.push(state.sheets[key].headers.map(function () { return null; }));
      if (key !== 'items') markEdited(key);
      persist();
      prefs['q_' + key] = '';
      render();
      var host = document.getElementById('gridHost');
      var rowsLen = key === 'items' ? state.items.length : state.sheets[key].rows.length;
      currentGrid.limit = Math.max(currentGrid.limit, rowsLen);
      currentGrid.render();
      var last = host.querySelector('tr[data-r="' + (rowsLen - 1) + '"] td[data-c]:not(.ro)');
      if (last) { last.scrollIntoView({ block: 'center' }); currentGrid.startEdit(last); }
    } else if (act === 'paste') {
      openPaste(key);
    } else if (act === 'import') {
      openImport(key);
    }
  }

  // ── 붙여넣기 갱신 ───────────────────────────────────
  var pasteKey = null;
  function pasteTargetCols(key) { return key === 'items' ? ITEM_COLS : sheetColumns(key); }

  function parsePasted(key) {
    var text = document.getElementById('pasteArea').value.replace(/\r/g, '').replace(/\n+$/, '');
    if (!text) return [];
    var cols = pasteTargetCols(key);
    var lines = text.split('\n').map(function (l) { return l.split('\t'); });
    var first = lines[0].map(function (x) { return x.trim(); });
    if (first[0] && first[0] === E.str(cols[0].label)) lines.shift(); // 헤더 줄 건너뛰기
    return lines.filter(function (l) { return l.some(function (x) { return x.trim() !== ''; }); }).map(function (l) {
      if (key === 'items') {
        var it = newItem();
        cols.forEach(function (c, i) { if (i < l.length) it[c.key] = Grid.parseInput(l[i], c); });
        if (it.sopMatch !== 'name') it.sopMatch = /상품명|name/i.test(String(it.sopMatch)) ? 'name' : 'code';
        return it;
      }
      return cols.map(function (c, i) { return i < l.length && !c.readOnly ? Grid.parseInput(l[i], c) : null; });
    });
  }

  function openPaste(key) {
    pasteKey = key;
    var name = key === 'items' ? '품목 설정' : state.sheets[key].name;
    document.getElementById('pasteTitle').textContent = name + ' — 붙여넣기로 갱신';
    document.getElementById('pasteArea').value = '';
    document.getElementById('pastePreview').textContent = '열 순서: ' + pasteTargetCols(key).map(function (c) { return c.label; }).join(' · ');
    document.getElementById('pasteDialog').showModal();
    document.getElementById('pasteArea').focus();
  }

  document.getElementById('pasteArea').addEventListener('input', function () {
    var rows = parsePasted(pasteKey);
    var cols = pasteTargetCols(pasteKey);
    document.getElementById('pastePreview').textContent = rows.length + '행 인식됨 · 열 순서: ' + cols.map(function (c) { return c.label; }).join(' · ');
  });

  document.getElementById('pasteConfirm').addEventListener('click', function () {
    var rows = parsePasted(pasteKey);
    if (!rows.length) { toast('붙여넣은 내용이 없습니다'); return; }
    var mode = document.querySelector('input[name="pasteMode"]:checked').value;
    if (pasteKey === 'items') {
      state.items = mode === 'replace' ? rows : state.items.concat(rows);
    } else {
      var sh = state.sheets[pasteKey];
      sh.rows = mode === 'replace' ? rows : sh.rows.concat(rows);
      markEdited(pasteKey);
    }
    persist();
    document.getElementById('pasteDialog').close();
    toast(rows.length + '행을 ' + (mode === 'replace' ? '교체' : '추가') + '했습니다');
    render();
  });

  // ── 엑셀 불러오기 / 내보내기 ────────────────────────
  var pendingWb = null, importFocus = null;

  function openImport(onlyKey) {
    importFocus = onlyKey || null;
    pendingWb = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('dzFile').textContent = '';
    document.getElementById('importSheets').innerHTML = '';
    document.getElementById('importConfirm').disabled = true;
    document.getElementById('importDialog').showModal();
  }

  function sheetLabel(d) { return d.key === 'items' ? '품목 목록 (Master_리덴스)' : d.name; }

  function handleFile(file) {
    if (!file) return;
    document.getElementById('dzFile').textContent = file.name + ' 읽는 중…';
    var reader = new FileReader();
    reader.onload = function () {
      try {
        pendingWb = I.readWorkbook(new Uint8Array(reader.result));
      } catch (err) {
        document.getElementById('dzFile').textContent = '파일을 읽을 수 없습니다: ' + err.message;
        return;
      }
      var found = I.detect(pendingWb);
      document.getElementById('dzFile').textContent = file.name;
      if (!found.length) {
        document.getElementById('importSheets').innerHTML = '<p class="note-box warn">인식할 수 있는 시트가 없습니다. 시트 이름이 S&amp;OP, 재고 현황, 판매 실적 현황, 미입고 현황, 재고 현황_RAW, 반제품코드, Master_리덴스 중 하나여야 합니다.</p>';
        return;
      }
      var hasItems = state.items.length > 0;
      document.getElementById('importSheets').innerHTML = '<p class="muted">반영할 시트를 선택하세요. 선택한 시트는 웹의 기존 데이터를 <b>덮어씁니다</b>.</p>' +
        found.map(function (d) {
          var checked = importFocus ? d.key === importFocus : !(d.key === 'items' && hasItems);
          var warn = d.key === 'items' && hasItems ? ' <span class="muted small">— 웹에서 수정한 LT·비고·발주 조정이 엑셀 값으로 바뀝니다</span>' : '';
          return '<label class="check"><input type="checkbox" value="' + d.key + '"' + (checked ? ' checked' : '') + ' /> ' + esc(sheetLabel(d)) + warn + '</label>';
        }).join('');
      document.getElementById('importConfirm').disabled = false;
    };
    reader.readAsArrayBuffer(file);
  }

  document.getElementById('fileInput').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
  var dz = document.getElementById('dropzone');
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); handleFile(e.dataTransfer.files[0]); });

  document.getElementById('importConfirm').addEventListener('click', function () {
    if (!pendingWb) return;
    var keys = Array.prototype.map.call(document.querySelectorAll('#importSheets input:checked'), function (x) { return x.value; });
    if (!keys.length) { toast('선택한 시트가 없습니다'); return; }
    I.applyWorkbook(state, pendingWb, keys);
    keys.forEach(function (k) { if (k !== 'items') markEdited(k); });
    persist();
    document.getElementById('importDialog').close();
    toast(keys.length + '개 시트를 반영했습니다');
    render();
  });

  document.getElementById('btnImport').addEventListener('click', function () { openImport(); });

  document.getElementById('btnExport').addEventListener('click', function () {
    if (!hasData()) { toast('내보낼 데이터가 없습니다'); return; }
    recompute();
    var wb = I.exportWorkbook(state, results);
    var data = window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'SOP_대시보드_' + todayStr() + '.xlsx');
  });

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ── 설정 ────────────────────────────────────────────
  var settingsForm = document.getElementById('settingsForm');
  document.getElementById('btnSettings').addEventListener('click', function () {
    Object.keys(E.DEFAULT_SETTINGS).forEach(function (k) {
      var inp = settingsForm.elements[k];
      if (inp) inp.value = state.settings[k] === undefined ? '' : state.settings[k];
    });
    document.getElementById('settingsDialog').showModal();
  });
  document.getElementById('settingsSave').addEventListener('click', function () {
    Object.keys(E.DEFAULT_SETTINGS).forEach(function (k) {
      var inp = settingsForm.elements[k];
      if (!inp) return;
      state.settings[k] = k === 'baseDate' ? inp.value : (inp.value === '' ? E.DEFAULT_SETTINGS[k] : Number(inp.value));
    });
    state.settings.startMonth = Math.min(12, Math.max(1, state.settings.startMonth));
    persist();
    document.getElementById('settingsDialog').close();
    render();
  });
  document.getElementById('btnBackup').addEventListener('click', function () {
    download(new Blob([JSON.stringify(state)], { type: 'application/json' }), 'sop-dashboard-backup-' + todayStr() + '.json');
  });
  document.getElementById('restoreInput').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var s = JSON.parse(t);
      if (!s || !s.sheets || !s.items) throw new Error('형식 오류');
      state = s;
      var base = E.emptyState();
      state.settings = Object.assign({}, base.settings, state.settings);
      E.SHEETS.forEach(function (d) { if (!state.sheets[d.key]) state.sheets[d.key] = base.sheets[d.key]; });
      persist();
      document.getElementById('settingsDialog').close();
      toast('백업을 복원했습니다');
      render();
    }).catch(function () { toast('백업 파일을 읽을 수 없습니다'); });
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    if (!confirm('이 브라우저에 저장된 모든 대시보드 데이터를 삭제할까요? (되돌릴 수 없습니다)')) return;
    state = E.emptyState();
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
    document.getElementById('settingsDialog').close();
    setSaveState('');
    render();
  });

  // 시작
  if (state.updatedAt) setSaveState('저장됨 ' + dateLabel(state.updatedAt));
  render();
})();
