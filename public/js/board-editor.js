import { network } from './network.js';
import { soundEngine } from './audio.js';

export class RecipeBookEditor {
  constructor() {
    this.container = document.getElementById('recipeCardsGrid');
    this.badge = document.getElementById('recipeCountBadge');
    this.conflictBanner = document.getElementById('conflictAlertBanner');
    this.conflictTitle = document.getElementById('conflictTitle');
    this.conflictDesc = document.getElementById('conflictDesc');
    this.closeBannerBtn = document.getElementById('closeConflictBannerBtn');

    this.discoveredRecipes = [];
    this.initEvents();
    this.render();
  }

  getFirstRecipeId() {
    return 'pair_burger_fries';
  }

  initEvents() {
    if (this.closeBannerBtn) {
      this.closeBannerBtn.addEventListener('click', () => {
        this.conflictBanner.classList.add('hidden');
      });
    }
  }

  setRecipes(recipeList) {
    // If called with array of recipes from server, store them
    if (Array.isArray(recipeList)) {
      this.discoveredRecipes = [...recipeList];
    } else {
      this.discoveredRecipes = [];
    }
    this.render();
  }

  addDiscoveredRecipe(recipe) {
    if (!recipe) return;
    const exists = this.discoveredRecipes.some(r => r.pairId === recipe.pairId);
    if (!exists) {
      this.discoveredRecipes.push(recipe);
      this.render();
    }
  }

  clearRecipes() {
    this.discoveredRecipes = [];
    this.render();
  }

  updateRecipe(updatedItem, showConflictNotice = false, message = '') {
    if (showConflictNotice) {
      this.showConflictToast('⚡ Разрешение коллизии', message || 'Сервер синхронизировал данные.');
      soundEngine.playConflictAlert();
    }
  }

  showConflictToast(title, desc) {
    if (!this.conflictBanner) return;
    this.conflictTitle.textContent = title;
    this.conflictDesc.textContent = desc;
    this.conflictBanner.classList.remove('hidden');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.conflictBanner.classList.add('hidden');
    }, 6000);
  }

  render() {
    if (this.badge) {
      this.badge.textContent = this.discoveredRecipes.length;
    }

    if (!this.container) return;
    this.container.innerHTML = '';

    if (this.discoveredRecipes.length === 0) {
      this.container.innerHTML = `
        <div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 13px; padding: 24px 16px; text-align: center; background: rgba(0,0,0,0.15); border-radius: 8px;">
          🍴 В текущей игре вы пока не открыли ни одного рецепта.<br>
          <span style="font-size: 11px; color: var(--text-dim); margin-top: 4px; display: inline-block;">
            Открывайте подходящие пары карточек на столе (например, Бургер + Фри, Пицца + Кола), чтобы они появились здесь!
          </span>
        </div>
      `;
      return;
    }

    this.discoveredRecipes.forEach((recipe, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'discovered-recipe-card';

      const emojiA = recipe.cardA?.emoji || '🍴';
      const emojiB = recipe.cardB?.emoji || '🍴';
      const nameA = recipe.cardA?.name || '';
      const nameB = recipe.cardB?.name || '';
      const title = recipe.pairTitle || `${nameA} + ${nameB}`;
      const timeStr = recipe.discoveredAt ? new Date(recipe.discoveredAt).toLocaleTimeString() : '';

      cardEl.innerHTML = `
        <div class="discovered-recipe-top">
          <span class="discovered-recipe-emojis">${emojiA} ${emojiB}</span>
          <span class="discovered-recipe-score">+100 очков</span>
        </div>
        <div class="discovered-recipe-title">${this.escapeHtml(title)}</div>
        <div class="discovered-recipe-items">Компоненты: <b>${this.escapeHtml(nameA)}</b> и <b>${this.escapeHtml(nameB)}</b></div>
        <div class="discovered-recipe-time">Открыто в текущей игре #${index + 1}${timeStr ? ` (${timeStr})` : ''}</div>
      `;

      this.container.appendChild(cardEl);
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
