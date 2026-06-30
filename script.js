const STORAGE_KEY = 'todo-list';

let todos         = [];
let currentFilter = 'all';
let currentSearch = '';
let editingId     = null;

// ── Storage ────────────────────────────────────────────────

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

// ── 필터 & 검색 ────────────────────────────────────────────

function getFiltered() {
  let list = todos;
  if (currentFilter === 'active')    list = list.filter(t => !t.completed);
  if (currentFilter === 'completed') list = list.filter(t => t.completed);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(t => t.text.toLowerCase().includes(q));
  }
  return list;
}

// ── 마감일 헬퍼 ────────────────────────────────────────────

function getDueMeta(dueDate, completed) {
  if (!dueDate) return { label: '없음', cls: 'none' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00'); // 로컬 타임존 기준 파싱
  const diff = (due - today) / 86400000;

  if (!completed) {
    if (diff < 0)  return { label: dueDate + ' 초과', cls: 'overdue' };
    if (diff === 0) return { label: '오늘',           cls: 'today'   };
  }
  return { label: dueDate, cls: '' };
}

// ── 렌더링 ─────────────────────────────────────────────────

function renderSummary() {
  const total  = todos.length;
  const done   = todos.filter(t => t.completed).length;
  const active = total - done;
  const pct    = total === 0 ? 0 : Math.round((done / total) * 100);

  document.getElementById('summaryTotal').textContent  = total;
  document.getElementById('summaryActive').textContent = active;
  document.getElementById('summaryDone').textContent   = done;
  document.getElementById('summaryPct').textContent    = pct + '%';
  document.getElementById('miniProgressFill').style.width = pct + '%';
}

function renderTable() {
  const tbody      = document.getElementById('todoTableBody');
  const emptyState = document.getElementById('emptyState');
  const filtered   = getFiltered();

  tbody.innerHTML = filtered.map(todo => {
    const priority  = todo.priority || '보통';
    const { label: dueLabel, cls: dueCls } = getDueMeta(todo.dueDate, todo.completed);
    const statusBadge = todo.completed
      ? '<span class="badge badge-done">완료</span>'
      : '<span class="badge badge-active">진행 중</span>';

    return `<tr class="${todo.completed ? 'row-done' : ''}">
      <td><input type="checkbox" class="row-checkbox" ${todo.completed ? 'checked' : ''} onchange="toggleTodo('${todo.id}')" /></td>
      <td><span class="todo-text ${todo.completed ? 'done' : ''}">${escapeHtml(todo.text)}</span></td>
      <td><span class="badge badge-${todo.category}">${todo.category}</span></td>
      <td><span class="badge badge-${priority}">${priority}</span></td>
      <td><span class="due-label ${dueCls}">${dueLabel}</span></td>
      <td>${statusBadge}</td>
      <td>
        <button class="action-btn" onclick="openModal('${todo.id}')">수정</button>
        <button class="action-btn del" onclick="deleteTodo('${todo.id}')">삭제</button>
      </td>
    </tr>`;
  }).join('');

  emptyState.classList.toggle('visible', filtered.length === 0);
}

function render() {
  renderSummary();
  renderTable();
}

// ── CRUD ───────────────────────────────────────────────────

function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  todo.completed = !todo.completed;
  saveTodos();
  render();
}

function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  saveTodos();
  render();
}

// ── 모달 ───────────────────────────────────────────────────

function openModal(id = null) {
  editingId = id;
  const overlay = document.getElementById('modalOverlay');

  if (id) {
    const todo = todos.find(t => t.id === id);
    document.getElementById('modalTitle').textContent    = '할 일 수정';
    document.getElementById('modalText').value           = todo.text;
    document.getElementById('modalCategory').value       = todo.category;
    document.getElementById('modalPriority').value       = todo.priority || '보통';
    document.getElementById('modalDueDate').value        = todo.dueDate || '';
  } else {
    document.getElementById('modalTitle').textContent    = '새 할 일 추가';
    document.getElementById('modalText').value           = '';
    document.getElementById('modalCategory').value       = '업무';
    document.getElementById('modalPriority').value       = '보통';
    document.getElementById('modalDueDate').value        = '';
  }

  overlay.classList.add('open');
  document.getElementById('modalText').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  editingId = null;
}

function saveModal() {
  const text = document.getElementById('modalText').value.trim();
  if (!text) {
    document.getElementById('modalText').focus();
    return;
  }

  const category = document.getElementById('modalCategory').value;
  const priority = document.getElementById('modalPriority').value;
  const dueDate  = document.getElementById('modalDueDate').value || null;

  if (editingId) {
    const todo = todos.find(t => t.id === editingId);
    if (todo) {
      todo.text     = text;
      todo.category = category;
      todo.priority = priority;
      todo.dueDate  = dueDate;
    }
  } else {
    todos.push({
      id: Date.now().toString(),
      text,
      category,
      priority,
      dueDate,
      completed: false,
      createdAt: new Date().toISOString(),
    });
  }

  saveTodos();
  closeModal();
  render();
}

// ── 유틸 ───────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setPageDate() {
  document.getElementById('pageDate').textContent =
    new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
}

// ── 이벤트 등록 & 초기화 ───────────────────────────────────

document.getElementById('openModalBtn').addEventListener('click', () => openModal());
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
document.getElementById('modalSaveBtn').addEventListener('click', saveModal);

document.getElementById('modalText').addEventListener('keydown', e => {
  if (e.key === 'Enter')  saveModal();
  if (e.key === 'Escape') closeModal();
});

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

document.getElementById('searchInput').addEventListener('input', e => {
  currentSearch = e.target.value.trim();
  render();
});

setPageDate();
todos = loadTodos();
render();
