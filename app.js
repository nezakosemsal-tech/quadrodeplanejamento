/* ============================================================
   QUADRO DE PLANEJAMENTO - Main Application
   ============================================================ */

(function () {
  'use strict';

  // ============= UTILITIES =============
  const uid = () => '_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ============= STATE =============
  const state = {
    boards: {},
    cards: {},
    currentBoardId: null,
    selectedCardIds: new Set(),
    clipboard: [],
    history: { past: [], future: [] },
    canvas: { panX: 0, panY: 0, zoom: 1 },
    ui: {
      darkMode: false,
      snapping: false,
      isPanning: false,
      isDragging: false,
      isResizing: false,
      isDrawingConnection: false,
      connectionStartCardId: null,
      isMarqueeSelecting: false,
      marqueeStart: null,
      editingCardId: null,
      activeTool: null,
      spacePressed: false,
      lastMouseX: 0,
      lastMouseY: 0,
      dragStart: null,
      dragCardOffsets: null,
      resizeCardId: null,
      resizeStart: null,
      contextMenuCardId: null,
      maxZIndex: 10
    }
  };

  // ============= DOM REFS =============
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    canvas: $('#canvas'),
    viewport: $('#canvas-viewport'),
    connectionsSvg: $('#connections-svg'),
    breadcrumb: $('#breadcrumb'),
    searchInput: $('#search-input'),
    zoomLevel: $('#zoom-level'),
    undoBtn: $('#undo-btn'),
    redoBtn: $('#redo-btn'),
    contextMenu: $('#context-menu'),
    cardContextMenu: $('#card-context-menu'),
    colorPicker: $('#color-picker'),
    formatToolbar: $('#format-toolbar'),
    modalOverlay: $('#modal-overlay'),
    modal: $('#modal'),
    modalTitle: $('#modal-title'),
    modalBody: $('#modal-body'),
    modalConfirm: $('#modal-confirm'),
    modalCancel: $('#modal-cancel'),
    modalClose: $('#modal-close'),
    marquee: $('#marquee'),
    toastContainer: $('#toast-container'),
    connColorPicker: $('#conn-color-picker'),
    imageInput: $('#image-input'),
    importInput: $('#import-input')
  };

  // ============= STORAGE =============
  const STORAGE_KEY = 'quadro-planejamento-data';

  function saveToStorage() {
    try {
      const data = {
        boards: state.boards,
        cards: state.cards,
        currentBoardId: state.currentBoardId,
        darkMode: state.ui.darkMode,
        version: 2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        showToast('⚠️ Armazenamento cheio! Considere exportar e limpar dados antigos.');
      }
      console.error('Erro ao salvar:', e);
    }
  }

  const autoSave = debounce(saveToStorage, 500);

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.boards) state.boards = data.boards;
      if (data.cards) state.cards = data.cards;
      if (data.currentBoardId) state.currentBoardId = data.currentBoardId;
      if (data.darkMode !== undefined) state.ui.darkMode = data.darkMode;
      return true;
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
      return false;
    }
  }

  function exportData() {
    const data = {
      boards: state.boards,
      cards: state.cards,
      exportedAt: new Date().toISOString(),
      version: 2
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quadro-planejamento-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ Dados exportados com sucesso!');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.boards || !data.cards) throw new Error('Formato inválido');
        pushHistory();
        state.boards = data.boards;
        state.cards = data.cards;
        const boardIds = Object.keys(state.boards);
        state.currentBoardId = boardIds[0] || null;
        if (!state.currentBoardId) createRootBoard();
        renderCurrentBoard();
        autoSave();
        showToast('✅ Dados importados com sucesso!');
      } catch (err) {
        showToast('❌ Erro ao importar: arquivo inválido.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  // ============= HISTORY (Undo/Redo) =============
  function pushHistory() {
    const snapshot = JSON.stringify({ boards: state.boards, cards: state.cards, currentBoardId: state.currentBoardId });
    state.history.past.push(snapshot);
    if (state.history.past.length > 50) state.history.past.shift();
    state.history.future = [];
    updateHistoryButtons();
  }

  function undo() {
    if (state.history.past.length === 0) return;
    const current = JSON.stringify({ boards: state.boards, cards: state.cards, currentBoardId: state.currentBoardId });
    state.history.future.push(current);
    const prev = JSON.parse(state.history.past.pop());
    state.boards = prev.boards;
    state.cards = prev.cards;
    state.currentBoardId = prev.currentBoardId;
    state.selectedCardIds.clear();
    renderCurrentBoard();
    autoSave();
    updateHistoryButtons();
  }

  function redo() {
    if (state.history.future.length === 0) return;
    const current = JSON.stringify({ boards: state.boards, cards: state.cards, currentBoardId: state.currentBoardId });
    state.history.past.push(current);
    const next = JSON.parse(state.history.future.pop());
    state.boards = next.boards;
    state.cards = next.cards;
    state.currentBoardId = next.currentBoardId;
    state.selectedCardIds.clear();
    renderCurrentBoard();
    autoSave();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    dom.undoBtn.disabled = state.history.past.length === 0;
    dom.redoBtn.disabled = state.history.future.length === 0;
  }

  // ============= TOAST =============
  function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // ============= BOARD MANAGEMENT =============
  function createRootBoard() {
    const id = uid();
    state.boards[id] = {
      id,
      name: 'Meu Quadro',
      parentId: null,
      cardIds: [],
      connections: [],
      panX: 0,
      panY: 0,
      zoom: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.currentBoardId = id;
    return id;
  }

  function createSubBoard(name, parentBoardId) {
    const id = uid();
    state.boards[id] = {
      id,
      name: name || 'Novo Quadro',
      parentId: parentBoardId,
      cardIds: [],
      connections: [],
      panX: 0,
      panY: 0,
      zoom: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return id;
  }

  function getCurrentBoard() {
    return state.boards[state.currentBoardId];
  }

  function navigateToBoard(boardId) {
    if (!state.boards[boardId]) return;
    // Save current board view state
    const current = getCurrentBoard();
    if (current) {
      current.panX = state.canvas.panX;
      current.panY = state.canvas.panY;
      current.zoom = state.canvas.zoom;
    }
    state.currentBoardId = boardId;
    state.selectedCardIds.clear();
    state.ui.editingCardId = null;
    const board = getCurrentBoard();
    state.canvas.panX = board.panX || 0;
    state.canvas.panY = board.panY || 0;
    state.canvas.zoom = board.zoom || 1;
    renderCurrentBoard();
    autoSave();
  }

  function getBoardPath(boardId) {
    const path = [];
    let id = boardId;
    while (id && state.boards[id]) {
      path.unshift(state.boards[id]);
      id = state.boards[id].parentId;
    }
    return path;
  }

  // ============= CARD MANAGEMENT =============
  function createCard(type, x, y, extra = {}) {
    pushHistory();
    const id = uid();
    const board = getCurrentBoard();
    const defaults = {
      note: { width: 260, content: '' },
      todo: { width: 260, title: '', items: [{ id: uid(), text: '', done: false }] },
      image: { width: 280, imageData: '' },
      link: { width: 260, url: '', title: '', description: '' },
      column: { width: 280, title: '', height: 400, childCardIds: [] },
      board: { width: 200, height: 160, linkedBoardId: null, name: '' }
    };

    const card = {
      id,
      type,
      boardId: state.currentBoardId,
      x, y,
      color: '#ffffff',
      zIndex: ++state.ui.maxZIndex,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...defaults[type],
      ...extra
    };

    // Create sub-board for board cards
    if (type === 'board' && !card.linkedBoardId) {
      const subBoardId = createSubBoard(card.name || 'Novo Quadro', state.currentBoardId);
      card.linkedBoardId = subBoardId;
    }

    state.cards[id] = card;
    board.cardIds.push(id);
    renderCard(card);
    autoSave();
    return card;
  }

  function deleteCard(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    pushHistory();

    // Remove from board
    const board = state.boards[card.boardId];
    if (board) {
      board.cardIds = board.cardIds.filter(id => id !== cardId);
      board.connections = board.connections.filter(c => c.fromCardId !== cardId && c.toCardId !== cardId);
    }

    // Delete linked sub-board if board card
    if (card.type === 'board' && card.linkedBoardId) {
      deleteSubBoardRecursive(card.linkedBoardId);
    }

    // Delete child notes if column
    if (card.type === 'column' && card.childCardIds) {
      card.childCardIds.forEach(childId => {
        delete state.cards[childId];
      });
    }

    // If this card is inside a column, remove it from the column
    if (card._inColumn) {
      const col = state.cards[card._inColumn];
      if (col && col.childCardIds) {
        col.childCardIds = col.childCardIds.filter(id => id !== cardId);
        renderCard(col);
      }
    }

    // Remove from selected
    state.selectedCardIds.delete(cardId);

    // Remove DOM element
    const el = document.getElementById(cardId);
    if (el) el.remove();

    delete state.cards[cardId];
    renderConnections();
    autoSave();
  }

  function deleteSubBoardRecursive(boardId) {
    const board = state.boards[boardId];
    if (!board) return;
    // Delete all cards in this board
    board.cardIds.forEach(cid => {
      const c = state.cards[cid];
      if (c && c.type === 'board' && c.linkedBoardId) {
        deleteSubBoardRecursive(c.linkedBoardId);
      }
      delete state.cards[cid];
    });
    delete state.boards[boardId];
  }

  function duplicateCard(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    const extra = { ...card };
    delete extra.id;
    delete extra.createdAt;
    delete extra.updatedAt;
    delete extra.zIndex;
    if (card.type === 'board') {
      extra.linkedBoardId = null;
      extra.name = (card.name || 'Quadro') + ' (cópia)';
    }
    createCard(card.type, card.x + 20, card.y + 20, extra);
  }

  function updateCard(cardId, updates) {
    const card = state.cards[cardId];
    if (!card) return;
    Object.assign(card, updates, { updatedAt: Date.now() });
    autoSave();
  }

  function bringToFront(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    card.zIndex = ++state.ui.maxZIndex;
    const el = document.getElementById(cardId);
    if (el) el.style.zIndex = card.zIndex;
  }

  function sendToBack(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    card.zIndex = 1;
    const el = document.getElementById(cardId);
    if (el) el.style.zIndex = 1;
  }

  // ============= CANVAS (Pan & Zoom) =============
  function updateCanvasTransform() {
    const { panX, panY, zoom } = state.canvas;
    dom.canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    dom.zoomLevel.textContent = Math.round(zoom * 100) + '%';

    // Update grid background
    const gridSize = 20 * zoom;
    dom.viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    dom.viewport.style.backgroundPosition = `${panX % gridSize}px ${panY % gridSize}px`;
  }

  function screenToCanvas(screenX, screenY) {
    const rect = dom.viewport.getBoundingClientRect();
    return {
      x: (screenX - rect.left - state.canvas.panX) / state.canvas.zoom,
      y: (screenY - rect.top - state.canvas.panY) / state.canvas.zoom
    };
  }

  function zoomTo(newZoom, centerX, centerY) {
    const oldZoom = state.canvas.zoom;
    newZoom = clamp(newZoom, 0.1, 3);

    if (centerX !== undefined && centerY !== undefined) {
      const rect = dom.viewport.getBoundingClientRect();
      const mouseCanvasX = (centerX - rect.left - state.canvas.panX) / oldZoom;
      const mouseCanvasY = (centerY - rect.top - state.canvas.panY) / oldZoom;
      state.canvas.panX = (centerX - rect.left) - mouseCanvasX * newZoom;
      state.canvas.panY = (centerY - rect.top) - mouseCanvasY * newZoom;
    }

    state.canvas.zoom = newZoom;
    updateCanvasTransform();
  }

  function fitZoom() {
    const board = getCurrentBoard();
    if (!board || board.cardIds.length === 0) {
      state.canvas.panX = 0;
      state.canvas.panY = 0;
      state.canvas.zoom = 1;
      updateCanvasTransform();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    board.cardIds.forEach(cid => {
      const c = state.cards[cid];
      if (!c) return;
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.width || 260));
      maxY = Math.max(maxY, c.y + (c.height || 200));
    });

    const vpRect = dom.viewport.getBoundingClientRect();
    const padding = 80;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const zoom = clamp(Math.min(vpRect.width / contentW, vpRect.height / contentH), 0.2, 1.5);

    state.canvas.zoom = zoom;
    state.canvas.panX = (vpRect.width - contentW * zoom) / 2 - (minX - padding) * zoom;
    state.canvas.panY = (vpRect.height - contentH * zoom) / 2 - (minY - padding) * zoom;
    updateCanvasTransform();
  }

  // ============= RENDERING =============
  function renderCurrentBoard() {
    // Clear canvas
    dom.canvas.querySelectorAll('.card').forEach(el => el.remove());
    dom.connectionsSvg.innerHTML = '';

    const board = getCurrentBoard();
    if (!board) return;

    // Update maxZIndex
    let maxZ = 10;
    board.cardIds.forEach(cid => {
      const c = state.cards[cid];
      if (c && c.zIndex > maxZ) maxZ = c.zIndex;
    });
    state.ui.maxZIndex = maxZ;

    // Render cards
    board.cardIds.forEach(cid => {
      const card = state.cards[cid];
      if (card && !card._inColumn) renderCard(card);
    });

    // Render connections
    renderConnections();

    // Update breadcrumb
    renderBreadcrumb();

    // Update canvas transform
    updateCanvasTransform();
  }

  function renderCard(card) {
    // Remove existing element if any
    const existing = document.getElementById(card.id);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = card.id;
    el.className = `card card-${card.type} card-new`;
    el.style.left = card.x + 'px';
    el.style.top = card.y + 'px';
    el.style.width = card.width + 'px';
    if (card.height && card.type !== 'note' && card.type !== 'todo' && card.type !== 'image') {
      el.style.height = card.height + 'px';
    }
    if (card.type === 'image') {
      el.style.background = 'transparent';
    } else {
      el.style.background = card.color;
    }
    el.style.zIndex = card.zIndex || 10;
    el.dataset.color = card.color;
    el.dataset.type = card.type;

    if (state.selectedCardIds.has(card.id)) {
      el.classList.add('selected');
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-delete';
    deleteBtn.innerHTML = '×';
    deleteBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      deleteCard(card.id);
    });
    el.appendChild(deleteBtn);

    // Connection points
    ['top', 'bottom', 'left', 'right'].forEach(pos => {
      const point = document.createElement('div');
      point.className = `connection-point ${pos}`;
      point.dataset.pos = pos;
      point.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (state.ui.isDrawingConnection) {
          // Finish the connection on this card/point
          finishConnection(card.id, pos);
        } else {
          startConnection(card.id, pos, e);
        }
      });
      el.appendChild(point);
    });

    // Resize handle (except boards)
    if (card.type !== 'board') {
      const resize = document.createElement('div');
      resize.className = 'resize-handle';
      resize.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startResize(card.id, e);
      });
      el.appendChild(resize);
    }

    // Type-specific content
    switch (card.type) {
      case 'note': renderNoteContent(el, card); break;
      case 'todo': renderTodoContent(el, card); break;
      case 'image': renderImageContent(el, card); break;
      case 'link': renderLinkContent(el, card); break;
      case 'column': renderColumnContent(el, card); break;
      case 'board': renderBoardContent(el, card); break;
    }

    dom.canvas.appendChild(el);

    // Remove animation class
    setTimeout(() => el.classList.remove('card-new'), 300);

    return el;
  }

  function renderNoteContent(el, card) {
    const content = document.createElement('div');
    content.className = 'card-content';
    content.contentEditable = 'false';
    content.innerHTML = card.content || '';
    content.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEditing(card.id);
    });
    content.addEventListener('input', () => {
      updateCard(card.id, { content: content.innerHTML });
    });
    content.addEventListener('blur', () => {
      stopEditing(card.id);
    });
    content.addEventListener('mouseup', () => {
      if (state.ui.editingCardId === card.id) {
        checkFormatToolbar();
      }
    });
    content.addEventListener('keyup', () => {
      if (state.ui.editingCardId === card.id) {
        checkFormatToolbar();
      }
    });
    el.appendChild(content);
  }

  function renderTodoContent(el, card) {
    // Header
    const header = document.createElement('div');
    header.className = 'card-header';
    header.contentEditable = 'false';
    header.textContent = card.title || '';
    header.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      header.contentEditable = 'true';
      header.focus();
      el.classList.add('editing');
    });
    header.addEventListener('input', () => {
      updateCard(card.id, { title: header.textContent });
    });
    header.addEventListener('blur', () => {
      header.contentEditable = 'false';
      el.classList.remove('editing');
    });
    el.appendChild(header);

    // Todo list
    const list = document.createElement('div');
    list.className = 'todo-list';
    renderTodoItems(list, card);
    el.appendChild(list);

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-todo-btn';
    addBtn.innerHTML = '+ Adicionar item';
    addBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      pushHistory();
      card.items.push({ id: uid(), text: '', done: false });
      updateCard(card.id, { items: card.items });
      renderTodoItems(list, card);
      // Focus the new item
      const inputs = list.querySelectorAll('.todo-text');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    });
    el.appendChild(addBtn);
  }

  function renderTodoItems(listEl, card) {
    listEl.innerHTML = '';
    card.items.forEach((item, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'todo-item' + (item.done ? ' done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.done;
      checkbox.addEventListener('change', () => {
        pushHistory();
        item.done = checkbox.checked;
        itemEl.classList.toggle('done', item.done);
        updateCard(card.id, { items: card.items });
      });

      const text = document.createElement('input');
      text.className = 'todo-text';
      text.type = 'text';
      text.value = item.text;
      text.placeholder = 'Nova tarefa...';
      text.addEventListener('input', () => {
        item.text = text.value;
        updateCard(card.id, { items: card.items });
      });
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          pushHistory();
          card.items.splice(idx + 1, 0, { id: uid(), text: '', done: false });
          updateCard(card.id, { items: card.items });
          renderTodoItems(listEl, card);
          const inputs = listEl.querySelectorAll('.todo-text');
          if (inputs[idx + 1]) inputs[idx + 1].focus();
        }
        if (e.key === 'Backspace' && text.value === '' && card.items.length > 1) {
          e.preventDefault();
          pushHistory();
          card.items.splice(idx, 1);
          updateCard(card.id, { items: card.items });
          renderTodoItems(listEl, card);
          const inputs = listEl.querySelectorAll('.todo-text');
          const focusIdx = Math.max(0, idx - 1);
          if (inputs[focusIdx]) inputs[focusIdx].focus();
        }
      });
      text.addEventListener('mousedown', (e) => e.stopPropagation());

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'todo-delete';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (card.items.length <= 1) return;
        pushHistory();
        card.items.splice(idx, 1);
        updateCard(card.id, { items: card.items });
        renderTodoItems(listEl, card);
      });

      itemEl.appendChild(checkbox);
      itemEl.appendChild(text);
      itemEl.appendChild(deleteBtn);
      listEl.appendChild(itemEl);
    });
  }

  function renderImageContent(el, card) {
    if (card.imageData) {
      const img = document.createElement('img');
      img.src = card.imageData;
      img.alt = 'Imagem';
      img.draggable = false;
      el.appendChild(img);
    } else {
      // Upload placeholder
      const placeholder = document.createElement('div');
      placeholder.className = 'image-placeholder';
      placeholder.innerHTML = '<span>📷 Clique para adicionar imagem</span>';
      placeholder.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.imageInput.dataset.cardId = card.id;
        dom.imageInput.click();
      });
      el.appendChild(placeholder);
    }
  }

  function renderLinkContent(el, card) {
    const preview = document.createElement('div');
    preview.className = 'link-preview';

    const icon = document.createElement('div');
    icon.className = 'link-icon';
    icon.textContent = '🔗';

    const info = document.createElement('div');
    info.className = 'link-info';

    const title = document.createElement('div');
    title.className = 'link-title';
    title.textContent = card.title || card.url || 'Link';

    const url = document.createElement('div');
    url.className = 'link-url';
    url.textContent = card.url || '';

    info.appendChild(title);
    info.appendChild(url);
    preview.appendChild(icon);
    preview.appendChild(info);

    preview.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (card.url) {
        window.open(card.url, '_blank', 'noopener');
      }
    });

    el.appendChild(preview);
  }

  function renderColumnContent(el, card) {
    if (!card.childCardIds) card.childCardIds = [];

    const header = document.createElement('div');
    header.className = 'column-header';
    header.contentEditable = 'false';
    header.textContent = card.title || '';
    header.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      header.contentEditable = 'true';
      header.focus();
      el.classList.add('editing');
    });
    header.addEventListener('input', () => {
      updateCard(card.id, { title: header.textContent });
    });
    header.addEventListener('blur', () => {
      header.contentEditable = 'false';
      el.classList.remove('editing');
    });
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'column-body';

    // Allow dropping column items onto body (append to end)
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const data = e.dataTransfer.getData('column-item');
      if (!data) return;
      const { childId: draggedId, fromColumnId } = JSON.parse(data);
      pushHistory();
      reorderColumnItem(card.id, draggedId, fromColumnId, card.childCardIds.length);
    });

    // Render child notes inside the column
    renderColumnChildren(body, card);

    // Add note button
    const addBtn = document.createElement('button');
    addBtn.className = 'column-add-btn';
    addBtn.innerHTML = '+ Adicionar nota';
    addBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addNoteToColumn(card.id);
    });
    body.appendChild(addBtn);

    el.appendChild(body);
  }

  function renderColumnChildren(body, columnCard) {
    // Clean only child items, keep the add button
    body.querySelectorAll('.column-item').forEach(el => el.remove());

    // Filter out any deleted children
    columnCard.childCardIds = (columnCard.childCardIds || []).filter(id => state.cards[id]);

    columnCard.childCardIds.forEach((childId, idx) => {
      const child = state.cards[childId];
      if (!child) return;

      const item = document.createElement('div');
      item.className = 'column-item';
      item.dataset.childId = childId;
      item.dataset.index = idx;
      if (child.color && child.color !== '#ffffff') {
        item.style.background = child.color;
      }

      const content = document.createElement('div');
      content.className = 'column-item-content';
      content.contentEditable = 'false';
      content.innerHTML = child.content || '';
      content.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        content.contentEditable = 'true';
        content.focus();
        item.classList.add('editing');
      });
      content.addEventListener('input', () => {
        updateCard(childId, { content: content.innerHTML });
      });
      content.addEventListener('blur', () => {
        content.contentEditable = 'false';
        item.classList.remove('editing');
      });
      content.addEventListener('mousedown', (e) => {
        if (content.contentEditable === 'true') e.stopPropagation();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'column-item-delete';
      deleteBtn.innerHTML = '×';
      deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        removeNoteFromColumn(columnCard.id, childId);
      });

      item.appendChild(content);
      item.appendChild(deleteBtn);

      // Drag to reorder within column
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('column-item', JSON.stringify({ childId, fromColumnId: columnCard.id, index: idx }));
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drag-over');
        const data = e.dataTransfer.getData('column-item');
        if (!data) return;
        const { childId: draggedId, fromColumnId } = JSON.parse(data);
        pushHistory();
        reorderColumnItem(columnCard.id, draggedId, fromColumnId, idx);
      });

      body.appendChild(item);
    });
  }

  function addNoteToColumn(columnId) {
    pushHistory();
    const noteId = uid();
    const noteCard = {
      id: noteId,
      type: 'note',
      boardId: state.currentBoardId,
      x: 0, y: 0,
      color: '#ffffff',
      zIndex: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      width: 240,
      content: '',
      _inColumn: columnId
    };
    state.cards[noteId] = noteCard;
    const col = state.cards[columnId];
    if (!col.childCardIds) col.childCardIds = [];
    col.childCardIds.push(noteId);
    renderCard(col);
    autoSave();
  }

  function removeNoteFromColumn(columnId, noteId) {
    const col = state.cards[columnId];
    if (!col || !col.childCardIds) return;
    col.childCardIds = col.childCardIds.filter(id => id !== noteId);
    // Delete the note card data
    delete state.cards[noteId];
    renderCard(col);
    autoSave();
  }

  function reorderColumnItem(toColumnId, draggedId, fromColumnId, toIndex) {
    // Remove from source
    const fromCol = state.cards[fromColumnId];
    if (fromCol && fromCol.childCardIds) {
      fromCol.childCardIds = fromCol.childCardIds.filter(id => id !== draggedId);
    }
    // Add to target
    const toCol = state.cards[toColumnId];
    if (!toCol.childCardIds) toCol.childCardIds = [];
    toCol.childCardIds.splice(toIndex, 0, draggedId);
    // Update note's column ref
    const note = state.cards[draggedId];
    if (note) note._inColumn = toColumnId;
    // Re-render both columns
    if (fromCol && fromColumnId !== toColumnId) renderCard(fromCol);
    renderCard(toCol);
    autoSave();
  }

  function detachNoteFromColumn(noteId) {
    const note = state.cards[noteId];
    if (!note || !note._inColumn) return null;
    const col = state.cards[note._inColumn];
    if (col && col.childCardIds) {
      col.childCardIds = col.childCardIds.filter(id => id !== noteId);
      renderCard(col);
    }
    const oldCol = note._inColumn;
    delete note._inColumn;
    return oldCol;
  }

  function tryDropIntoColumn(noteId, e) {
    const note = state.cards[noteId];
    if (!note || note.type !== 'note') return false;
    // Don't drop if already in a column (handled separately)
    if (note._inColumn) return false;

    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    const board = getCurrentBoard();
    if (!board) return false;

    for (const cid of board.cardIds) {
      const col = state.cards[cid];
      if (!col || col.type !== 'column' || cid === noteId) continue;
      // Check if note center is inside column bounds
      const colEl = document.getElementById(cid);
      if (!colEl) continue;
      const colX = col.x;
      const colY = col.y;
      const colW = colEl.offsetWidth;
      const colH = colEl.offsetHeight;
      if (canvasPos.x >= colX && canvasPos.x <= colX + colW &&
          canvasPos.y >= colY && canvasPos.y <= colY + colH) {
        // Drop into column
        pushHistory();
        note._inColumn = cid;
        if (!col.childCardIds) col.childCardIds = [];
        col.childCardIds.push(noteId);
        // Remove from board's visible cards but keep in cardIds for data
        const el = document.getElementById(noteId);
        if (el) el.remove();
        renderCard(col);
        autoSave();
        return true;
      }
    }
    return false;
  }

  function renderBoardContent(el, card) {
    const preview = document.createElement('div');
    preview.className = 'board-preview';

    // If board has a cover image, show it
    if (card.coverImage) {
      const coverImg = document.createElement('img');
      coverImg.src = card.coverImage;
      coverImg.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;';
      coverImg.draggable = false;
      preview.appendChild(coverImg);
    } else {
      // Show mini-cards preview
      const miniCards = document.createElement('div');
      miniCards.className = 'mini-cards';
      const linkedBoard = state.boards[card.linkedBoardId];
      if (linkedBoard) {
        const count = Math.min(linkedBoard.cardIds.length, 8);
        for (let i = 0; i < count; i++) {
          const mini = document.createElement('div');
          mini.className = 'mini-card';
          miniCards.appendChild(mini);
        }
      }
      if (miniCards.children.length === 0) {
        preview.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>';
      } else {
        preview.appendChild(miniCards);
      }
    }

    el.appendChild(preview);

    // Allow dropping images onto board preview
    preview.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      preview.style.outline = '2px dashed var(--accent)';
    });
    preview.addEventListener('dragleave', () => {
      preview.style.outline = '';
    });
    preview.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      preview.style.outline = '';
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        processImageFile(files[0], (dataUrl) => {
          pushHistory();
          updateCard(card.id, { coverImage: dataUrl });
          renderCard(state.cards[card.id]);
        });
      }
    });

    // Double click to navigate into board
    preview.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (card.linkedBoardId) {
        navigateToBoard(card.linkedBoardId);
      }
    });

    const name = document.createElement('div');
    name.className = 'board-name';
    name.contentEditable = 'false';
    name.textContent = card.name || '';
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      name.contentEditable = 'true';
      name.focus();
      el.classList.add('editing');
    });
    name.addEventListener('input', () => {
      updateCard(card.id, { name: name.textContent });
      if (card.linkedBoardId && state.boards[card.linkedBoardId]) {
        state.boards[card.linkedBoardId].name = name.textContent;
      }
    });
    name.addEventListener('blur', () => {
      name.contentEditable = 'false';
      el.classList.remove('editing');
    });
    el.appendChild(name);
  }

  // ============= BREADCRUMB =============
  function renderBreadcrumb() {
    dom.breadcrumb.innerHTML = '';
    const path = getBoardPath(state.currentBoardId);
    path.forEach((board, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'separator';
        sep.textContent = '›';
        dom.breadcrumb.appendChild(sep);
      }
      const crumb = document.createElement('span');
      crumb.className = 'crumb' + (i === path.length - 1 ? ' current' : '');
      crumb.textContent = board.name || 'Quadro';
      if (i < path.length - 1) {
        crumb.addEventListener('click', () => navigateToBoard(board.id));
      }
      dom.breadcrumb.appendChild(crumb);
    });
  }

  // ============= CONNECTIONS =============

  // Default arrow colors
  const ARROW_COLORS = [
    { name: 'Cinza', value: '#888888' },
    { name: 'Preto', value: '#333333' },
    { name: 'Vermelho', value: '#e74c3c' },
    { name: 'Laranja', value: '#f39c12' },
    { name: 'Amarelo', value: '#f1c40f' },
    { name: 'Verde', value: '#2ecc71' },
    { name: 'Azul', value: '#3498db' },
    { name: 'Roxo', value: '#9b59b6' },
    { name: 'Rosa', value: '#e91e8a' },
    { name: 'Branco', value: '#cccccc' }
  ];

  function createArrowMarker(defs, color) {
    const markerId = 'arrowhead-' + color.replace('#', '');
    if (defs.querySelector('#' + markerId)) return markerId;
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
    defs.appendChild(marker);
    return markerId;
  }

  function getControlPointOffset(pos) {
    switch (pos) {
      case 'top': return { dx: 0, dy: -1 };
      case 'bottom': return { dx: 0, dy: 1 };
      case 'left': return { dx: -1, dy: 0 };
      case 'right': return { dx: 1, dy: 0 };
      default: return { dx: 1, dy: 0 };
    }
  }

  function buildCurvePath(from, to, fromPos, toPos) {
    const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    const tension = clamp(dist * 0.4, 40, 250);
    const fromDir = getControlPointOffset(fromPos);
    const toDir = getControlPointOffset(toPos);
    const cp1x = from.x + fromDir.dx * tension;
    const cp1y = from.y + fromDir.dy * tension;
    const cp2x = to.x + toDir.dx * tension;
    const cp2y = to.y + toDir.dy * tension;
    return `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;
  }

  function renderConnections() {
    dom.connectionsSvg.innerHTML = '';
    const board = getCurrentBoard();
    if (!board) return;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    dom.connectionsSvg.appendChild(defs);

    board.connections.forEach(conn => {
      const fromCard = state.cards[conn.fromCardId];
      const toCard = state.cards[conn.toCardId];
      if (!fromCard || !toCard) return;

      const fromEl = document.getElementById(conn.fromCardId);
      const toEl = document.getElementById(conn.toCardId);
      if (!fromEl || !toEl) return;

      const fromPos = conn.fromPos || 'right';
      const toPos = conn.toPos || 'left';
      const from = getConnectionPoint(fromCard, fromEl, fromPos);
      const to = getConnectionPoint(toCard, toEl, toPos);
      const color = conn.color || '#888888';
      const markerId = createArrowMarker(defs, color);

      const curvePath = buildCurvePath(from, to, fromPos, toPos);

      // Invisible wider hit-area path for easier clicking
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitArea.setAttribute('d', curvePath);
      hitArea.setAttribute('class', 'connection-hit-area');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '30');
      hitArea.setAttribute('fill', 'none');
      hitArea.dataset.connectionId = conn.id;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', curvePath);
      path.setAttribute('class', 'connection-line');
      path.setAttribute('stroke', color);
      path.setAttribute('marker-end', `url(#${markerId})`);
      path.dataset.connectionId = conn.id;

      // Event handlers on the hit area (wider target)
      function onContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        showConnectionColorPicker(conn.id, e.clientX, e.clientY);
      }
      function onDblClick(e) {
        e.stopPropagation();
        pushHistory();
        board.connections = board.connections.filter(c => c.id !== conn.id);
        renderConnections();
        autoSave();
        showToast('Conexão removida');
      }

      hitArea.addEventListener('contextmenu', onContextMenu);
      hitArea.addEventListener('dblclick', onDblClick);
      path.addEventListener('contextmenu', onContextMenu);
      path.addEventListener('dblclick', onDblClick);

      // Hover effect: highlight visible line when hovering hit area
      hitArea.addEventListener('mouseenter', () => path.classList.add('hover'));
      hitArea.addEventListener('mouseleave', () => path.classList.remove('hover'));

      dom.connectionsSvg.appendChild(hitArea);
      dom.connectionsSvg.appendChild(path);
    });
  }

  function showConnectionColorPicker(connId, x, y) {
    hideAllMenus();
    const picker = dom.connColorPicker;
    picker.innerHTML = '';
    ARROW_COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.style.background = c.value;
      btn.title = c.name;
      btn.dataset.color = c.value;
      btn.addEventListener('click', () => {
        pushHistory();
        const board = getCurrentBoard();
        const conn = board.connections.find(cn => cn.id === connId);
        if (conn) {
          conn.color = c.value;
          renderConnections();
          autoSave();
        }
        picker.classList.add('hidden');
      });
      picker.appendChild(btn);
    });
    picker.classList.remove('hidden');
    picker.style.left = x + 'px';
    picker.style.top = y + 'px';
    // Keep within viewport
    requestAnimationFrame(() => {
      const rect = picker.getBoundingClientRect();
      if (rect.right > window.innerWidth) picker.style.left = (x - rect.width) + 'px';
      if (rect.bottom > window.innerHeight) picker.style.top = (y - rect.height) + 'px';
    });
  }

  function getConnectionPoint(card, el, pos) {
    const x = card.x;
    const y = card.y;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    switch (pos) {
      case 'top': return { x: x + w / 2, y: y };
      case 'bottom': return { x: x + w / 2, y: y + h };
      case 'left': return { x: x, y: y + h / 2 };
      case 'right': return { x: x + w, y: y + h / 2 };
      default: return { x: x + w / 2, y: y + h / 2 };
    }
  }

  function startConnection(cardId, pos, e) {
    state.ui.isDrawingConnection = true;
    state.ui.connectionStartCardId = cardId;
    state.ui.connectionStartPos = pos;
    dom.viewport.classList.add('crosshair');
    dom.app.classList.add('arrow-mode');
    e.preventDefault();
  }

  function updateTempConnection(e) {
    // Remove existing temp line
    const existing = dom.connectionsSvg.querySelector('.temp-connection');
    if (existing) existing.remove();

    const fromCard = state.cards[state.ui.connectionStartCardId];
    if (!fromCard) return;
    const fromEl = document.getElementById(state.ui.connectionStartCardId);
    if (!fromEl) return;

    const fromPos = state.ui.connectionStartPos;
    const from = getConnectionPoint(fromCard, fromEl, fromPos);
    const to = screenToCanvas(e.clientX, e.clientY);

    // Guess a reasonable 'toPos' as opposite direction toward source
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const toPos = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', buildCurvePath(from, to, fromPos, toPos));
    path.setAttribute('class', 'temp-connection');
    dom.connectionsSvg.appendChild(path);
  }

  function finishConnection(targetCardId, targetPos) {
    const fromId = state.ui.connectionStartCardId;
    if (fromId === targetCardId) return cancelConnection();

    pushHistory();
    const board = getCurrentBoard();
    board.connections.push({
      id: uid(),
      fromCardId: fromId,
      toCardId: targetCardId,
      fromPos: state.ui.connectionStartPos,
      toPos: targetPos || 'left'
    });

    // Reset drawing state
    state.ui.isDrawingConnection = false;
    state.ui.connectionStartCardId = null;
    state.ui.connectionStartPos = null;
    const temp = dom.connectionsSvg.querySelector('.temp-connection');
    if (temp) temp.remove();

    // Keep arrow-mode if the tool is active so user can chain connections
    if (state.ui.activeTool !== 'arrow') {
      dom.viewport.classList.remove('crosshair');
      dom.app.classList.remove('arrow-mode');
    }

    renderConnections();
    autoSave();
    showToast('✅ Conexão criada!');
  }

  function cancelConnection() {
    state.ui.isDrawingConnection = false;
    state.ui.connectionStartCardId = null;
    state.ui.connectionStartPos = null;
    dom.viewport.classList.remove('crosshair');
    dom.app.classList.remove('arrow-mode');
    const temp = dom.connectionsSvg.querySelector('.temp-connection');
    if (temp) temp.remove();
  }

  // ============= EDITING =============
  function startEditing(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    state.ui.editingCardId = cardId;
    const el = document.getElementById(cardId);
    if (!el) return;
    el.classList.add('editing');

    if (card.type === 'note') {
      const content = el.querySelector('.card-content');
      if (content) {
        content.contentEditable = 'true';
        content.focus();
        // Place cursor at end
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  function stopEditing(cardId) {
    state.ui.editingCardId = null;
    const el = document.getElementById(cardId);
    if (!el) return;
    el.classList.remove('editing');

    const card = state.cards[cardId];
    if (card && card.type === 'note') {
      const content = el.querySelector('.card-content');
      if (content) {
        content.contentEditable = 'false';
      }
    }
    hideFormatToolbar();
  }

  // ============= FORMAT TOOLBAR =============
  function checkFormatToolbar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideFormatToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0) {
      hideFormatToolbar();
      return;
    }

    dom.formatToolbar.classList.remove('hidden');
    dom.formatToolbar.style.left = (rect.left + rect.width / 2 - dom.formatToolbar.offsetWidth / 2) + 'px';
    dom.formatToolbar.style.top = (rect.top - dom.formatToolbar.offsetHeight - 8) + 'px';

    // Update active states
    dom.formatToolbar.querySelectorAll('button').forEach(btn => {
      const fmt = btn.dataset.fmt;
      if (fmt && !fmt.startsWith('formatBlock')) {
        btn.classList.toggle('active', document.queryCommandState(fmt));
      }
    });
  }

  function hideFormatToolbar() {
    dom.formatToolbar.classList.add('hidden');
  }

  function applyFormat(format) {
    if (format.startsWith('formatBlock-')) {
      const tag = format.split('-')[1];
      document.execCommand('formatBlock', false, tag);
    } else {
      document.execCommand(format, false);
    }
    // Save changes
    if (state.ui.editingCardId) {
      const el = document.getElementById(state.ui.editingCardId);
      const content = el && el.querySelector('.card-content');
      if (content) {
        updateCard(state.ui.editingCardId, { content: content.innerHTML });
      }
    }
  }

  // ============= SELECTION =============
  function selectCard(cardId, additive = false) {
    if (!additive) {
      state.selectedCardIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('selected');
      });
      state.selectedCardIds.clear();
    }

    state.selectedCardIds.add(cardId);
    const el = document.getElementById(cardId);
    if (el) el.classList.add('selected');
    bringToFront(cardId);
  }

  function deselectAll() {
    state.selectedCardIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('selected');
    });
    state.selectedCardIds.clear();
    if (state.ui.editingCardId) {
      stopEditing(state.ui.editingCardId);
    }
  }

  function selectCardsInRect(rect) {
    const board = getCurrentBoard();
    if (!board) return;

    board.cardIds.forEach(cid => {
      const card = state.cards[cid];
      if (!card) return;
      const el = document.getElementById(cid);
      if (!el) return;

      const cardRect = {
        x: card.x,
        y: card.y,
        w: el.offsetWidth,
        h: el.offsetHeight
      };

      const overlaps = !(
        cardRect.x + cardRect.w < rect.x ||
        cardRect.x > rect.x + rect.w ||
        cardRect.y + cardRect.h < rect.y ||
        cardRect.y > rect.y + rect.h
      );

      if (overlaps) {
        state.selectedCardIds.add(cid);
        el.classList.add('selected');
      }
    });
  }

  // ============= DRAG & DROP =============
  function startDrag(cardId, e) {
    if (state.ui.editingCardId === cardId) return;
    state.ui.isDragging = true;

    // Calculate offsets for all selected cards
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    state.ui.dragStart = canvasPos;

    const offsets = {};
    state.selectedCardIds.forEach(id => {
      const c = state.cards[id];
      if (c) {
        offsets[id] = { dx: c.x - canvasPos.x, dy: c.y - canvasPos.y };
      }
    });
    state.ui.dragCardOffsets = offsets;

    // Add dragging class
    state.selectedCardIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('dragging');
    });
  }

  function doDrag(e) {
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    const offsets = state.ui.dragCardOffsets;

    state.selectedCardIds.forEach(id => {
      const card = state.cards[id];
      const el = document.getElementById(id);
      if (!card || !el || !offsets[id]) return;

      let newX = canvasPos.x + offsets[id].dx;
      let newY = canvasPos.y + offsets[id].dy;
      if (state.ui.snapping) {
        const gridSize = 20;
        newX = Math.round(newX / gridSize) * gridSize;
        newY = Math.round(newY / gridSize) * gridSize;
      }
      card.x = newX;
      card.y = newY;
      el.style.left = card.x + 'px';
      el.style.top = card.y + 'px';
    });

    renderConnections();
  }

  function stopDrag(e) {
    if (!state.ui.isDragging) return;
    state.ui.isDragging = false;
    state.ui.dragCardOffsets = null;

    state.selectedCardIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('dragging');
    });

    // Check if a single note was dropped onto a column
    if (e && state.selectedCardIds.size === 1) {
      const noteId = [...state.selectedCardIds][0];
      if (tryDropIntoColumn(noteId, e)) {
        deselectAll();
        return;
      }
    }

    pushHistory();
    autoSave();
  }

  // ============= RESIZE =============
  function startResize(cardId, e) {
    state.ui.isResizing = true;
    state.ui.resizeCardId = cardId;
    const card = state.cards[cardId];
    const el = document.getElementById(cardId);
    state.ui.resizeStart = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: el.offsetWidth,
      height: el.offsetHeight
    };
    e.preventDefault();
  }

  function doResize(e) {
    const card = state.cards[state.ui.resizeCardId];
    const el = document.getElementById(state.ui.resizeCardId);
    if (!card || !el) return;

    const rs = state.ui.resizeStart;
    const dx = (e.clientX - rs.mouseX) / state.canvas.zoom;
    const dy = (e.clientY - rs.mouseY) / state.canvas.zoom;

    const newWidth = Math.max(120, rs.width + dx);
    const newHeight = Math.max(60, rs.height + dy);

    card.width = newWidth;
    el.style.width = newWidth + 'px';

    if (card.type === 'column') {
      card.height = newHeight;
      el.style.height = newHeight + 'px';
    }
  }

  function stopResize() {
    if (!state.ui.isResizing) return;
    state.ui.isResizing = false;
    state.ui.resizeCardId = null;
    state.ui.resizeStart = null;
    pushHistory();
    autoSave();
    renderConnections();
  }

  // ============= SEARCH =============
  function performSearch(query) {
    // Remove existing highlights
    document.querySelectorAll('.card.search-match').forEach(el => el.classList.remove('search-match'));

    if (!query.trim()) return;

    const board = getCurrentBoard();
    if (!board) return;
    const q = query.toLowerCase();

    board.cardIds.forEach(cid => {
      const card = state.cards[cid];
      if (!card) return;

      let match = false;
      if (card.type === 'note' && card.content && card.content.toLowerCase().includes(q)) match = true;
      if (card.type === 'todo' && card.title && card.title.toLowerCase().includes(q)) match = true;
      if (card.type === 'todo' && card.items && card.items.some(i => i.text.toLowerCase().includes(q))) match = true;
      if (card.type === 'link' && (card.title || '').toLowerCase().includes(q)) match = true;
      if (card.type === 'link' && (card.url || '').toLowerCase().includes(q)) match = true;
      if (card.type === 'column' && (card.title || '').toLowerCase().includes(q)) match = true;
      if (card.type === 'board' && (card.name || '').toLowerCase().includes(q)) match = true;
      if (card.type === 'image' && (card.caption || '').toLowerCase().includes(q)) match = true;

      const el = document.getElementById(cid);
      if (el && match) el.classList.add('search-match');
    });
  }

  // ============= MODAL =============
  function showModal(title, bodyHTML, onConfirm) {
    dom.modalTitle.textContent = title;
    dom.modalBody.innerHTML = bodyHTML;
    dom.modalOverlay.classList.remove('hidden');

    const confirmHandler = () => {
      onConfirm();
      hideModal();
      dom.modalConfirm.removeEventListener('click', confirmHandler);
    };
    dom.modalConfirm.addEventListener('click', confirmHandler);

    // Focus first input
    setTimeout(() => {
      const input = dom.modalBody.querySelector('input');
      if (input) input.focus();
    }, 100);
  }

  function hideModal() {
    dom.modalOverlay.classList.add('hidden');
  }

  // ============= CONTEXT MENUS =============
  function showContextMenu(menu, x, y) {
    hideAllMenus();
    menu.classList.remove('hidden');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Keep within viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (y - rect.height) + 'px';
    }
  }

  function hideAllMenus() {
    dom.contextMenu.classList.add('hidden');
    dom.cardContextMenu.classList.add('hidden');
    dom.colorPicker.classList.add('hidden');
    dom.connColorPicker.classList.add('hidden');
  }

  // ============= IMAGE HANDLING =============
  function processImageFile(file, callback) {
    const isGif = file.type === 'image/gif';
    const reader = new FileReader();
    reader.onload = (e) => {
      if (isGif) {
        // Preserve GIF as-is to keep animation
        callback(e.target.result);
        return;
      }
      // Resize static images to save space
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round(h * maxDim / w);
            w = maxDim;
          } else {
            w = Math.round(w * maxDim / h);
            h = maxDim;
          }
        }
        const cnv = document.createElement('canvas');
        cnv.width = w;
        cnv.height = h;
        const ctx = cnv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // Use PNG for images with transparency, JPEG for others
        const isPng = file.type === 'image/png';
        callback(cnv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ============= ADD CARD FROM TOOL =============
  function addCardFromTool(type) {
    const vpRect = dom.viewport.getBoundingClientRect();
    const centerScreen = {
      x: vpRect.left + vpRect.width / 2,
      y: vpRect.top + vpRect.height / 2
    };
    const canvasPos = screenToCanvas(centerScreen.x, centerScreen.y);

    // Offset slightly randomly so cards don't stack perfectly
    canvasPos.x += (Math.random() - 0.5) * 40;
    canvasPos.y += (Math.random() - 0.5) * 40;

    switch (type) {
      case 'note':
        createCard('note', canvasPos.x - 130, canvasPos.y - 40);
        break;
      case 'todo':
        createCard('todo', canvasPos.x - 130, canvasPos.y - 60);
        break;
      case 'image':
        dom.imageInput.dataset.cardId = '';
        dom.imageInput.click();
        break;
      case 'link':
        showModal('Adicionar Link',
          '<label>URL</label><input type="url" id="link-url-input" placeholder="https://exemplo.com">' +
          '<label>Título (opcional)</label><input type="text" id="link-title-input" placeholder="Título do link">',
          () => {
            const url = document.getElementById('link-url-input').value.trim();
            const title = document.getElementById('link-title-input').value.trim();
            if (url) {
              createCard('link', canvasPos.x - 130, canvasPos.y - 30, { url, title: title || url });
            }
          }
        );
        break;
      case 'column':
        createCard('column', canvasPos.x - 140, canvasPos.y - 200);
        break;
      case 'board':
        showModal('Novo Quadro',
          '<label>Nome do quadro</label><input type="text" id="board-name-input" placeholder="Meu novo quadro">',
          () => {
            const name = document.getElementById('board-name-input').value.trim() || 'Novo Quadro';
            createCard('board', canvasPos.x - 100, canvasPos.y - 80, { name });
          }
        );
        break;
      case 'arrow':
        state.ui.activeTool = state.ui.activeTool === 'arrow' ? null : 'arrow';
        updateActiveToolUI();
        if (state.ui.activeTool === 'arrow') {
          dom.viewport.classList.add('crosshair');
          dom.app.classList.add('arrow-mode');
          showToast('🔗 Clique em um ponto de conexão de um card, depois em outro card.');
        } else {
          dom.viewport.classList.remove('crosshair');
          dom.app.classList.remove('arrow-mode');
          cancelConnection();
        }
        return;
    }

    // Reset tool
    if (type !== 'arrow') {
      state.ui.activeTool = null;
      updateActiveToolUI();
    }
  }

  function addCardAtPosition(type, x, y) {
    const canvasPos = screenToCanvas(x, y);
    switch (type) {
      case 'note':
        createCard('note', canvasPos.x - 130, canvasPos.y - 20);
        break;
      case 'todo':
        createCard('todo', canvasPos.x - 130, canvasPos.y - 20);
        break;
      case 'image':
        dom.imageInput.dataset.cardId = '';
        dom.imageInput.dataset.posX = canvasPos.x - 140;
        dom.imageInput.dataset.posY = canvasPos.y - 20;
        dom.imageInput.click();
        break;
      case 'link':
        showModal('Adicionar Link',
          '<label>URL</label><input type="url" id="link-url-input" placeholder="https://exemplo.com">' +
          '<label>Título (opcional)</label><input type="text" id="link-title-input" placeholder="Título do link">',
          () => {
            const url = document.getElementById('link-url-input').value.trim();
            const title = document.getElementById('link-title-input').value.trim();
            if (url) createCard('link', canvasPos.x - 130, canvasPos.y - 20, { url, title: title || url });
          }
        );
        break;
      case 'column':
        createCard('column', canvasPos.x - 140, canvasPos.y - 20);
        break;
      case 'board':
        showModal('Novo Quadro',
          '<label>Nome do quadro</label><input type="text" id="board-name-input" placeholder="Meu novo quadro">',
          () => {
            const name = document.getElementById('board-name-input').value.trim() || 'Novo Quadro';
            createCard('board', canvasPos.x - 100, canvasPos.y - 20, { name });
          }
        );
        break;
    }
  }

  function updateActiveToolUI() {
    $$('.tool-btn').forEach(btn => btn.classList.remove('active'));
    if (state.ui.activeTool) {
      const btn = $(`.tool-btn[data-tool="${state.ui.activeTool}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  // ============= EVENT HANDLERS =============
  function initEvents() {
    // --- Sidebar tools ---
    const toolLabels = {
      note: '📝 Nota',
      todo: '✅ Tarefas',
      image: '🖼️ Imagem',
      link: '🔗 Link',
      column: '📊 Coluna',
      board: '📋 Quadro'
    };

    $$('.sidebar-tools .tool-btn').forEach(btn => {
      const tool = btn.dataset.tool;
      if (!tool || tool === 'arrow') {
        // Arrow tool: click only
        btn.addEventListener('click', () => {
          if (tool) addCardFromTool(tool);
        });
        return;
      }

      // Make draggable
      btn.setAttribute('draggable', 'true');

      btn.addEventListener('click', () => {
        addCardFromTool(tool);
      });

      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', tool);
        e.dataTransfer.effectAllowed = 'copy';
        // Custom ghost
        const ghost = document.createElement('div');
        ghost.className = 'sidebar-drag-ghost';
        ghost.textContent = toolLabels[tool] || tool;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
        setTimeout(() => ghost.remove(), 0);
      });
    });

    // --- Canvas accepts drops from sidebar ---
    dom.viewport.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    dom.viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      const tool = e.dataTransfer.getData('text/plain');
      const validTools = ['note', 'todo', 'image', 'link', 'column', 'board'];

      if (validTools.includes(tool)) {
        // Dropped from sidebar
        addCardAtPosition(tool, e.clientX, e.clientY);
        return;
      }

      // Image file drops
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        files.forEach((file, idx) => {
          processImageFile(file, (dataUrl) => {
            const canvasPos = screenToCanvas(e.clientX + idx * 30, e.clientY + idx * 30);
            createCard('image', canvasPos.x - 140, canvasPos.y - 80, { imageData: dataUrl });
          });
        });
      }
    });

    // --- Dark mode ---
    $('#dark-mode-btn').addEventListener('click', toggleDarkMode);

    // --- Snap toggle ---
    const snapToggle = $('#snap-toggle');
    if (snapToggle) {
      snapToggle.addEventListener('click', () => {
        state.ui.snapping = !state.ui.snapping;
        snapToggle.classList.toggle('active', state.ui.snapping);
        showToast(state.ui.snapping ? '🧲 Snapping ativado' : 'Snapping desativado');
      });
    }

    // --- Export/Import ---
    $('#export-btn').addEventListener('click', exportData);
    $('#import-btn').addEventListener('click', () => dom.importInput.click());
    dom.importInput.addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = '';
    });

    // --- Image input ---
    dom.imageInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      const existingCardId = dom.imageInput.dataset.cardId;
      const boardCoverId = dom.imageInput.dataset.boardCoverId;
      const posX = parseFloat(dom.imageInput.dataset.posX) || undefined;
      const posY = parseFloat(dom.imageInput.dataset.posY) || undefined;

      files.forEach(file => {
        processImageFile(file, (dataUrl) => {
          if (boardCoverId && state.cards[boardCoverId]) {
            // Set as board cover image
            pushHistory();
            updateCard(boardCoverId, { coverImage: dataUrl });
            renderCard(state.cards[boardCoverId]);
          } else if (existingCardId && state.cards[existingCardId]) {
            pushHistory();
            updateCard(existingCardId, { imageData: dataUrl });
            renderCard(state.cards[existingCardId]);
          } else {
            const vpRect = dom.viewport.getBoundingClientRect();
            const cx = posX !== undefined ? posX : screenToCanvas(vpRect.left + vpRect.width / 2, 0).x - 140;
            const cy = posY !== undefined ? posY : screenToCanvas(0, vpRect.top + vpRect.height / 2).y - 100;
            createCard('image', cx, cy, { imageData: dataUrl });
          }
        });
      });

      dom.imageInput.dataset.cardId = '';
      dom.imageInput.dataset.boardCoverId = '';
      dom.imageInput.dataset.posX = '';
      dom.imageInput.dataset.posY = '';
      e.target.value = '';
    });

    // --- Undo/Redo buttons ---
    dom.undoBtn.addEventListener('click', undo);
    dom.redoBtn.addEventListener('click', redo);

    // --- Zoom buttons ---
    $('#zoom-in-btn').addEventListener('click', () => {
      const vpRect = dom.viewport.getBoundingClientRect();
      zoomTo(state.canvas.zoom + 0.1, vpRect.left + vpRect.width / 2, vpRect.top + vpRect.height / 2);
    });
    $('#zoom-out-btn').addEventListener('click', () => {
      const vpRect = dom.viewport.getBoundingClientRect();
      zoomTo(state.canvas.zoom - 0.1, vpRect.left + vpRect.width / 2, vpRect.top + vpRect.height / 2);
    });
    $('#zoom-fit-btn').addEventListener('click', fitZoom);
    dom.zoomLevel.addEventListener('click', () => {
      state.canvas.zoom = 1;
      updateCanvasTransform();
    });

    // --- Search ---
    dom.searchInput.addEventListener('input', debounce(() => {
      performSearch(dom.searchInput.value);
    }, 300));

    // --- Canvas viewport events ---
    dom.viewport.addEventListener('mousedown', onViewportMouseDown);
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mouseup', onDocumentMouseUp);
    dom.viewport.addEventListener('wheel', onViewportWheel, { passive: false });
    dom.viewport.addEventListener('dblclick', onViewportDblClick);
    dom.viewport.addEventListener('contextmenu', onViewportContextMenu);

    // --- Context menu actions ---
    dom.contextMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      hideAllMenus();
      if (action === 'paste') pasteClipboard();
      else if (action === 'select-all') selectAllCards();
      else if (action && action.startsWith('add-')) {
        const type = action.replace('add-', '');
        addCardAtPosition(type, state.ui._contextMenuX, state.ui._contextMenuY);
      }
    });

    dom.cardContextMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const cardId = state.ui.contextMenuCardId;
      hideAllMenus();

      switch (action) {
        case 'edit':
          startEditing(cardId);
          break;
        case 'duplicate':
          duplicateCard(cardId);
          break;
        case 'color':
          showColorPicker(cardId);
          break;
        case 'copy':
          copyCards();
          break;
        case 'bring-front':
          bringToFront(cardId);
          pushHistory();
          autoSave();
          break;
        case 'send-back':
          sendToBack(cardId);
          pushHistory();
          autoSave();
          break;
        case 'add-cover':
          dom.imageInput.dataset.cardId = '';
          dom.imageInput.dataset.boardCoverId = cardId;
          dom.imageInput.click();
          break;
        case 'delete':
          deleteCard(cardId);
          break;
      }
    });

    // --- Color picker ---
    dom.colorPicker.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      const color = swatch.dataset.color;
      hideAllMenus();

      pushHistory();
      state.selectedCardIds.forEach(id => {
        const card = state.cards[id];
        const el = document.getElementById(id);
        if (card && el) {
          card.color = color;
          if (card.type === 'image') {
            el.style.background = 'transparent';
          } else {
            el.style.background = color;
          }
          el.dataset.color = color;
        }
      });
      autoSave();
    });

    // --- Format toolbar ---
    dom.formatToolbar.addEventListener('mousedown', (e) => e.preventDefault());
    dom.formatToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      applyFormat(btn.dataset.fmt);
    });

    // --- Modal ---
    dom.modalClose.addEventListener('click', hideModal);
    dom.modalCancel.addEventListener('click', hideModal);
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) hideModal();
    });

    // Enter key in modal
    dom.modalBody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dom.modalConfirm.click();
      }
    });

    // --- Global click to hide menus ---
    document.addEventListener('click', (e) => {
      if (!dom.contextMenu.contains(e.target) && !dom.cardContextMenu.contains(e.target) && !dom.connColorPicker.contains(e.target)) {
        hideAllMenus();
      }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // --- Window resize ---
    window.addEventListener('resize', debounce(renderConnections, 200));
  }

  function onViewportMouseDown(e) {
    // Ignore if clicking on a card's interactive element
    if (e.target.closest('.card-content[contenteditable="true"]') ||
      e.target.closest('.todo-text') ||
      e.target.closest('.card-header[contenteditable="true"]') ||
      e.target.closest('.column-header[contenteditable="true"]') ||
      e.target.closest('.board-name[contenteditable="true"]') ||
      e.target.closest('.card-caption[contenteditable="true"]') ||
      e.target.closest('.add-todo-btn') ||
      e.target.closest('.todo-delete') ||
      e.target.closest('input[type="checkbox"]')) {
      return;
    }

    hideAllMenus();

    // Space held = always pan, regardless of what's under the cursor
    if (state.ui.spacePressed) {
      state.ui.isPanning = true;
      state.ui.panStart = { x: e.clientX - state.canvas.panX, y: e.clientY - state.canvas.panY };
      dom.viewport.classList.add('panning');
      e.preventDefault();
      return;
    }

    const card = e.target.closest('.card');

    // Connection point click
    if (e.target.closest('.connection-point')) {
      return; // Handled by connection point event
    }

    // If drawing connection and clicked on a card
    if (state.ui.isDrawingConnection && card) {
      const pos = getNearestConnectionPoint(card, e);
      finishConnection(card.id, pos);
      return;
    }

    // If drawing connection and clicked on empty space
    if (state.ui.isDrawingConnection && !card) {
      cancelConnection();
      return;
    }

    // Arrow mode: clicking on a card starts a new connection
    if (state.ui.activeTool === 'arrow' && card && e.button === 0) {
      const pos = getNearestConnectionPoint(card, e);
      startConnection(card.id, pos, e);
      return;
    }

    // Card click
    if (card && !e.target.closest('.resize-handle') && !e.target.closest('.card-delete')) {
      const cardId = card.id;

      if (e.button === 2) return; // Right click handled by contextmenu event

      if (!state.selectedCardIds.has(cardId)) {
        selectCard(cardId, e.shiftKey || e.ctrlKey);
      } else if (e.shiftKey || e.ctrlKey) {
        // Deselect on shift/ctrl click of already selected
        state.selectedCardIds.delete(cardId);
        card.classList.remove('selected');
        return;
      }

      // Start drag
      startDrag(cardId, e);
      return;
    }

    // Empty space - pan or marquee
    if (!card) {
      if (e.button === 1 || state.ui.spacePressed) {
        // Middle mouse or space + click = pan
        state.ui.isPanning = true;
        state.ui.panStart = { x: e.clientX - state.canvas.panX, y: e.clientY - state.canvas.panY };
        dom.viewport.classList.add('panning');
        e.preventDefault();
      } else if (e.button === 0) {
        // Left click on empty space
        deselectAll();
        // Start marquee selection
        state.ui.isMarqueeSelecting = true;
        state.ui.marqueeStart = { x: e.clientX, y: e.clientY };
        dom.marquee.classList.remove('hidden');
        dom.marquee.style.left = e.clientX + 'px';
        dom.marquee.style.top = e.clientY + 'px';
        dom.marquee.style.width = '0px';
        dom.marquee.style.height = '0px';
      }
    }
  }

  function onDocumentMouseMove(e) {
    // Track mouse position for paste
    state.ui.lastMouseX = e.clientX;
    state.ui.lastMouseY = e.clientY;

    // Pan
    if (state.ui.isPanning) {
      state.canvas.panX = e.clientX - state.ui.panStart.x;
      state.canvas.panY = e.clientY - state.ui.panStart.y;
      updateCanvasTransform();
      return;
    }

    // Drag cards
    if (state.ui.isDragging) {
      doDrag(e);
      return;
    }

    // Resize card
    if (state.ui.isResizing) {
      doResize(e);
      return;
    }

    // Marquee selection
    if (state.ui.isMarqueeSelecting) {
      const sx = state.ui.marqueeStart.x;
      const sy = state.ui.marqueeStart.y;
      const cx = e.clientX;
      const cy = e.clientY;
      const left = Math.min(sx, cx);
      const top = Math.min(sy, cy);
      const width = Math.abs(cx - sx);
      const height = Math.abs(cy - sy);
      dom.marquee.style.left = left + 'px';
      dom.marquee.style.top = top + 'px';
      dom.marquee.style.width = width + 'px';
      dom.marquee.style.height = height + 'px';
      return;
    }

    // Drawing connection
    if (state.ui.isDrawingConnection) {
      updateTempConnection(e);
    }
  }

  function onDocumentMouseUp(e) {
    // Stop pan
    if (state.ui.isPanning) {
      state.ui.isPanning = false;
      dom.viewport.classList.remove('panning');
      return;
    }

    // Stop drag
    if (state.ui.isDragging) {
      stopDrag(e);
      return;
    }

    // Stop resize
    if (state.ui.isResizing) {
      stopResize();
      return;
    }

    // Stop marquee selection
    if (state.ui.isMarqueeSelecting) {
      state.ui.isMarqueeSelecting = false;
      dom.marquee.classList.add('hidden');

      // Select cards within marquee
      const sx = state.ui.marqueeStart.x;
      const sy = state.ui.marqueeStart.y;
      const rect = {
        x: Math.min(sx, e.clientX),
        y: Math.min(sy, e.clientY),
        w: Math.abs(e.clientX - sx),
        h: Math.abs(e.clientY - sy)
      };

      if (rect.w > 5 || rect.h > 5) {
        // Convert screen rect to canvas rect
        const topLeft = screenToCanvas(rect.x, rect.y);
        const bottomRight = screenToCanvas(rect.x + rect.w, rect.y + rect.h);
        selectCardsInRect({
          x: topLeft.x,
          y: topLeft.y,
          w: bottomRight.x - topLeft.x,
          h: bottomRight.y - topLeft.y
        });
      }
    }
  }

  function onViewportWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      zoomTo(state.canvas.zoom + delta, e.clientX, e.clientY);
    } else {
      // Pan
      state.canvas.panX -= e.deltaX;
      state.canvas.panY -= e.deltaY;
      updateCanvasTransform();
    }
  }

  function onViewportDblClick(e) {
    // Cards handle their own dblclick (edit text, open links, etc.)
    return;
  }

  function onViewportContextMenu(e) {
    e.preventDefault();
    const card = e.target.closest('.card');

    if (card) {
      state.ui.contextMenuCardId = card.id;
      if (!state.selectedCardIds.has(card.id)) {
        selectCard(card.id);
      }
      // Show/hide board-only items
      const cardData = state.cards[card.id];
      dom.cardContextMenu.querySelectorAll('.board-only').forEach(btn => {
        btn.style.display = (cardData && cardData.type === 'board') ? '' : 'none';
      });
      showContextMenu(dom.cardContextMenu, e.clientX, e.clientY);
    } else {
      state.ui._contextMenuX = e.clientX;
      state.ui._contextMenuY = e.clientY;
      showContextMenu(dom.contextMenu, e.clientX, e.clientY);
    }
  }

  function getNearestConnectionPoint(cardEl, e) {
    const rect = cardEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    } else {
      return dy > 0 ? 'bottom' : 'top';
    }
  }

  // ============= COLOR PICKER =============
  function showColorPicker(cardId) {
    if (!state.selectedCardIds.has(cardId)) {
      selectCard(cardId);
    }
    const el = document.getElementById(cardId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    showContextMenu(dom.colorPicker, rect.right + 8, rect.top);

    // Mark current color
    const card = state.cards[cardId];
    dom.colorPicker.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === card.color);
    });
  }

  // ============= CLIPBOARD =============
  function copyCards() {
    state.clipboard = [];
    state.selectedCardIds.forEach(id => {
      const card = state.cards[id];
      if (card) state.clipboard.push(JSON.parse(JSON.stringify(card)));
    });
    if (state.clipboard.length > 0) {
      showToast(`📋 ${state.clipboard.length} item(ns) copiado(s)`);
    }
  }

  function pasteClipboard() {
    if (state.clipboard.length === 0) return;
    pushHistory();
    deselectAll();

    // Calculate paste position at cursor
    const mouseCanvas = screenToCanvas(state.ui.lastMouseX, state.ui.lastMouseY);

    // Find bounding box center of copied cards
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.clipboard.forEach(c => {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.width || 260));
      maxY = Math.max(maxY, c.y + (c.height || 160));
    });
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const offsetX = mouseCanvas.x - centerX;
    const offsetY = mouseCanvas.y - centerY;

    state.clipboard.forEach(cardData => {
      const extra = { ...cardData };
      delete extra.id;
      delete extra.boardId;
      delete extra.createdAt;
      delete extra.updatedAt;
      delete extra.zIndex;
      if (cardData.type === 'board') {
        extra.linkedBoardId = null;
        extra.name = (cardData.name || 'Quadro') + ' (cópia)';
      }
      const newCard = createCard(cardData.type, cardData.x + offsetX, cardData.y + offsetY, extra);
      selectCard(newCard.id, true);
    });
  }

  function selectAllCards() {
    const board = getCurrentBoard();
    if (!board) return;
    deselectAll();
    board.cardIds.forEach(cid => {
      state.selectedCardIds.add(cid);
      const el = document.getElementById(cid);
      if (el) el.classList.add('selected');
    });
  }

  // ============= KEYBOARD =============
  function onKeyDown(e) {
    // Don't intercept when editing text
    const isEditing = state.ui.editingCardId ||
      document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA' ||
      document.activeElement.contentEditable === 'true';

    // Global shortcuts (work even when editing)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (!isEditing) { e.preventDefault(); undo(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      if (!isEditing) { e.preventDefault(); redo(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
      return;
    }

    if (isEditing) return;

    // Space for panning
    if (e.code === 'Space' && !state.ui.spacePressed) {
      e.preventDefault();
      state.ui.spacePressed = true;
      dom.viewport.style.cursor = 'grab';
      dom.canvas.classList.add('panning-mode');
    }

    // Delete selected cards
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedCardIds.size > 0) {
        e.preventDefault();
        const ids = [...state.selectedCardIds];
        ids.forEach(id => deleteCard(id));
      }
    }

    // Copy/Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (state.selectedCardIds.size > 0) {
        e.preventDefault();
        copyCards();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (state.clipboard.length > 0) {
        e.preventDefault();
        pasteClipboard();
      }
    }

    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      selectAllCards();
    }

    // Escape
    if (e.key === 'Escape') {
      deselectAll();
      cancelConnection();
      hideAllMenus();
      hideModal();
      hideFormatToolbar();
      state.ui.activeTool = null;
      updateActiveToolUI();
      dom.viewport.classList.remove('crosshair');
      dom.app.classList.remove('arrow-mode');
      dom.searchInput.blur();
      dom.searchInput.value = '';
      performSearch('');
    }

    // Quick add shortcuts
    if (e.key === 'n' || e.key === 'N') addCardFromTool('note');
    if (e.key === 't' || e.key === 'T') addCardFromTool('todo');
    if (e.key === 'i' || e.key === 'I') addCardFromTool('image');
    if (e.key === 'l' || e.key === 'L') addCardFromTool('link');
    if (e.key === 'b' || e.key === 'B') addCardFromTool('board');
    if (e.key === 'a' || e.key === 'A') { if (!e.ctrlKey && !e.metaKey) addCardFromTool('arrow'); }

    // Dark mode toggle
    if (e.key === 'd' || e.key === 'D') { if (!e.ctrlKey && !e.metaKey) toggleDarkMode(); }

    // Snap toggle
    if (e.key === 'g' || e.key === 'G') {
      if (!e.ctrlKey && !e.metaKey) {
        const snapBtn = $('#snap-toggle');
        if (snapBtn) snapBtn.click();
      }
    }

    // Arrow keys to nudge selected cards
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && state.selectedCardIds.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 5;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      state.selectedCardIds.forEach(id => {
        const card = state.cards[id];
        const el = document.getElementById(id);
        if (card && el) {
          card.x += dx;
          card.y += dy;
          el.style.left = card.x + 'px';
          el.style.top = card.y + 'px';
        }
      });
      renderConnections();
      autoSave();
    }

    // Navigate back
    if ((e.ctrlKey || e.metaKey) && e.key === '[') {
      e.preventDefault();
      const board = getCurrentBoard();
      if (board && board.parentId) navigateToBoard(board.parentId);
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      state.ui.spacePressed = false;
      dom.viewport.style.cursor = '';
      dom.canvas.classList.remove('panning-mode');
    }
  }

  // ============= DARK MODE =============
  function toggleDarkMode() {
    state.ui.darkMode = !state.ui.darkMode;
    document.documentElement.setAttribute('data-theme', state.ui.darkMode ? 'dark' : 'light');
    autoSave();
  }

  // ============= WELCOME BOARD =============
  function createWelcomeBoard() {
    const boardId = createRootBoard();
    state.boards[boardId].name = 'Quadro de Planejamento';

    // Welcome note
    createCard('note', 80, 60, {
      content: '<h2>👋 Bem-vindo ao Quadro de Planejamento!</h2><p>Este é o seu espaço para organizar ideias, projetos e tarefas visualmente.</p><p>Tudo é salvo automaticamente no seu computador.</p>',
      color: '#e3f2fd',
      width: 320
    });

    // Instructions note
    createCard('note', 440, 60, {
      content: '<h3>🚀 Como usar</h3><p><strong>Duplo clique</strong> no canvas → Nova nota</p><p><strong>Barra lateral</strong> → Adicionar conteúdo</p><p><strong>Arrastar</strong> → Mover cards</p><p><strong>Scroll</strong> → Navegar pelo canvas</p><p><strong>Ctrl + Scroll</strong> → Zoom</p><p><strong>Clique direito</strong> → Menu de contexto</p>',
      color: '#e8f5e9',
      width: 280
    });

    // Sample todo
    createCard('todo', 80, 380, {
      title: '📝 Minhas Tarefas',
      color: '#fff8e1',
      items: [
        { id: uid(), text: 'Explorar o quadro de planejamento', done: true },
        { id: uid(), text: 'Criar notas e organizar ideias', done: false },
        { id: uid(), text: 'Adicionar imagens e links', done: false },
        { id: uid(), text: 'Usar cores para categorizar', done: false }
      ]
    });

    // Shortcuts note
    createCard('note', 440, 380, {
      content: '<h3>⌨️ Atalhos</h3><p><strong>N</strong> → Nova nota</p><p><strong>T</strong> → Nova lista de tarefas</p><p><strong>I</strong> → Nova imagem</p><p><strong>L</strong> → Novo link</p><p><strong>Delete</strong> → Excluir selecionados</p><p><strong>Ctrl+Z</strong> → Desfazer</p><p><strong>Ctrl+F</strong> → Pesquisar</p><p><strong>D</strong> → Modo escuro</p>',
      color: '#f3e5f5',
      width: 260
    });

    // Clear history since this is initial setup
    state.history.past = [];
    state.history.future = [];
    updateHistoryButtons();
  }

  // ============= INITIALIZATION =============
  function init() {
    const loaded = loadFromStorage();

    if (!loaded || !state.currentBoardId || !state.boards[state.currentBoardId]) {
      state.boards = {};
      state.cards = {};
      createWelcomeBoard();
    }

    // Apply dark mode
    if (state.ui.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    initEvents();
    renderCurrentBoard();
    updateHistoryButtons();

    // Auto-save periodically
    setInterval(saveToStorage, 30000);

    console.log('✨ Quadro de Planejamento inicializado!');
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
