import { network } from './network.js';
import { soundEngine } from './audio.js';

/**
 * BoardEditor: Manages the collaborative Photo Exhibition Corkboard,
 * OCC version tracking, and live conflict resolution display.
 */
export class BoardEditor {
  constructor() {
    this.container = document.getElementById('galleryCardsGrid');
    this.badge = document.getElementById('galleryCountBadge');
    this.conflictBanner = document.getElementById('conflictAlertBanner');
    this.conflictTitle = document.getElementById('conflictTitle');
    this.conflictDesc = document.getElementById('conflictDesc');
    this.closeBannerBtn = document.getElementById('closeConflictBannerBtn');

    // Edit modal
    this.editModal = document.getElementById('editCardModal');
    this.captionInput = document.getElementById('editCaptionInput');
    this.filterPicker = document.getElementById('editFilterPicker');
    this.stickerPicker = document.getElementById('editStickerPicker');
    this.saveBtn = document.getElementById('saveEditCardBtn');
    this.cancelBtn = document.getElementById('cancelEditCardBtn');
    this.versionTag = document.getElementById('editModalVersionTag');

    this.activeCardId = null;
    this.activeExpectedVersion = 1;
    this.selectedFilter = 'normal';
    this.selectedSticker = '⭐';

    this.cardsMap = new Map();

    this.initEvents();
  }

