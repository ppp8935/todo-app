/* 리덴스 S&OP 대시보드 — 화면 구성과 저장 */
(function () {
  'use strict';

  var E = window.SOPEngine, I = window.SOPImporter, Grid = window.SOPGrid, esc = Grid.esc;
  var PREF_KEY = 'sop-dashboard-prefs';

  var Store = window.SOPStore;
  var state = E.emptyState();
  var ready = false;
  var prefs = loadPrefs();
  // 예전 탭(재고 현황_RAW, 반제품코드)은 하위 탭으로 옮겨짐
  prefs.sub = prefs.sub || {};
  if (prefs.tab === 'raw') { prefs.tab = 'stock'; prefs.sub.stock = 'raw'; }
  if (prefs.tab === 'semi') { prefs.tab = 'items'; prefs.sub.items = 'semi'; }

  // 지금 화면에 보이는 데이터 키 (하위 탭 포함)
  function curKey() {
    var subs = SUBS[prefs.tab];
    if (!subs) return prefs.tab;
    var k = prefs.sub[prefs.tab];
    return subs.some(function (x) { return x.key === k; }) ? k : subs[0].key;
  }
  var results = [];
  var currentGrid = null;

  var TABS = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'items', label: '품목 상세' },
    { key: 'sop', label: 'S&OP' },
    { key: 'stock', label: '재고 현황' },
    { key: 'sales', label: '판매 실적 현황' },
    { key: 'transit', label: '발주 현황' }
  ];
  // 한 탭 안에서 나눠 보는 하위 탭
  var SUBS = {
    items: [{ key: 'items', label: '품목' }, { key: 'semi', label: '반제품 BOM' }],
    stock: [{ key: 'stock', label: '재고 현황' }, { key: 'raw', label: 'WMS 원본 (RAW)' }]
  };
  // 각 데이터가 들어가는 위치 이름 (불러오기 안내에 사용)
  var TARGET = {
    items: '품목 상세', itemlist: '품목 상세 (품목 목록)', semi: '품목 상세 › 반제품 BOM', sop: 'S&OP', stock: '재고 현황',
    raw: '재고 현황 › WMS 원본', sales: '판매 실적 현황', transit: '발주 현황'
  };
  var TITLE = {
    sop: 'S&OP', stock: '재고 현황', raw: 'WMS 재고 원본 (RAW)', sales: '판매 실적 현황', transit: '발주 현황', semi: '반제품 BOM'
  };

  // ── 저장 ─────────────────────────────────────────────
  function loadPrefs() {
    try { return Object.assign({ tab: 'dashboard', status: 'all', brand: 'all' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch (e) { return { tab: 'dashboard', status: 'all', brand: 'all' }; }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 무시 */ }
  }

  function persist() {
    if (Store.readOnly) return;
    state.updatedAt = new Date().toISOString();
    setSaveState('저장 중…');
    Store.save(state);
  }
  Store.on('saved', function () {
    setSaveState((Store.mode === 'shared' ? '공유 저장됨 ' : '이 브라우저에 저장됨 ') + timeLabel(new Date()));
  });
  Store.on('error', function (err) {
    if (Store.mode === 'local') setSaveState('브라우저 저장 실패 — 설정에서 백업 파일로 저장하세요', true);
    else if (err && err.code === 'quota_exceeded') setSaveState('공유 저장 공간이 가득 찼습니다', true);
    else if (Store.readOnly) { setSaveState('보기 전용 — 수정 권한이 없습니다', true); render(); }
    else setSaveState('공유 저장 실패 — 잠시 후 다시 시도하세요', true);
  });
  // 다른 사람이 공유 데이터를 바꾸면 반영 (셀 편집 중이면 끝난 뒤)
  var remoteWaiting = null;
  Store.on('remote', function (next) {
    if (currentGrid && currentGrid.editing) { remoteWaiting = next; return; }
    applyRemote(next);
  });
  function applyRemote(next) {
    remoteWaiting = null;
    state = next;
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
    setSaveState('다른 사용자의 변경을 반영했습니다 ' + timeLabel(new Date()));
  }
  window.addEventListener('pagehide', function () { Store.flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) Store.flush(); });

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
  function isDiscontinued(item) { return /단종/.test(item.note || ''); }
  function isNew(item) { return /신제품/.test(item.note || ''); }
  var BRANDS = ['플라이밀', '라이블링', '리덴스'];
  function brandOf(item) { return item.group || '기타'; }
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
    var sub = document.getElementById('headerSub');
    var tab = TABS.filter(function (t) { return t.key === prefs.tab; })[0];
    document.getElementById('pageTitle').textContent = tab ? (tab.key === 'dashboard' ? 'S&OP 대시보드' : tab.label) : 'S&OP 대시보드';
    sub.textContent = hasData() ? '' : '엑셀 파일을 불러오면 대시보드가 생성됩니다';
    sub.hidden = hasData();
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

  // 같은 화면을 다시 그릴 때는 표·페이지 스크롤 위치를 그대로 유지
  var lastViewKey = null;
  function render() {
    var viewKey = prefs.tab + ':' + curKey();
    var keep = null;
    if (viewKey === lastViewKey) {
      keep = { y: window.scrollY, els: {} };
      ['gridHost', 'masterWrap'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) keep.els[id] = [el.scrollTop, el.scrollLeft];
      });
    }
    var lim = keep && currentGrid ? currentGrid.limit : null;
    lastViewKey = viewKey;
    renderView();
    if (lim && currentGrid && currentGrid.limit < lim) { currentGrid.limit = lim; currentGrid.render(); }
    if (keep) {
      Object.keys(keep.els).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.scrollTop = keep.els[id][0]; el.scrollLeft = keep.els[id][1]; }
      });
      window.scrollTo(0, keep.y);
    }
  }

  function renderView() {
    if (remoteWaiting && !(currentGrid && currentGrid.editing)) { var nx = remoteWaiting; remoteWaiting = null; state = nx; }
    document.body.classList.toggle('readonly', Store.readOnly);
    renderTabs();
    recompute();
    updateHeader();
    var view = document.getElementById('view');
    currentGrid = null;
    if (!ready) { view.innerHTML = '<p class="loading muted">데이터를 불러오는 중…</p>'; return; }
    if (!hasData() && prefs.tab === 'dashboard') { view.innerHTML = emptyHtml(); return; }
    if (prefs.tab === 'dashboard') renderDashboard(view);
    else if (curKey() === 'items') renderItems(view);
    else renderSheet(view, curKey());
  }

  function emptyHtml() {
    return '<section class="empty">' +
      '<h2>S&amp;OP 엑셀 파일을 불러오세요</h2>' +
      '<p class="muted">S&amp;OP 관리 엑셀이나 ERP·WMS에서 내려받은 파일을 그대로 올리면, 표 구성을 보고 품목·S&amp;OP·재고·판매·발주·BOM 중 맞는 곳에 반영합니다. 파일명과 시트명은 상관없습니다.</p>' +
      (Store.readOnly ? '<p class="note-box">아직 데이터가 없습니다. 대시보드 담당자가 데이터를 올리면 여기에 표시됩니다.</p>'
        : '<button class="btn btn-primary" type="button" data-open-import>엑셀 불러오기</button>') +
      '<p class="muted small">' + (Store.mode === 'shared'
        ? '불러온 데이터는 이 대시보드를 공유받은 사람들과 함께 보는 공유 저장소에 저장됩니다.'
        : '데이터는 서버로 전송되지 않고 이 브라우저에만 저장됩니다.') + '</p>' +
      '</section>';
  }

  // ── 대시보드 ─────────────────────────────────────────
  var STATUS = {
    urgent: { label: '즉시 발주', cls: 'st-critical', rank: 0 },
    review: { label: '발주 검토', cls: 'st-warning', rank: 1 },
    watch:  { label: '품절 예상', cls: 'st-neutral', rank: 2 },
    ok:     { label: '정상', cls: 'st-good', rank: 3 }
  };
  var period = 'all';   // 보기 기간: 'all'(전체 기간) 또는 월 숫자. 새로 열면 항상 전체 기간
  var openRow = null;   // 리덴스 표에서 펼친 품목 index
  var openExc = null;   // 발주 점검 품목에서 펼친 품목 index
  var excOpen = false;  // 발주 점검 품목 드롭다운 펼침 여부
  var buyOpen = false;  // 예상 매입금액 드롭다운 (새로 열면 항상 닫힘)
  var fold = { flow: false, bal: false }; // 표의 접는 열 묶음 (새로 열면 항상 접힘)

  function inBrand(r) { return !prefs.brand || prefs.brand === 'all' || brandOf(r.item) === prefs.brand; }
  // 대시보드에 나오는 품목: 단종·ERP코드 없는 품목 제외, 선택한 품목군만
  function inScope(r) { return !isDiscontinued(r.item) && E.hasCode(r.item.erp) && inBrand(r); }
  // 발주 판단 대상: 신제품도 제외
  function orderable(r) { return inScope(r) && !isNew(r.item); }

  // 보기 기간에 해당하는 월의 위치(검토 기간 배열 기준)
  function periodIdx(months) {
    var all = months.map(function (m, k) { return k; });
    if (period === 'all') return all;
    var k = months.indexOf(period);
    return k >= 0 ? [k] : all;
  }
  function pick(arr, idx) { return idx.map(function (k) { return arr[k]; }); }
  function total(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }

  function minBal(r, idx) { return Math.min.apply(null, pick(r.balance, idx)); }

  function filteredResults() {
    var q = (prefs.query || '').trim().toLowerCase();
    return results.filter(function (r) {
      if (!inScope(r)) return false;
      if (prefs.status !== 'all' && r.status !== prefs.status) return false;
      if (!q) return true;
      var it = r.item;
      return [it.group, it.erp, it.semi, it.name, it.note, it.note2].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  // 재고일수(개월) = 재고 ÷ 월 수요. 수요가 없으면 null
  function cover(stock, demand) { return demand > 0 ? stock / demand : null; }
  function coverLabel(c, stock) {
    if (stock <= 0) return '품절';
    if (c === null) return '—';
    return (c >= 10 ? Math.round(c) : c.toFixed(1)) + '개월';
  }
  function heat(stock, c) {
    if (stock <= 0) return 'h-crit';
    if (c !== null && c < 1) return 'h-warn';
    return 'h-good';
  }

  // 발주 점검 품목: 보기 기간 안에 월말 잔여가 0 이하인 품목 (신제품·단종 제외)
  // 즉시 발주 → 발주 검토 → 품절 예상 순, 같은 단계에서는 부족량 큰 순
  function exceptions(idx) {
    return results.filter(function (r) {
      return orderable(r) && r.stockoutMonth && pick(r.balance, idx).some(function (v) { return v <= 0; });
    }).sort(function (a, b) { return STATUS[a.status].rank - STATUS[b.status].rank || minBal(a, idx) - minBal(b, idx); });
  }

  function won(v) { return '₩' + Math.round(v).toLocaleString('ko-KR'); }

  // 품목군별 재고금액 = Σ 상품단가 × 현재고 (단종 제외)
  function valueStrip() {
    var groups = BRANDS.slice();
    var active = results.filter(function (r) { return !isDiscontinued(r.item); });
    active.forEach(function (r) { var b = brandOf(r.item); if (groups.indexOf(b) < 0) groups.push(b); });
    var agg = {}, all = { v: 0, miss: 0 };
    groups.forEach(function (g) { agg[g] = { v: 0, miss: 0 }; });
    active.forEach(function (r) {
      var a = agg[brandOf(r.item)];
      a.v += r.stockValue; all.v += r.stockValue;
      if (r.stock > 0 && !r.price) { a.miss++; all.miss++; }
    });
    var cell = function (key, label, a, cls) {
      var on = (prefs.brand || 'all') === key;
      return '<button type="button" class="vcell' + (cls ? ' ' + cls : '') + (on ? ' on' : '') + '" data-brand="' + esc(key) + '" aria-pressed="' + on + '">' +
        '<span class="vlabel">' + esc(label) + '</span><span class="vvalue">' + won(a.v) + '</span>' +
        '<span class="vhint">' + (a.miss ? '단가 미입력 ' + a.miss + '품목' : '단가 × 현재고') + '</span></button>';
    };
    return '<section class="panel values" aria-labelledby="valTitle"><div class="panel-head"><h2 id="valTitle">재고금액</h2>' +
      '<span class="muted">상품단가 × 현재고 · 단종 제외 · 누르면 그 품목군만 보기</span></div><div class="values-grid">' +
      groups.filter(function (g) { return g !== '기타' || agg[g].v || active.some(function (r) { return brandOf(r.item) === '기타'; }); })
        .map(function (g) { return cell(g, g, agg[g]); }).join('') +
      cell('all', '총 합계', all, 'vtotal') + '</div></section>';
  }

  function renderDashboard(view) {
    var scope = results.filter(inScope);
    var months = E.windowMonths(state.settings);
    if (period !== 'all' && months.indexOf(period) < 0) period = 'all';
    var idx = periodIdx(months);
    var exc = exceptions(idx);
    var brand = prefs.brand && prefs.brand !== 'all' ? prefs.brand : null;

    // 맨 위: 품목군·기간 선택 → 재고금액 → 예상 매입금액(접힘) → 발주 점검 품목(접힘) → 품목 표
    var h = '<div class="scopebar">' +
      '<div class="scope-group"><span class="scope-label">품목군</span>' +
      '<div class="seg" role="group" aria-label="품목군">' +
      ['all'].concat(BRANDS).map(function (b) {
        var on = (prefs.brand || 'all') === b;
        return '<button type="button" data-brand="' + b + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '">' + (b === 'all' ? '전체' : b) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="scope-group"><span class="scope-label">기간</span>' +
      '<div class="seg" role="group" aria-label="보기 기간">' +
      '<button type="button" data-period="all" class="' + (period === 'all' ? 'on' : '') + '" aria-pressed="' + (period === 'all') + '">전체 기간</button>' +
      months.map(function (m) {
        return '<button type="button" data-period="' + m + '" class="' + (period === m ? 'on' : '') + '" aria-pressed="' + (period === m) + '">' + m + '월</button>';
      }).join('') + '</div></div>' +
      '<span class="scope-chip">기준일 ' + todayStr() + '</span>' +
      '</div>';

    h += valueStrip();
    h += purchasePanel(months, idx);

    h += '<details class="panel exc" id="excBox"' + (excOpen ? ' open' : '') + '>' +
      '<summary class="panel-head"><h2>발주 점검 품목 <span class="count">' + exc.length + '</span></h2>' +
      '</summary>' +
      '<div id="excWrap">' + exceptionList(exc, idx) + '</div></details>';

    var statuses = [['all', '전체'], ['urgent', '즉시 발주'], ['review', '발주 검토'], ['watch', '품절 예상'], ['ok', '정상']];
    h += '<section class="panel" id="allItems"><div class="panel-head"><h2>' + esc(brand || '전체 품목') + ' <span class="count plain">' + scope.length + '</span></h2>' +
      '</div>' +
      '<div class="filters">' +
      '<input type="search" id="dashSearch" placeholder="품목군·코드·상품명 검색" value="' + esc(prefs.query || '') + '" />' +
      '<div class="seg" role="group" aria-label="상태 필터">' + statuses.map(function (s) {
        return '<button type="button" data-status="' + s[0] + '" class="' + (prefs.status === s[0] ? 'on' : '') + '" aria-pressed="' + (prefs.status === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="table-wrap" id="masterWrap">' + masterTable(months) + '</div></section>';

    view.innerHTML = h;
    document.getElementById('excBox').addEventListener('toggle', function (e) { excOpen = e.target.open; });
    document.getElementById('buyBox').addEventListener('toggle', function (e) { buyOpen = e.target.open; });
    fitDetails();
  }

  // 입고예정 품목의 예상 매입금액 = 입고예정 수량 × 상품단가 (월별 × 품목군별)
  function purchasePanel(months, idx) {
    var groups = BRANDS.slice();
    var rows = results.filter(function (r) { return E.hasCode(r.item.erp) && !isDiscontinued(r.item); });
    rows.forEach(function (r) { var b = brandOf(r.item); if (groups.indexOf(b) < 0) groups.push(b); });
    var amt = {}, tot = months.map(function () { return 0; });
    groups.forEach(function (g) { amt[g] = months.map(function () { return 0; }); });
    rows.forEach(function (r) {
      var q = total(r.inbound);
      if (!q) return;
      if (!r.price) return; // 단가 없는 품목은 금액에서 빠짐
      r.inbound.forEach(function (v, k) { amt[brandOf(r.item)][k] += v * r.price; tot[k] += v * r.price; });
    });
    var sel = prefs.brand && prefs.brand !== 'all' ? prefs.brand : null;
    var cell = function (v, k) { return '<td class="num' + (idx.indexOf(k) >= 0 && idx.length === 1 ? ' pcol' : '') + (v ? '' : ' zero') + '">' + (v ? won(v) : '—') + '</td>'; };
    var h = '<details class="panel buy" id="buyBox"' + (buyOpen ? ' open' : '') + '><summary class="panel-head"><h2>입고예정 예상 매입금액' + (total(tot) ? ' <span class="count plain">' + won(total(tot)) + '</span>' : '') + '</h2>' +
      '</summary>' +
      '<div class="table-wrap"><table class="buy-table"><thead><tr><th>품목군</th>' +
      months.map(function (m, k) { return '<th class="num' + (idx.indexOf(k) >= 0 && idx.length === 1 ? ' pcol' : '') + '">' + m + '월</th>'; }).join('') +
      '<th class="num">합계</th></tr></thead><tbody>' +
      groups.filter(function (g) { return g !== '기타' || total(amt[g]); }).map(function (g) {
        return '<tr class="' + (sel === g ? 'sel' : '') + '"><th scope="row">' + esc(g) + '</th>' + amt[g].map(cell).join('') +
          '<td class="num sum">' + (total(amt[g]) ? won(total(amt[g])) : '—') + '</td></tr>';
      }).join('') +
      '<tr class="tot"><th scope="row">합계</th>' + tot.map(cell).join('') + '<td class="num sum">' + (total(tot) ? won(total(tot)) : '—') + '</td></tr>' +
      '</tbody></table></div></details>';
    return h;
  }

  function exceptionList(exc, idx) {
    if (!exc.length) return '<p class="muted pad">이 기간에 발주가 필요한 품목이 없습니다.</p>';
    return '<div class="exc-head"><span></span><span>품목군</span><span>ERP코드</span><span>상품명</span><span>상태</span><span class="num">최저 잔여</span><span class="num">권장 발주량</span></div>' +
      '<ul class="exc-list">' + exc.map(function (r) {
        var st = STATUS[r.status], mb = minBal(r, idx), open = r.index === openExc;
        return '<li><button type="button" class="exc-row ' + st.cls + (open ? ' sel' : '') + '" data-exc="' + r.index + '" aria-expanded="' + open + '">' +
          '<i aria-hidden="true"></i>' +
          '<span class="grp">' + esc(brandOf(r.item)) + '</span>' +
          '<span class="code">' + esc(r.item.erp) + '</span>' +
          '<span class="nm">' + esc(r.item.name) + '</span>' +
          '<span><span class="chip ' + st.cls + '">' + esc((r.deadline || st.label) + ' · ' + r.stockoutMonth + '월 품절') + '</span></span>' +
          '<span class="num ' + (mb < 0 ? 'neg' : '') + '">' + signed(mb) + '</span>' +
          '<span class="num">' + n0(r.recommended) + '</span>' +
          '</button>' + (open ? '<div class="exc-detail">' + planHtml(r) + '</div>' : '') + '</li>';
      }).join('') + '</ul>';
  }

  // 품목의 월별 수급 계획표 (보기 기간의 월만)
  function planHtml(r) {
    var it = r.item, months = r.months;
    var idx = periodIdx(months);
    var st = STATUS[r.status];
    var opening = r.months.map(function (m, k) { return k === 0 ? r.stock : r.balance[k - 1]; });
    var c = r.months.map(function (m, k) {
      var next = k + 1 < months.length ? r.demand[k + 1] : r.demand[k];
      return cover(r.balance[k], next);
    });

    var main = '<div class="plan-bar">' +
      '<span class="chip ' + st.cls + '">' + esc(r.deadline || st.label) + '</span>' +
      (r.stockoutMonth ? '<span>품절 예상 <b>' + r.stockoutMonth + '월</b></span>' : '') +
      (r.recommended ? '<span>권장 <b class="num">' + n0(r.recommended) + '</b></span>' : '') +
      (r.deadlineDate && r.deadline && r.deadline !== '즉시 발주' ? '<span>발주 기한 <b class="num">' + r.deadlineDate.toISOString().slice(0, 10) + '</b></span>' : '') +
      '<span>LT <b>' + r.lt + '일</b></span>' +
      (it.semi && it.semi !== '-' && it.semi !== it.erp ? '<span>반제품 ' + esc(it.semi) + '</span>' : '') +
      '</div>';
    main += '<div class="table-wrap"><table class="plan-table' + (idx.length === 1 ? ' single' : '') + '"><thead><tr><th>' + esc(it.erp) + ' 수급 계획</th>' +
      idx.map(function (k) { return '<th class="num">' + months[k] + '월</th>'; }).join('') + '</tr></thead><tbody>' +
      planRow('기초재고', pick(opening, idx)) +
      planRow('+ 입고예정', pick(r.inbound, idx), 'in') +
      planRow('− S&amp;OP 수요', pick(r.demand, idx)) +
      '<tr class="end"><th scope="row">= 기말재고</th>' + idx.map(function (k) {
        return '<td class="num ' + heat(r.balance[k], c[k]) + '">' + signed(r.balance[k]) + '</td>';
      }).join('') + '</tr>' +
      '<tr class="cov"><th scope="row">재고일수</th>' + idx.map(function (k) {
        return '<td class="num">' + coverLabel(c[k], r.balance[k]) + '</td>';
      }).join('') + '</tr>' +
      '</tbody></table></div>' +
      '<p class="plan-legend muted"><span><i class="lg h-crit"></i>품절</span><span><i class="lg h-warn"></i>1개월 미만</span><span><i class="lg h-good"></i>1개월 이상</span>' +
      '<span>재고일수 = 기말재고 ÷ 다음 달 S&amp;OP</span></p>';

    var side = '<div class="plan-facts">' +
      fact('현재고', r.stock, r.stockOverridden ? '수기값' : '') + fact('미입고', r.transit, r.transitOverridden ? '수기값' : '') +
      fact('가용재고', r.available) + fact('안전재고', r.safety) + '</div>';
    if (r.stockOverridden || r.transitOverridden) {
      side += '<p class="note-box">현재고/미입고는 엑셀에서 값으로 입력된 수기값을 씁니다 (조회값: 현재고 ' + n0(r.stockLookup) +
        ', 미입고 ' + n0(r.transitLookup) + '). 품목 상세 탭에서 수기값을 비우면 자동 계산됩니다.</p>';
    }
    if (r.overdue.length) {
      side += '<p class="note-box warn">납기일이 ' + months[0] + '월 이전인데 잔량이 남은 발주 ' + r.overdue.length + '건(' +
        n0(r.overdue.reduce(function (s, x) { return s + E.num(x[14]); }, 0)) + ' EA)은 월별 입고예정에 들어가지 않습니다.</p>';
    }
    side += '<details class="more"><summary>미입고 발주 ' + r.poLines.length + '건</summary>' +
      (r.poLines.length ? miniTable(['발주번호', '거래처', '품번', '잔량', '납기일자', '담당자'],
        r.poLines.map(function (p) { return [p[2], p[5], p[7], { n: p[14] }, p[17], p[18]]; })) : '<p class="muted pad">없음</p>') + '</details>';

    var rawRows = [];
    var stockCodes = r.stockRows.map(function (s) { return E.str(s[0]); });
    state.sheets.raw.rows.forEach(function (x) { if (stockCodes.indexOf(E.str(x[0])) >= 0) rawRows.push(x); });
    side += '<details class="more"><summary>재고 구성 (물류센터 ' + rawRows.length + '행)</summary>' +
      (rawRows.length ? miniTable(['ERP코드', '물류센터', '창고', '유통기한', '가용재고'], rawRows.map(function (x) { return [x[0], x[4], x[5], x[6], { n: x[7] }]; }))
        : '<p class="muted pad">WMS 원본(RAW)에 연결된 행이 없습니다.</p>') + '</details>';
    if (r.salesRows.length) {
      var sh = state.sheets.sales.headers, mcols = [];
      sh.forEach(function (hd, k) { if (/^\d{1,2}월$/.test(E.str(hd))) mcols.push(k); });
      side += '<details class="more"><summary>판매 실적</summary>' + miniTable(['ERP코드'].concat(mcols.map(function (k) { return sh[k]; })),
        r.salesRows.map(function (s) { return [s[0]].concat(mcols.map(function (k) { return { n: s[k] }; })); })) + '</details>';
    }

    return '<div class="plan"><div class="plan-main">' + main + '</div><div class="plan-side">' + side + '</div></div>';
  }

  function planRow(label, vals, cls) {
    return '<tr><th scope="row">' + label + '</th>' + vals.map(function (v) {
      return '<td class="num' + (cls && v ? ' ' + cls : '') + (v ? '' : ' zero') + '">' + signed(v) + '</td>';
    }).join('') + '</tr>';
  }

  function fact(label, v, tag) {
    return '<div><span>' + esc(label) + (tag ? ' <em>' + esc(tag) + '</em>' : '') + '</span><b class="num' + (v < 0 ? ' neg' : '') + '">' + signed(v) + '</b></div>';
  }

  // 표가 가로로 길어도 펼친 수급 계획표는 보이는 폭 안에 머물도록
  function fitDetails() {
    var wrap = document.getElementById('masterWrap');
    if (wrap) wrap.style.setProperty('--dw', wrap.clientWidth + 'px');
  }
  window.addEventListener('resize', fitDetails);

  function redrawMaster() {
    var wrap = document.getElementById('masterWrap');
    var sx = wrap.scrollLeft;
    var months = E.windowMonths(state.settings);
    wrap.innerHTML = masterTable(months);
    wrap.scrollLeft = sx;
    fitDetails();
  }

  function toggleRow(i) {
    openRow = openRow === i ? null : i;
    redrawMaster();
    var d = document.querySelector('#masterWrap tr.detail-row');
    if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function toggleExc(i) {
    openExc = openExc === i ? null : i;
    var months = E.windowMonths(state.settings);
    var idx = periodIdx(months);
    document.getElementById('excWrap').innerHTML = exceptionList(exceptions(idx), idx);
  }

  // 표 열 정의: 묶음(group)마다 첫 열에 구분선, 묶음별로 번갈아 배경.
  // 입고예정·S&OP, 월말 잔여·안전재고 묶음은 접으면 요약 열 하나만 보임
  function masterCols(months, idx) {
    var mN = idx.length;
    var groups = [];
    groups.push({ label: '기본 정보', cols: [
      { th: '<span class="sr-only">상세</span>', w: 22, cls: 'sticky-t tog', td: function (r, x) {
        return '<span class="tog-btn" aria-hidden="true"></span><span class="sr-only">' + (x.open ? '상세 닫기' : '상세 보기') + '</span>';
      } },
      { th: '품목군', w: 72, cls: 'sticky-l grp', td: function (r) { return esc(brandOf(r.item)); } },
      { th: 'ERP코드', w: 76, cls: 'sticky-l2 code', td: function (r) { return esc(r.item.erp); } },
      { th: '상품명', cls: 'sticky-l3 name', td: function (r) { return esc(r.item.name); }, title: function (r) { return r.item.name; } }
    ] });
    groups.push({ label: '재고 현황', cols: [
      { th: '현재고', w: 72, num: true, td: function (r) { return signed(r.stock); }, neg: function (r) { return r.stock < 0; } },
      { th: '미입고', w: 72, num: true, td: function (r) { return signed(r.transit); } },
      { th: '가용재고', w: 76, num: true, td: function (r) { return signed(r.available); } },
      { th: 'S&amp;OP 합계', w: 80, num: true, td: function (r, x) { return signed(total(x.dem)); } },
      { th: 'LT(일)', w: 52, num: true, cls: 'edit', td: function (r) { return '<input type="number" min="0" data-field="lt" value="' + esc(r.item.lt) + '" aria-label="LT"' + dis() + ' />'; } },
      { th: '재고일수', w: 68, num: true, hint: '현재고 ÷ 보기 기간 월평균 S&OP', td: function (r, x) { return coverLabel(x.cv, r.stock); },
        extra: function (r, x) { return r.stock <= 0 ? 'neg' : x.cv !== null && x.cv < 1 ? 'warn-t' : ''; } }
    ] });
    if (fold.flow) {
      var flow = [];
      idx.forEach(function (k) {
        flow.push({ th: months[k] + '월<span class="sub">입고</span>', w: 72, num: true, td: function (r) { return signed(r.inbound[k]); }, extra: function (r) { return r.inbound[k] ? 'in' : 'zero'; } });
      });
      idx.forEach(function (k) {
        flow.push({ th: months[k] + '월<span class="sub">S&amp;OP</span>', w: 72, num: true, td: function (r) { return signed(r.demand[k]); }, extra: function (r) { return r.demand[k] ? '' : 'zero'; } });
      });
      groups.push({ label: '입고예정 · S&amp;OP', fold: 'flow', cols: flow });
    } else {
      groups.push({ label: '입고예정 · S&amp;OP', fold: 'flow', cols: [
        { th: '입고 / S&amp;OP', w: 128, num: true, hint: '보기 기간 합계', td: function (r, x) {
          return '<span class="' + (total(x.inb) ? 'in' : 'zero') + '">' + n0(total(x.inb)) + '</span> / ' + n0(total(x.dem));
        } }
      ] });
    }
    if (fold.bal) {
      var bal = idx.map(function (k) {
        return { th: months[k] + '월<span class="sub">월말</span>', w: 76, num: true, td: function (r) { return signed(r.balance[k]); },
          extra: function (r) { return 'bal' + (r.balance[k] <= 0 ? ' bal-neg' : ''); } };
      });
      bal.push({ th: '안전재고', w: 76, num: true, hint: '최근 ' + state.settings.salesAvgMonths + '개월 판매 평균 ÷ 30 × LT', td: function (r) { return signed(r.safety); }, extra: function (r) { return r.safety ? '' : 'zero'; } });
      groups.push({ label: '월말 잔여 · 안전재고', fold: 'bal', cols: bal });
    } else {
      groups.push({ label: '월말 잔여 · 안전재고', fold: 'bal', cols: [
        { th: '최저 잔여', w: 128, num: true, hint: '보기 기간 월말 잔여 중 가장 낮은 값', td: function (r) { return signed(minBal(r, idx)); },
          extra: function (r) { return 'bal' + (minBal(r, idx) <= 0 ? ' bal-neg' : ''); } }
      ] });
    }
    groups.push({ label: '검토', cols: [
      { th: '품절 예상월', w: 74, cls: 'ctr', td: function (r) { return r.stockoutMonth ? r.stockoutMonth + '월' : '<span class="muted">—</span>'; } },
      { th: '발주', w: 84, cls: 'ctr', hint: '발주 기한 (LT 안에 품절이면 발주 검토)', td: function (r) {
        if (!r.deadline || isNew(r.item)) return '';
        var cls = r.deadline === '즉시 발주' ? 'st-critical' : r.review ? 'st-warning' : 'st-neutral';
        return '<span class="chip ' + cls + '">' + esc(r.deadline) + '</span>';
      } },
      { th: '권장발주량', w: 80, num: true, td: function (r) { return isNew(r.item) || r.recommended === null ? '' : n0(r.recommended); } }
    ] });
    groups.push({ label: '비고', cols: [
      { th: '비고', w: 64, cls: 'ctr', td: function (r) { return isNew(r.item) ? '<span class="chip st-new">신제품</span>' : esc(r.item.note2 || ''); } }
    ] });
    return groups;
  }

  function masterTable(months) {
    var rows = filteredResults();
    var idx = periodIdx(months);
    var groups = masterCols(months, idx);
    var flat = [];
    groups.forEach(function (g, gi) {
      g.cols.forEach(function (c, ci) { flat.push({ c: c, start: ci === 0 && gi > 0, band: gi % 2 ? 'band-b' : 'band-a' }); });
    });
    var ncol = flat.length;
    // 상품명 열만 남는 폭을 쓰고 나머지는 고정 (최소 220px 보장, 넘치면 가로 스크롤)
    var fixedW = flat.reduce(function (a, f) { return a + (f.c.w || 0); }, 0);
    var h = '<table class="master" style="min-width:' + (fixedW + 220) + 'px"><colgroup>' +
      flat.map(function (f) { return f.c.w ? '<col style="width:' + f.c.w + 'px">' : '<col>'; }).join('') + '</colgroup><thead><tr class="grp">' + groups.map(function (g, gi) {
      var cls = (gi === 0 ? 'sticky-l sticky-grp' : 'gs ' + (gi % 2 ? 'band-b' : 'band-a'));
      var label = g.fold
        ? '<button type="button" class="fold" data-fold="' + g.fold + '" aria-expanded="' + fold[g.fold] + '">' + (fold[g.fold] ? '▾ ' : '▸ ') + g.label + '</button>'
        : g.label;
      return '<th colspan="' + g.cols.length + '" class="' + cls + '">' + label + '</th>';
    }).join('') + '</tr><tr>' + flat.map(function (f) {
      var cls = [f.c.cls || '', f.c.num ? 'num' : '', f.start ? 'gs' : '', f.band].join(' ');
      return '<th class="' + cls + '"' + (f.c.hint ? ' title="' + esc(f.c.hint) + '"' : '') + '>' + f.c.th + '</th>';
    }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var dem = pick(r.demand, idx);
      var x = { open: r.index === openRow, dem: dem, inb: pick(r.inbound, idx), cv: cover(r.stock, total(dem) / idx.length) };
      h += '<tr data-i="' + r.index + '" class="' + (isNew(r.item) ? 'newp' : '') + (x.open ? ' sel open' : '') + '" aria-expanded="' + x.open + '" title="' + (x.open ? '눌러서 수급 계획표 닫기' : '눌러서 수급 계획표 보기') + '">' +
        flat.map(function (f) {
          var c = f.c;
          var cls = [c.cls || '', c.num ? 'num' : '', f.start ? 'gs' : '', f.band, c.extra ? c.extra(r, x) : '', c.neg && c.neg(r) ? 'neg' : ''].join(' ');
          return '<td class="' + cls + '"' + (c.title ? ' title="' + esc(c.title(r)) + '"' : '') + '>' + c.td(r, x) + '</td>';
        }).join('') + '</tr>';
      if (x.open) h += '<tr class="detail-row"><td colspan="' + ncol + '"><div class="detail-inner">' + planHtml(r) + '</div></td></tr>';
    });
    if (!rows.length) h += '<tr><td colspan="' + ncol + '" class="muted pad">조건에 맞는 품목이 없습니다.</td></tr>';
    h += '</tbody></table>';
    return h;
  }

  function dis() { return Store.readOnly ? ' disabled' : ''; }

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
      redrawMaster();
    }
  });
  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.field) {
      var i = Number(t.closest('tr').dataset.i);
      var it = state.items[i];
      if (t.dataset.field === 'lt') it.lt = E.num(t.value);
      else it[t.dataset.field] = t.value;
      persist();
      var y = window.scrollY, sx = document.getElementById('masterWrap').scrollLeft;
      render();
      window.scrollTo(0, y);
      document.getElementById('masterWrap').scrollLeft = sx;
    }
  });
  view.addEventListener('click', function (e) {
    var p = e.target.closest('[data-period]');
    if (p) {
      period = p.dataset.period === 'all' ? 'all' : Number(p.dataset.period);
      var y = window.scrollY;
      render();
      window.scrollTo(0, y);
      return;
    }
    var br = e.target.closest('[data-brand]');
    if (br) {
      prefs.brand = br.dataset.brand; savePrefs(); openRow = null; openExc = null;
      var yy = window.scrollY; render(); window.scrollTo(0, yy);
      return;
    }
    var fd = e.target.closest('[data-fold]');
    if (fd) { fold[fd.dataset.fold] = !fold[fd.dataset.fold]; redrawMaster(); return; }
    var s = e.target.closest('[data-status]');
    if (s) { prefs.status = s.dataset.status; savePrefs(); render(); return; }
    var x = e.target.closest('[data-exc]');
    if (x) { toggleExc(Number(x.dataset.exc)); return; }
    var row = e.target.closest('#masterWrap tbody tr[data-i]');
    if (row && !e.target.closest('input')) { toggleRow(Number(row.dataset.i)); return; }
    if (e.target.closest('[data-open-import]')) { openImport(); return; }
    var sub = e.target.closest('[data-sub]');
    if (sub) { prefs.sub[prefs.tab] = sub.dataset.sub; savePrefs(); render(); return; }
    var act = e.target.closest('[data-act]');
    if (act) sheetAction(act.dataset.act);
  });

  function miniTable(head, rows) {
    return '<div class="table-wrap"><table class="mini-table"><thead><tr>' + head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c) {
          return c && typeof c === 'object' ? '<td class="num">' + n0(E.num(c.n)) + '</td>' : '<td>' + esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ── 품목 상세 ───────────────────────────────────────
  // 반제품 BOM에서 모품번 = ERP코드인 자품번 목록
  function bomIndex() {
    var sh = state.sheets.semi, idx = {};
    var hp = sh.headers.indexOf('모품번'), hc = sh.headers.indexOf('자품번');
    if (hp < 0 || hc < 0) return idx;
    sh.rows.forEach(function (r) {
      var p = E.str(r[hp]), c = E.str(r[hc]);
      if (!p || !c) return;
      idx[p] = idx[p] || [];
      if (idx[p].indexOf(c) < 0) idx[p].push(c);
    });
    return idx;
  }
  // BOM을 올리거나 고치면 자품번 중 HA 코드를 해당 품목의 반제품코드로 반영
  function syncSemiFromBom() {
    var idx = bomIndex(), n = 0;
    state.items.forEach(function (it) {
      if (!E.hasCode(it.erp)) return;
      var ha = (idx[E.str(it.erp)] || []).filter(function (c) { return /^HA/i.test(c); });
      if (!ha.length) return;
      var v = ha.join(', ');
      if (it.semi !== v) { it.semi = v; n++; }
    });
    return n;
  }

  var ITEM_COLS = [
    { label: '품목군', key: 'group', type: 'select', width: 84,
      options: ['플라이밀', '라이블링', '리덴스', '기타'].map(function (g) { return { value: g, label: g }; }) },
    { label: 'ERP코드', key: 'erp', width: 90 },
    { label: '반제품코드', key: 'semi', width: 96 },
    { label: '상품명', key: 'name', width: 340 },
    { label: 'LT(일)', key: 'lt', type: 'number', width: 70 },
    { label: '상품단가', key: 'price', type: 'number', width: 96 },
    { label: '비고', key: 'note', type: 'select', width: 80,
      options: [{ value: '', label: '—' }, { value: '신제품', label: '신제품' }, { value: '단종', label: '단종' }] },
    { label: '비고2', key: 'note2', width: 160 },
    { label: 'S&OP 매칭', key: 'sopMatch', type: 'select', width: 96,
      options: [{ value: 'code', label: 'ERP코드' }, { value: 'name', label: '상품명' }] }
  ];

  function newItem() {
    var g = prefs.brand && prefs.brand !== 'all' ? prefs.brand : '리덴스';
    return { erp: '-', semi: '-', name: '', group: g, lt: g === '리덴스' ? 80 : 45, price: null, sopMatch: 'code', note: '신제품', note2: '' };
  }

  function renderItems(view) {
    view.innerHTML = sheetShell({
      title: '품목 상세',
      desc: '',
      count: state.items.length,
      actions: ['add', 'paste', 'import'],
      sheetKey: 'items'
    });
    currentGrid = new Grid(document.getElementById('gridHost'), {
      columns: roCols(ITEM_COLS),
      history: historyFor('items'),
      rows: function () { return state.items; },
      stickyCols: 2,
      rowClass: function (it) { return isDiscontinued(it) ? 'row-disc' : isNew(it) ? 'row-new' : ''; },
      filter: searchFilter(function (it) { return [it.group, it.erp, it.semi, it.name, it.note, it.note2].join(' '); }),
      newRow: newItem,
      onChange: function (ri) { persist(); if (ri >= 0) currentGrid.refreshRow(ri); updateUndo(); },
      onDelete: Store.readOnly ? null : function (ri) {
        askConfirm('"' + (state.items[ri].name || state.items[ri].erp) + '" 품목을 삭제할까요?', '삭제').then(function (ok) {
          if (!ok) return;
          state.items.splice(ri, 1); persist(); currentGrid.render(); updateCount(state.items.length);
        });
      }
    });
    currentGrid.render();
  }

  // ── 원본 시트 ───────────────────────────────────────
  var NAME_HEADERS = /상품명|품명|모품명|자품명/;
  var undoStacks = {}; // 시트별 되돌리기 기록 (화면을 다시 그려도 유지, 새로고침하면 초기화)
  function historyFor(key) { return (undoStacks[key] = undoStacks[key] || []); }

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
    sales: '월별 판매 실적입니다. 대시보드의 안전재고(최근 판매 평균 ÷ 30 × LT) 계산에 쓰입니다.',
    raw: 'WMS에서 내려받은 재고현황 파일을 그대로 올리세요. 창고·소비기한별로 나뉜 행이 ERP코드별로 합산되어 ‘재고 현황’ 탭의 가용재고에 반영됩니다.'
  };

  function renderSheet(view, key) {
    var sheet = state.sheets[key];
    view.innerHTML = sheetShell({
      title: TITLE[key] || sheet.name || key,
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
      columns: roCols(cols),
      groups: sheet.groups,
      history: historyFor(key),
      rows: function () { return state.sheets[key].rows; },
      stickyCols: key === 'sop' || key === 'stock' || key === 'sales' ? Math.min(3, cols.length) : 1,
      filter: searchFilter(function (row) { return row.join(' '); }),
      onChange: function (ri) {
        markEdited(key);
        if (key === 'semi') syncSemiFromBom();
        persist();
        recompute(); // 계산 열(S&OP 합계, 재고 가용재고) 갱신
        if (remoteWaiting) { applyRemote(remoteWaiting); return; }
        if (ri >= 0) currentGrid.refreshRow(ri);
        else currentGrid.render();
        updateCount(state.sheets[key].rows.length);
        updateUndo();
      },
      onDelete: Store.readOnly ? null : function (ri) {
        state.sheets[key].rows.splice(ri, 1);
        markEdited(key); if (key === 'semi') syncSemiFromBom(); persist(); recompute(); currentGrid.render(); updateCount(state.sheets[key].rows.length);
      }
    });
    currentGrid.render();
  }

  function roCols(cols) {
    return Store.readOnly ? cols.map(function (c) { return Object.assign({}, c, { readOnly: true }); }) : cols;
  }

  function searchFilter(text) {
    var q = (prefs['q_' + curKey()] || '').trim().toLowerCase();
    if (!q) return null;
    return function (row) { return String(text(row)).toLowerCase().indexOf(q) >= 0; };
  }

  function sheetShell(o) {
    var acts = {
      undo: '<button class="btn" type="button" data-act="undo" id="btnUndo" title="마지막 수정·붙여넣기 되돌리기 (Ctrl+Z)"' +
        (historyFor(curKey()).length ? '' : ' disabled') + '>↶ 되돌리기</button>',
      add: '<button class="btn" type="button" data-act="add">+ 행 추가</button>',
      paste: '<button class="btn" type="button" data-act="paste">붙여넣기로 갱신</button>',
      import: '<button class="btn" type="button" data-act="import">엑셀에서 불러오기</button>'
    };
    var metaField = o.sheetKey !== 'items'
      ? '<label class="meta-field">업데이트 표기<input type="text" data-meta value="' + esc(o.meta || '') + '" placeholder="예: UPDATE : ' + todayStr() + '" /></label>'
      : '';
    var subs = SUBS[prefs.tab];
    var subBar = subs ? '<div class="subtabs" role="tablist">' + subs.map(function (x) {
      var on = x.key === curKey();
      return '<button type="button" role="tab" data-sub="' + x.key + '" class="' + (on ? 'on' : '') + '" aria-selected="' + on + '">' + esc(x.label) + '</button>';
    }).join('') + '</div>' : '';
    return '<section class="panel sheet">' + subBar +
      '<div class="panel-head"><div><h2>' + esc(o.title) + '</h2>' + (o.desc ? '<p class="muted desc">' + o.desc + '</p>' : '') + '</div>' +
      '<div class="sheet-meta muted"><span id="rowCount">' + o.count.toLocaleString('ko-KR') + '행</span>' +
      (o.editedAt ? '<span>마지막 수정 ' + dateLabel(o.editedAt) + '</span>' : '') + '</div></div>' +
      '<div class="toolbar"><input type="search" data-sheet-search placeholder="검색" value="' + esc(prefs['q_' + curKey()] || '') + '" />' +
      (Store.readOnly ? '' : acts.undo + o.actions.map(function (a) { return acts[a]; }).join('') + metaField) + '</div>' +
      '<div class="table-wrap grid-wrap" id="gridHost"></div></section>';
  }

  function updateUndo() {
    var b = document.getElementById('btnUndo');
    if (b) b.disabled = !historyFor(curKey()).length;
  }

  function updateCount(n) {
    var el = document.getElementById('rowCount');
    if (el) el.textContent = n.toLocaleString('ko-KR') + '행';
  }

  var searchTimer = null;
  view.addEventListener('input', function (e) {
    if (e.target.matches('[data-sheet-search]')) {
      prefs['q_' + curKey()] = e.target.value;
      savePrefs();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (!currentGrid) return;
        currentGrid.o.filter = curKey() === 'items'
          ? searchFilter(function (it) { return [it.erp, it.semi, it.name, it.note].join(' '); })
          : searchFilter(function (row) { return row.join(' '); });
        currentGrid.render();
      }, 150);
    }
  });
  // Ctrl+Z (셀 입력 중이 아닐 때): 표의 마지막 변경 되돌리기
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    if (!currentGrid || currentGrid.editing || Store.readOnly) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    sheetAction('undo');
  });

  view.addEventListener('change', function (e) {
    if (e.target.matches('[data-meta]')) {
      state.sheets[curKey()].meta = e.target.value.trim();
      persist();
    }
  });

  function sheetAction(act) {
    var key = curKey();
    if (act === 'undo') {
      if (currentGrid && currentGrid.undo()) { if (key === 'semi') { syncSemiFromBom(); persist(); } toast('마지막 변경을 되돌렸습니다'); }
      updateUndo();
      return;
    }
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
  function pasteTargetCols(key) {
    return key === 'items' ? ITEM_COLS.filter(function (c) { return !c.readOnly; }) : sheetColumns(key);
  }

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
    var name = TARGET[key] || key;
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
    var before = pasteKey === 'items' ? state.items : state.sheets[pasteKey].rows;
    var hist = historyFor(pasteKey);
    hist.push({ all: JSON.parse(JSON.stringify(before)) });
    if (hist.length > 50) hist.shift();
    if (pasteKey === 'items') {
      state.items = mode === 'replace' ? rows : state.items.concat(rows);
    } else {
      var sh = state.sheets[pasteKey];
      sh.rows = mode === 'replace' ? rows : sh.rows.concat(rows);
      markEdited(pasteKey);
      if (pasteKey === 'semi') syncSemiFromBom();
    }
    persist();
    document.getElementById('pasteDialog').close();
    toast(rows.length + '행을 ' + (mode === 'replace' ? '교체' : '추가') + '했습니다');
    render();
  });

  // ── 엑셀 불러오기 / 내보내기 ────────────────────────
  var pending = [], importFocus = null; // pending: [{ file, wb, sheet, key, hr }]

  function openImport(onlyKey) {
    importFocus = onlyKey || null;
    pending = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('dzFile').textContent = '';
    document.getElementById('importSheets').innerHTML = '';
    document.getElementById('importConfirm').disabled = true;
    document.getElementById('importDialog').showModal();
  }

  function readFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = I.readWorkbook(new Uint8Array(reader.result));
          resolve({ file: file.name, entries: I.scanWorkbook(wb).map(function (e) { return Object.assign({ file: file.name, wb: wb }, e); }) });
        } catch (err) { resolve({ file: file.name, error: err.message, entries: [] }); }
      };
      reader.onerror = function () { resolve({ file: file.name, error: '읽기 실패', entries: [] }); };
      reader.readAsArrayBuffer(file);
    });
  }

  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    document.getElementById('dzFile').textContent = files.length + '개 파일 읽는 중…';
    Promise.all(files.map(readFile)).then(function (res) {
      pending = [];
      res.forEach(function (r) { pending = pending.concat(r.entries); });
      document.getElementById('dzFile').textContent = files.map(function (f) { return f.name; }).join(', ');
      var notes = res.filter(function (r) { return !r.entries.length; }).map(function (r) {
        return '<p class="note-box warn">' + esc(r.file) + ': ' + (r.error ? '파일을 읽을 수 없습니다 (' + esc(r.error) + ')' :
          '반영할 표를 찾지 못했습니다. S&amp;OP 계획, 재고 현황, WMS 재고 원본, 판매 실적, ERP 발주 현황, 반제품 BOM, 품목 목록 형식인지 확인해 주세요.') + '</p>';
      }).join('');
      if (!pending.length) { document.getElementById('importSheets').innerHTML = notes; return; }
      var hasItems = state.items.length > 0, seen = {};
      document.getElementById('importSheets').innerHTML =
        '<p class="muted">표 구성을 보고 반영할 곳을 정했습니다. 선택한 항목은 웹의 기존 데이터를 <b>덮어씁니다</b>.</p>' +
        pending.map(function (e, i) {
          var focusHit = importFocus && (e.key === importFocus || (importFocus === 'items' && e.key === 'itemlist'));
          var checked = importFocus ? (focusHit && !seen[e.key]) : !seen[e.key] && !(e.key === 'items' && hasItems);
          seen[e.key] = true;
          var warn = e.key === 'items' && hasItems ? ' <span class="muted small">— 웹에서 수정한 LT·비고·발주 조정이 파일 값으로 바뀝니다</span>' : '';
          return '<label class="check imp-row"><input type="checkbox" value="' + i + '"' + (checked ? ' checked' : '') + ' />' +
            '<span class="imp-src">' + esc(e.file) + (e.sheet ? ' · ' + esc(e.sheet) : '') + '</span>' +
            '<span class="imp-arrow" aria-hidden="true">→</span><b>' + esc(TARGET[e.key] || e.key) + '</b>' + warn + '</label>';
        }).join('') +
        (Object.keys(seen).some(function (k) { return pending.filter(function (e) { return e.key === k; }).length > 1; })
          ? '<p class="muted small">같은 곳에 반영되는 항목을 여러 개 고르면 아래쪽 항목이 최종 반영됩니다.</p>' : '') + notes;
      document.getElementById('importConfirm').disabled = false;
    });
  }

  document.getElementById('fileInput').addEventListener('change', function (e) { handleFiles(e.target.files); });
  var dz = document.getElementById('dropzone');
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files); });

  document.getElementById('importConfirm').addEventListener('click', function () {
    var picked = Array.prototype.map.call(document.querySelectorAll('#importSheets input:checked'), function (x) { return pending[Number(x.value)]; });
    if (!picked.length) { toast('선택한 항목이 없습니다'); return; }
    picked.forEach(function (e) {
      I.applyEntry(state, e.wb, e);
      if (state.sheets[e.key]) markEdited(e.key);
    });
    var synced = syncSemiFromBom();
    state.updatedAt = new Date().toISOString();
    persist();
    document.getElementById('importDialog').close();
    toast(picked.map(function (e) { return TARGET[e.key]; }).join(', ') + ' 반영했습니다' + (synced ? ' · 반제품코드 ' + synced + '건 BOM에서 갱신' : ''));
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
    var use = window.claude && typeof window.claude.use === 'function' ? window.claude.use.bind(window.claude) : null;
    if (use) {
      // 아티팩트 안에서는 일반 다운로드가 막혀 있어 downloads 기능으로 저장
      use('downloads').then(function (dl) {
        if (!dl) { toast('이 화면에서는 파일 저장을 지원하지 않습니다'); return; }
        return dl.save({ filename: filename, data: blob }).then(function () { toast('저장했습니다'); });
      }).catch(function (err) {
        if (err && err.code === 'declined') return;
        toast('파일을 저장하지 못했습니다' + (err && err.message ? ': ' + err.message : ''));
      });
      return;
    }
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
      state = Store.normalize(s);
      persist();
      document.getElementById('settingsDialog').close();
      toast('백업을 복원했습니다');
      render();
    }).catch(function () { toast('백업 파일을 읽을 수 없습니다'); });
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    var msg = Store.mode === 'shared'
      ? '공유 대시보드의 모든 데이터를 삭제할까요? 공유받은 모든 사람에게서 사라지며 되돌릴 수 없습니다.'
      : '이 브라우저에 저장된 모든 대시보드 데이터를 삭제할까요? 되돌릴 수 없습니다.';
    document.getElementById('settingsDialog').close();
    askConfirm(msg, '모두 삭제').then(function (ok) {
      if (!ok) return;
      state = E.emptyState();
      if (Store.mode === 'local') Store.clearLocal();
      persist();
      render();
    });
  });

  // 확인 창 (아티팩트 안에서는 confirm()이 동작하지 않음)
  function askConfirm(message, okLabel) {
    var dlg = document.getElementById('confirmDialog');
    document.getElementById('confirmMsg').textContent = message;
    document.getElementById('confirmOk').textContent = okLabel || '확인';
    dlg.showModal();
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      });
    });
  }

  // 시작
  render();
  Store.init().then(function (res) {
    state = res.state;
    ready = true;
    if (res.mode === 'shared') {
      setSaveState(res.readOnly ? '보기 전용' : '공유 대시보드' + (state.updatedAt ? ' · 마지막 저장 ' + dateLabel(state.updatedAt) : ''));
    } else if (state.updatedAt) {
      setSaveState('이 브라우저에 저장됨 ' + dateLabel(state.updatedAt));
    }
    applyModeText();
    render();
  });

  function applyModeText() {
    var shared = Store.mode === 'shared';
    document.getElementById('backupDesc').textContent = shared
      ? '데이터는 공유 저장소에 저장되어 이 대시보드를 공유받은 사람 모두가 같은 내용을 봅니다. 따로 보관하려면 백업 파일로 저장하세요.'
      : '데이터는 이 브라우저에만 저장됩니다. 다른 PC로 옮기거나 백업하려면 파일로 저장하세요.';
    ['btnImport', 'btnSettings'].forEach(function (id) { document.getElementById(id).hidden = Store.readOnly; });
  }
})();