  initEvents() {
    if (this.closeBannerBtn) {
      this.closeBannerBtn.addEventListener('click', () => {
        this.conflictBanner.classList.add('hidden');
      });
    }

    // Modal filter options
    if (this.filterPicker) {
      this.filterPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-opt');
        if (btn) {
          this.filterPicker.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedFilter = btn.dataset.filter;
        }
      });
    }

    // Modal sticker options
    if (this.stickerPicker) {
      this.stickerPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.sticker-opt');
        if (btn) {
          this.stickerPicker.querySelectorAll('.sticker-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedSticker = btn.dataset.sticker;
        }
      });
    }

    // Save modal
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => {
        this.submitEdit();
      });
    }

    // Cancel modal
    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => {
        this.editModal.classList.add('hidden');
      });
    }

    // Demo conflict trigger button
    const demoConflictBtn = document.getElementById('demoTriggerConflictBtn');
    if (demoConflictBtn) {
      demoConflictBtn.addEventListener('click', () => {
        const firstCardId = this.cardsMap.keys().next().value || 'photo_init_1';
        network.send('DEMO_TRIGGER_CONFLICT', { cardId: firstCardId });
      });
    }

    const testConflictBtn2 = document.getElementById('testConflictBtn2');
    if (testConflictBtn2) {
      testConflictBtn2.addEventListener('click', () => {
        const firstCardId = this.cardsMap.keys().next().value || 'photo_init_1';
        network.send('DEMO_TRIGGER_CONFLICT', { cardId: firstCardId });
      });
    }
  }

  setCards(galleryList) {
    if (!Array.isArray(galleryList)) return;
    this.cardsMap.clear();
    for (const item of galleryList) {
      this.cardsMap.set(item.id, item);
    }
    this.render();
  }

  updateOrAddCard(item) {
    this.cardsMap.set(item.id, item);
    this.render();
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    const items = [...this.cardsMap.values()];

    if (this.badge) {
      this.badge.textContent = items.length;
    }

    for (const card of items) {
      const cardEl = this.createCardElement(card);
      this.container.appendChild(cardEl);
    }
  }

  createCardElement(card) {
    const el = document.createElement('div');
    el.className = `photo-card filter-${card.filter || 'normal'}`;
    el.id = `card_${card.id}`;

    // Random rotation for organic polaroid look
    const rot = ((card.id.charCodeAt(card.id.length - 1) % 5) - 2) * 1.2;
    el.style.transform = `rotate(${rot}deg)`;

    el.innerHTML = `
      <div class="card-pin"></div>
      <div class="card-sticker">${card.sticker || '📸'}</div>
      <div class="card-photo-img-wrap">
        <canvas width="250" height="180" class="card-preview-canvas" data-species="${card.targetSpecies || 'wildlife'}"></canvas>
      </div>
      <div class="card-meta-line">
        <span>👤 <b>${card.photographer || 'Фотограф'}</b></span>
        <span>🎯 ${card.accuracy || 90}% точность</span>
      </div>
      <div class="card-target-title">${card.targetName || 'Цель сафари'}</div>
      <div class="card-caption-display">"${card.caption || 'Без подписи'}"</div>
      <div class="card-footer">
        <span class="version-badge">v${card.version || 1} • ${card.lastModifiedBy ? 'ред. ' + card.lastModifiedBy : ''}</span>
        <button class="btn btn-sm btn-secondary edit-card-btn" data-id="${card.id}">✏️ Редактировать</button>
      </div>
    `;

    // Render snapshot mini-illustration on canvas
    const canvas = el.querySelector('.card-preview-canvas');
    if (canvas) {
      this.drawCardThumbnail(canvas, card);
    }

    // Attach edit button
    const editBtn = el.querySelector('.edit-card-btn');
    editBtn.addEventListener('click', () => {
      this.openEditModal(card);
    });

    return el;
  }

  drawCardThumbnail(canvas, card) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Background gradient based on species habitat
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#1a2332');
    bgGrad.addColorStop(1, '#0b0f16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Decorative bokeh circles
    ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.4, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 214, 0, 0.1)';
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.6, 50, 0, Math.PI * 2);
    ctx.fill();

    // Central Creature Avatar
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = card.targetSpecies === 'royal_flamingo' ? '#ff6b9d' :
                    card.targetSpecies === 'cyber_penguin' ? '#00e5ff' :
                    card.targetSpecies === 'neon_fox' ? '#ff9100' :
                    card.targetSpecies === 'golden_falcon' ? '#ffd600' : '#00e676';
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fill();

    // Cute face
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(10, -8, 7, 0, Math.PI * 2);
    ctx.arc(26, -8, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(12, -8, 3.5, 0, Math.PI * 2);
    ctx.arc(28, -8, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Score stamp in bottom right
    ctx.fillStyle = '#ffd600';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`+${card.score || 1000} PTS`, w - 12, h - 12);
  }

  openEditModal(card) {
    this.activeCardId = card.id;
    this.activeExpectedVersion = card.version || 1;
    this.selectedFilter = card.filter || 'normal';
    this.selectedSticker = card.sticker || '⭐';

    if (this.captionInput) this.captionInput.value = card.caption || '';
    if (this.versionTag) this.versionTag.textContent = `Версия v${this.activeExpectedVersion}`;

    // Set active filter button
    if (this.filterPicker) {
      this.filterPicker.querySelectorAll('.filter-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === this.selectedFilter);
      });
    }

    // Set active sticker button
    if (this.stickerPicker) {
      this.stickerPicker.querySelectorAll('.sticker-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.sticker === this.selectedSticker);
      });
    }

    this.editModal.classList.remove('hidden');
    this.captionInput.focus();
  }

  submitEdit() {
    if (!this.activeCardId) return;

    const caption = this.captionInput.value.trim() || 'Без подписи';
    const changes = {
      caption,
      filter: this.selectedFilter,
      sticker: this.selectedSticker
    };

    console.log(`[BoardEditor] Sending OCC edit for ${this.activeCardId} (expected v${this.activeExpectedVersion})`);

    network.send('UPDATE_BOARD_CARD', {
      id: this.activeCardId,
      expectedVersion: this.activeExpectedVersion,
      changes
    });

    this.editModal.classList.add('hidden');
  }

  showConflictNotification({ item, resolutionMessage, conflictingFields, demoNotice }) {
    soundEngine.playConflictAlert();

    if (this.conflictBanner) {
      this.conflictBanner.classList.remove('hidden');
      if (this.conflictTitle) {
        this.conflictTitle.textContent = demoNotice || '⚡ Конфликт одновременного редактирования разрешен!';
      }
      if (this.conflictDesc) {
        this.conflictDesc.textContent = `${resolutionMessage || 'Сервер выполнил 3-Way Merge.'} Карточка обновлена до версии v${item.version}.`;
      }
    }

    this.updateOrAddCard(item);

    // Highlight card with pulse effect
    const cardEl = document.getElementById(`card_${item.id}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardEl.style.transition = 'outline 0.3s ease';
      cardEl.style.outline = '4px solid #ffab00';
      setTimeout(() => {
        cardEl.style.outline = 'none';
      }, 3000);
    }
  }
}
