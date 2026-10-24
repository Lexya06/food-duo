import { soundEngine } from './audio.js';
import { network } from './network.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { RecipeBookEditor } from './board-editor.js';

// Unregister any stale Service Workers from previous projects on localhost:3000
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const r of registrations) {
      r.unregister();
    }
  }).catch(() => {});
}

class AppController {
  constructor() {
    this.canvas = document.getElementById('effectsCanvas');
    this.renderer = new CanvasRenderer(this.canvas);
    this.recipeEditor = new RecipeBookEditor();

    this.player = {
      id: null,
      socketId: null,
      name: sessionStorage.getItem('foodmatch_player_name') || localStorage.getItem('foodmatch_player_name') || 'Шеф-Повар',
      avatar: this.normalizeAvatarPath(sessionStorage.getItem('foodmatch_player_avatar') || localStorage.getItem('foodmatch_player_avatar')),
      roomId: 'bistro_main',
      score: 0,
      roundScore: 0,
      comboStreak: 0
    };

    this.tempAvatar = this.player.avatar;
    this.cardsState = [];
    this.cardsElements = [];
    this.lastCursorSend = 0;

    // Realtime round timing state
    this.currentRoundState = 'IDLE';
    this.localTimerSeconds = 0;
    this.isGamePaused = false;
    this.isRoomServerPaused = false;
    this.lastPingSentAt = 0;

    this.initDOMElements();
    this.initEvents();
    this.initNetworkListeners();

    this.startLoop();

    // 1-second timer ticker (pauses when game is paused)
    setInterval(() => {
      if (this.currentRoundState === 'ACTIVE' && !this.isGamePaused && !this.isRoomServerPaused) {
        this.localTimerSeconds += 1;
        this.renderTimerDisplay(this.localTimerSeconds);
      }
    }, 1000);

    // Initial 16 cards skeleton
    this.renderInitialCards();

    // Check saved authentication
    const savedAuthToken = localStorage.getItem('foodmatch_auth_token');
    if (savedAuthToken) {
      this.joinGame();
    } else {
      this.updateHeaderProfile();
      network.connect();
      setTimeout(() => {
        this.openAuthModal('login');
      }, 50);
    }
  }

  initDOMElements() {
    // Header & Status
    this.netStatusPill = document.getElementById('netStatusPill');
    this.netStatusText = document.getElementById('netStatusText');
    this.soundToggleBtn = document.getElementById('soundToggleBtn');
    this.headerPlayerPill = document.getElementById('headerPlayerPill');
    this.headerPlayerAvatar = document.getElementById('headerPlayerAvatar');
    this.headerPlayerName = document.getElementById('headerPlayerName');
    this.headerPlayerScore = document.getElementById('headerPlayerScore');
    this.authBtn = document.getElementById('authBtn');
    this.authBtnIcon = document.getElementById('authBtnIcon');
    this.authBtnText = document.getElementById('authBtnText');

    // Auth Modal
    this.authModal = document.getElementById('authModal');
    this.closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
    this.tabAuthLogin = document.getElementById('tabAuthLogin');
    this.tabAuthRegister = document.getElementById('tabAuthRegister');
    this.authLoginForm = document.getElementById('authLoginForm');
    this.authRegisterForm = document.getElementById('authRegisterForm');
    this.loginUsername = document.getElementById('loginUsername');
    this.loginPassword = document.getElementById('loginPassword');
    this.registerUsername = document.getElementById('registerUsername');
    this.registerPassword = document.getElementById('registerPassword');
    this.registerAvatarPicker = document.getElementById('registerAvatarPicker');
    this.registerAvatarFile = document.getElementById('registerAvatarFile');
    this.registerAvatarFileName = document.getElementById('registerAvatarFileName');
    this.guestPlayBtn = document.getElementById('guestPlayBtn');
    this.cancelRegisterBtn = document.getElementById('cancelRegisterBtn');
    this.authErrorAlert = document.getElementById('authErrorAlert');
    this.registerAvatar = '/avatars/chef_male.svg';
    this.authUser = null;

    // Offline Banner
    this.offlineBanner = document.getElementById('offlineBanner');
    this.offlineQueueBadge = document.getElementById('offlineQueueBadge');
    this.reconnectNowBtn = document.getElementById('reconnectNowBtn');

    // Simple HUD & Players Bar
    this.hudScoreVal = document.getElementById('hudScoreVal');
    this.remainingPairsVal = document.getElementById('remainingPairsVal');
    this.roundTimerVal = document.getElementById('roundTimerVal');
    this.onlinePlayersCount = document.getElementById('onlinePlayersCount');
    this.comboStreakBadge = document.getElementById('comboStreakBadge');
    this.pauseToggleBtn = document.getElementById('pauseToggleBtn');
    this.newRoundBtn = document.getElementById('newRoundBtn');
    this.roomPlayersChips = document.getElementById('roomPlayersChips');
    this.roomTitleLabel = document.getElementById('roomTitleLabel');

    // Cards Grid & Table
    this.tableWrapper = document.getElementById('tableWrapper');
    this.cardsGridContainer = document.getElementById('cardsGridContainer');

    // Pause Overlay
    this.gamePauseOverlay = document.getElementById('gamePauseOverlay');
    this.pauseTitle = document.getElementById('pauseTitle');
    this.pauseReason = document.getElementById('pauseReason');
    this.resumeGameBtn = document.getElementById('resumeGameBtn');
    this.abortAndRestartBtn = document.getElementById('abortAndRestartBtn');

    // Bottom Panels
    this.panelTabs = document.querySelectorAll('.panel-tab-btn');
    this.panelContents = document.querySelectorAll('.panel-content');

    // Profile Modal
    this.profileModal = document.getElementById('profileModal');
    this.closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
    this.playerNameInput = document.getElementById('playerNameInput');
    this.avatarPicker = document.getElementById('avatarPicker');
    this.profileAvatarFile = document.getElementById('profileAvatarFile');
    this.profileAvatarFileName = document.getElementById('profileAvatarFileName');
    this.cancelProfileBtn = document.getElementById('cancelProfileBtn');
    this.saveProfileBtn = document.getElementById('saveProfileBtn');
    this.profileAvatarBig = document.getElementById('profileAvatarBig');
    this.profileUsername = document.getElementById('profileUsername');
    this.profileUserBadge = document.getElementById('profileUserBadge');
    this.profileTotalScore = document.getElementById('profileTotalScore');
    this.profileGamesPlayed = document.getElementById('profileGamesPlayed');
    this.profileCurrentGameScore = document.getElementById('profileCurrentGameScore');
    this.profileTotalPairs = document.getElementById('profileTotalPairs');
    this.deleteAccountBtn = document.getElementById('deleteAccountBtn');

    // Victory Modal
    this.showcaseModal = document.getElementById('showcaseModal');
    this.showcaseWinnerAvatar = document.getElementById('showcaseWinnerAvatar');
    this.showcaseWinnerName = document.getElementById('showcaseWinnerName');
    this.showcaseScore = document.getElementById('showcaseScore');
    this.showcasePairs = document.getElementById('showcasePairs');
    this.showcaseMessage = document.getElementById('showcaseMessage');
    this.showcaseRestartBtn = document.getElementById('showcaseRestartBtn');
    this.showcaseRestartStatus = document.getElementById('showcaseRestartStatus');
    this.showcaseOkBtn = document.getElementById('showcaseOkBtn');
    this.victoryModalDismissedByUser = false;

    // Restart Confirmation Dialog
    this.restartConfirmModal = document.getElementById('restartConfirmModal');
    this.restartConfirmMessage = document.getElementById('restartConfirmMessage');
    this.restartConfirmVotesStatus = document.getElementById('restartConfirmVotesStatus');
    this.restartConfirmAcceptBtn = document.getElementById('restartConfirmAcceptBtn');
    this.restartConfirmDeclineBtn = document.getElementById('restartConfirmDeclineBtn');
    this.hasVotedRestart = false;

    // Leaderboards
    this.tabLeaderboardCurrent = document.getElementById('tabLeaderboardCurrent');
    this.tabLeaderboardAll = document.getElementById('tabLeaderboardAll');
    this.leaderboardCurrentView = document.getElementById('leaderboardCurrentView');
    this.leaderboardAllView = document.getElementById('leaderboardAllView');
    this.leaderboardCurrentTbody = document.getElementById('leaderboardCurrentTbody');
    this.leaderboardTbody = document.getElementById('leaderboardTbody');
    this.conflictAuditTbody = document.getElementById('conflictAuditTbody');

    // Lab 4 Verification Tools
    this.btnCheckPing = document.getElementById('btnCheckPing');
    this.btnSyncRoom = document.getElementById('btnSyncRoom');
    this.simulateDropSocketBtn = document.getElementById('simulateDropSocketBtn');
    this.labPingVal = document.getElementById('labPingVal');
  }

  initEvents() {
    // Sound toggle
    this.soundToggleBtn.addEventListener('click', () => {
      const muted = soundEngine.toggleMute();
      this.soundToggleBtn.textContent = muted ? '🔇' : '🔊';
    });

    // Auth button in header (Login / Logout)
    if (this.authBtn) {
      this.authBtn.addEventListener('click', () => {
        if (this.authUser) {
          if (confirm(`Вы уверены, что хотите выйти из аккаунта «${this.authUser.name}»?`)) {
            const token = localStorage.getItem('foodmatch_auth_token');
            network.send('LOGOUT', { authToken: token });
            localStorage.removeItem('foodmatch_auth_token');
            sessionStorage.removeItem('foodmatch_player_name');
            sessionStorage.removeItem('foodmatch_player_avatar');
            localStorage.removeItem('foodmatch_player_name');
            localStorage.removeItem('foodmatch_player_avatar');
            this.updateAuthUI(null);
            this.openAuthModal('login');
          }
        } else {
          this.openAuthModal('login');
        }
      });
    }

    // Auth Modal Tabs & Buttons
    if (this.closeAuthModalBtn) {
      this.closeAuthModalBtn.addEventListener('click', () => {
        if (this.authUser) {
          this.authModal.classList.add('hidden');
        } else {
          this.showAuthError('Для игры необходимо войти или зарегистрироваться!');
        }
      });
    }

    if (this.tabAuthLogin) {
      this.tabAuthLogin.addEventListener('click', () => {
        this.setAuthTab('login');
      });
    }

    if (this.tabAuthRegister) {
      this.tabAuthRegister.addEventListener('click', () => {
        this.setAuthTab('register');
      });
    }

    if (this.registerAvatarPicker) {
      this.registerAvatarPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.av-opt');
        if (btn) {
          this.registerAvatarPicker.querySelectorAll('.av-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.registerAvatar = btn.dataset.avatar;
          if (this.registerAvatarFileName) this.registerAvatarFileName.textContent = '';
        }
      });
    }

    if (this.registerAvatarFile) {
      this.registerAvatarFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          this.showAuthError('Пожалуйста, выберите файл-изображение (PNG, SVG, JPG, WEBP)');
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          this.registerAvatar = ev.target.result;
          if (this.registerAvatarFileName) this.registerAvatarFileName.textContent = file.name;
          if (this.registerAvatarPicker) {
            this.registerAvatarPicker.querySelectorAll('.av-opt').forEach(b => b.classList.remove('active'));
          }
        };
        reader.readAsDataURL(file);
      });
    }

    // Auth Form Submissions
    if (this.authLoginForm) {
      this.authLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.hideAuthError();
        const username = this.loginUsername ? this.loginUsername.value.trim() : '';
        const password = this.loginPassword ? this.loginPassword.value : '';
        if (!username || !password) {
          this.showAuthError('Заполните логин и пароль');
          return;
        }
        network.send('LOGIN', { username, password });
      });
    }

    if (this.authRegisterForm) {
      this.authRegisterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.hideAuthError();
        const username = this.registerUsername ? this.registerUsername.value.trim() : '';
        const password = this.registerPassword ? this.registerPassword.value : '';
        if (username.length < 2) {
          this.showAuthError('Логин должен содержать не менее 2 символов');
          return;
        }
        if (password.length < 4) {
          this.showAuthError('Пароль должен быть не менее 4 символов');
          return;
        }
        network.send('REGISTER', {
          username,
          password,
          avatar: this.registerAvatar || '/avatars/chef_male.svg'
        });
      });
    }

    // Clicking header player pill opens profile modal (or auth modal if guest)
    if (this.headerPlayerPill) {
      this.headerPlayerPill.addEventListener('click', () => {
        if (!this.authUser) {
          this.openAuthModal('login');
        } else {
          this.openProfileModal();
        }
      });
    }

    // Avatar Picker in modal
    if (this.avatarPicker) {
      this.avatarPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.av-opt');
        if (btn) {
          this.avatarPicker.querySelectorAll('.av-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.tempAvatar = btn.dataset.avatar;
          if (this.profileAvatarFileName) this.profileAvatarFileName.textContent = '';
          if (this.profileAvatarBig) this.renderAvatarInto(this.profileAvatarBig, this.tempAvatar, 'profile-avatar-img-big');
        }
      });
    }

    if (this.profileAvatarFile) {
      this.profileAvatarFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          alert('Пожалуйста, выберите файл-изображение (PNG, SVG, JPG, WEBP)');
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          this.tempAvatar = ev.target.result;
          if (this.profileAvatarFileName) this.profileAvatarFileName.textContent = file.name;
          if (this.avatarPicker) {
            this.avatarPicker.querySelectorAll('.av-opt').forEach(b => b.classList.remove('active'));
          }
          if (this.profileAvatarBig) {
            this.renderAvatarInto(this.profileAvatarBig, this.tempAvatar, 'profile-avatar-img-big');
          }
        };
        reader.readAsDataURL(file);
      });
    }

    // Save profile button ("OK")
    if (this.saveProfileBtn) {
      this.saveProfileBtn.addEventListener('click', () => {
        this.saveProfile();
      });
    }

    // Enter key inside name input saves profile
    if (this.playerNameInput) {
      this.playerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.saveProfile();
        }
      });
    }

    // Cancel / Close profile modal
    if (this.cancelProfileBtn) {
      this.cancelProfileBtn.addEventListener('click', () => {
        this.profileModal.classList.add('hidden');
      });
    }
    if (this.closeProfileModalBtn) {
      this.closeProfileModalBtn.addEventListener('click', () => {
        this.profileModal.classList.add('hidden');
      });
    }
    if (this.profileModal) {
      this.profileModal.addEventListener('click', (e) => {
        if (e.target === this.profileModal) {
          this.profileModal.classList.add('hidden');
        }
      });
    }

    // Delete Account Button in Profile Modal
    if (this.deleteAccountBtn) {
      this.deleteAccountBtn.addEventListener('click', () => {
        this.handleDeleteAccountClick();
      });
    }

    // Leaderboard Sub-Tabs (Current Game vs All Games)
    if (this.tabLeaderboardCurrent) {
      this.tabLeaderboardCurrent.addEventListener('click', () => {
        this.setLeaderboardTab('current');
      });
    }
    if (this.tabLeaderboardAll) {
      this.tabLeaderboardAll.addEventListener('click', () => {
        this.setLeaderboardTab('all');
      });
    }

    // New Round & Restart consensus buttons (requires ALL players to vote ready)
    if (this.newRoundBtn) {
      this.newRoundBtn.addEventListener('click', () => {
        this.handleRestartClick();
      });
    }
    if (this.showcaseRestartBtn) {
      this.showcaseRestartBtn.addEventListener('click', () => {
        this.handleRestartClick();
      });
    }

    // Dismiss victory modal to inspect the board
    if (this.showcaseOkBtn) {
      this.showcaseOkBtn.addEventListener('click', () => {
        this.victoryModalDismissedByUser = true;
        if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
      });
    }

    // Interactive restart confirmation dialog buttons
    if (this.restartConfirmAcceptBtn) {
      this.restartConfirmAcceptBtn.addEventListener('click', () => {
        if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');
        this.handleRestartClick();
      });
    }

    if (this.restartConfirmDeclineBtn) {
      this.restartConfirmDeclineBtn.addEventListener('click', () => {
        if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');
        this.victoryModalDismissedByUser = true;
        if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
      });
    }

    // Manual Pause / Resume toggle
    if (this.pauseToggleBtn) {
      this.pauseToggleBtn.addEventListener('click', () => {
        if (this.isRoomServerPaused) {
          const otherPlayersMissing = Array.isArray(this.lastRoomSnapshot?.players) && this.lastRoomSnapshot.players.some(p => {
            const isMe = (this.player.id && p.playerId === this.player.id) ||
                         (this.player.socketId && p.socketId === this.player.socketId) ||
                         (network.sessionToken && p.sessionToken === network.sessionToken) ||
                         ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());
            return !isMe && (p.isOnline === false || p.isAway);
          });
          if (otherPlayersMissing) {
            this.recipeEditor.showConflictToast('⏸️ Игра на паузе', 'Ожидаем возвращения игроков. Либо нажмите «Завершить и начать новую игру».');
            return;
          }
          network.send('RESUME_GAME');
        } else if (this.isGamePaused) {
          network.send('RESUME_GAME');
        } else {
          network.send('PAUSE_GAME');
          this.showPauseOverlay('Игра на паузе', 'Вы поставили игру на паузу. Нажмите «Снять с паузы» или «Завершить и начать новую игру».', true);
        }
      });
    }

    if (this.resumeGameBtn) {
      this.resumeGameBtn.addEventListener('click', () => {
        network.send('RESUME_GAME');
      });
    }

    if (this.abortAndRestartBtn) {
      this.abortAndRestartBtn.addEventListener('click', () => {
        this.hasVotedRestart = false;
        this.victoryModalDismissedByUser = false;
        if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
        if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');
        network.send('ABORT_AND_RESTART_ROUND');
      });
    }

    // Automatically pause time when user leaves/switches tab or minimizes window
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.isGamePaused = true;
        this.showPauseOverlay('Игра приостановлена', 'Вы переключили вкладку или свернули окно. Время игры приостановлено.');
        network.send('PLAYER_AWAY', {
          reason: `Игрок «${this.player.name}» свернул окно или переключил вкладку. Время игры приостановлено.`
        });
      } else {
        network.send('PLAYER_BACK');
      }
    });

    const handleWindowExit = () => {
      this.isGamePaused = true;
      network.send('PLAYER_AWAY', {
        reason: `Игрок «${this.player.name}» вышел из игры. Время игры приостановлено.`
      });
    };
    window.addEventListener('beforeunload', handleWindowExit);
    window.addEventListener('pagehide', handleWindowExit);

    // Panel Tabs (Recipes / Leaderboard / Lab)
    this.panelTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        this.panelTabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.panelContents.forEach(p => {
          p.classList.toggle('active', p.id === `panel-${panel}`);
        });
      });
    });

    // Lab 4 Action 1: WebSocket Ping latency test (RTT)
    if (this.btnCheckPing) {
      this.btnCheckPing.addEventListener('click', () => {
        this.lastPingSentAt = performance.now();
        network.send('PING', { clientTime: Date.now() });
      });
    }

    // Lab 4 Action 2: Authoritative Room State Sync
    if (this.btnSyncRoom) {
      this.btnSyncRoom.addEventListener('click', () => {
        network.send('REQUEST_ROOM_SYNC', {});
      });
    }

    // Lab 4 Action 3: Offline network drop simulation
    if (this.simulateDropSocketBtn) {
      this.simulateDropSocketBtn.addEventListener('click', () => {
        if (network.status === 'CONNECTED') {
          network.simulateDropConnection();
          this.simulateDropSocketBtn.textContent = '🔄 Восстановить связь';
          this.simulateDropSocketBtn.classList.remove('btn-outline');
          this.simulateDropSocketBtn.classList.add('btn-white');
        } else {
          network.resumeAfterSimulatedDrop();
          this.simulateDropSocketBtn.textContent = '🔌 Симуляция обрыва сети';
          this.simulateDropSocketBtn.classList.remove('btn-white');
          this.simulateDropSocketBtn.classList.add('btn-outline');
        }
      });
    }

    const btnSimulateRaceClick = document.getElementById('btnSimulateRaceClick');
    if (btnSimulateRaceClick) {
      btnSimulateRaceClick.addEventListener('click', () => {
        network.send('DEMO_RACE_COLLISION', { cardIndex: 2 });
      });
    }

    if (this.reconnectNowBtn) {
      this.reconnectNowBtn.addEventListener('click', () => {
        network.reconnectNow();
      });
    }

    // Track Cursor on Board
    if (this.tableWrapper) {
      const handleCursorMove = (clientX, clientY) => {
        const rect = this.tableWrapper.getBoundingClientRect();
        const xPercent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        const yPercent = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));

        const now = Date.now();
        if (now - this.lastCursorSend > 50) {
          this.lastCursorSend = now;
          network.send('MOVE_CURSOR', {
            x: Number(xPercent.toFixed(1)),
            y: Number(yPercent.toFixed(1))
          });
        }
      };

      this.tableWrapper.addEventListener('mousemove', (e) => handleCursorMove(e.clientX, e.clientY));
      this.tableWrapper.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) handleCursorMove(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
    }
  }

  openAuthModal(tab = 'login') {
    if (!this.authModal) return;
    this.hideAuthError();
    this.setAuthTab(tab);
    this.authModal.classList.remove('hidden');
    setTimeout(() => {
      const input = tab === 'login' ? this.loginUsername : this.registerUsername;
      if (input) input.focus();
    }, 50);
  }

  setAuthTab(tab = 'login') {
    const isLogin = tab === 'login';
    if (this.tabAuthLogin) this.tabAuthLogin.classList.toggle('active', isLogin);
    if (this.tabAuthRegister) this.tabAuthRegister.classList.toggle('active', !isLogin);
    if (this.authLoginForm) this.authLoginForm.classList.toggle('hidden', !isLogin);
    if (this.authRegisterForm) this.authRegisterForm.classList.toggle('hidden', isLogin);
    const titleEl = document.getElementById('authModalTitle');
    if (titleEl) {
      titleEl.textContent = isLogin ? 'Вход в Food Duo' : 'Регистрация шеф-повара';
    }
    this.hideAuthError();
  }

  showAuthError(message) {
    if (this.authErrorAlert) {
      this.authErrorAlert.textContent = message;
      this.authErrorAlert.classList.remove('hidden');
    }
  }

  hideAuthError() {
    if (this.authErrorAlert) {
      this.authErrorAlert.textContent = '';
      this.authErrorAlert.classList.add('hidden');
    }
  }

  updateAuthUI(user) {
    this.authUser = user;
    if (user) {
      this.player.name = user.name;
      this.player.avatar = this.normalizeAvatarPath(user.avatar || this.player.avatar);
      if (user.totalScore !== undefined) {
        this.player.score = user.totalScore;
      }
      sessionStorage.setItem('foodmatch_player_name', user.name);
      sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
      localStorage.setItem('foodmatch_player_name', user.name);
      localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
      this.updateHeaderProfile();

      if (this.authBtnIcon) this.authBtnIcon.textContent = '🚪';
      if (this.authBtnText) this.authBtnText.textContent = 'Выйти';
      if (this.authBtn) this.authBtn.title = `Выйти из аккаунта (${user.name})`;
    } else {
      this.player.name = 'Вход не выполнен';
      this.player.avatar = '/avatars/chef_male.svg';
      this.player.score = 0;
      this.updateHeaderProfile();
      if (this.authBtnIcon) this.authBtnIcon.textContent = '🔑';
      if (this.authBtnText) this.authBtnText.textContent = 'Войти';
      if (this.authBtn) this.authBtn.title = 'Войти или зарегистрироваться';
    }
  }

  openProfileModal() {
    if (!this.profileModal) return;
    this.tempAvatar = this.player.avatar || '/avatars/chef_male.svg';
    if (this.playerNameInput) {
      this.playerNameInput.value = this.player.name;
    }
    if (this.profileAvatarFileName) {
      this.profileAvatarFileName.textContent = '';
    }
    if (this.avatarPicker) {
      this.avatarPicker.querySelectorAll('.av-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.avatar === this.tempAvatar);
      });
    }

    if (this.profileAvatarBig) {
      this.renderAvatarInto(this.profileAvatarBig, this.tempAvatar, 'profile-avatar-img-big');
    }
    if (this.profileUsername) this.profileUsername.textContent = this.player.name;
    if (this.profileUserBadge) {
      this.profileUserBadge.textContent = this.authUser ? 'Зарегистрированный шеф-повар' : 'Статус: В сети';
    }

    // Populate current known stats
    const totalScore = this.authUser?.totalScore !== undefined ? this.authUser.totalScore : (this.player.score || 0);
    const gamesPlayed = this.authUser?.gamesPlayed || 0;
    const currentScore = this.player.roundScore !== undefined ? this.player.roundScore : 0;
    const totalPairs = this.authUser?.pairsMatched || 0;

    if (this.profileTotalScore) this.profileTotalScore.textContent = totalScore;
    if (this.profileGamesPlayed) this.profileGamesPlayed.textContent = gamesPlayed;
    if (this.profileCurrentGameScore) this.profileCurrentGameScore.textContent = currentScore;
    if (this.profileTotalPairs) this.profileTotalPairs.textContent = totalPairs;

    // Fetch live user stats from server
    const token = localStorage.getItem('foodmatch_auth_token') || sessionStorage.getItem('foodmatch_auth_token');
    network.send('GET_USER_PROFILE', { authToken: token, playerName: this.player.name });

    this.profileModal.classList.remove('hidden');
    setTimeout(() => {
      if (this.saveProfileBtn) this.saveProfileBtn.focus();
    }, 50);
  }

  updateProfileModalStats(user, currentGameScore, currentGamePairs) {
    if (user) {
      if (this.profileTotalScore) this.profileTotalScore.textContent = user.totalScore !== undefined ? user.totalScore : 0;
      if (this.profileGamesPlayed) this.profileGamesPlayed.textContent = user.gamesPlayed !== undefined ? user.gamesPlayed : 0;
      if (this.profileTotalPairs) this.profileTotalPairs.textContent = user.pairsMatched !== undefined ? user.pairsMatched : 0;
      if (this.profileUsername) this.profileUsername.textContent = user.name || this.player.name;
      if (this.profileAvatarBig) {
        this.renderAvatarInto(this.profileAvatarBig, user.avatar || this.player.avatar, 'profile-avatar-img-big');
      }
    }
    if (this.profileCurrentGameScore) {
      const cur = currentGameScore !== undefined ? currentGameScore : (this.player.roundScore || 0);
      this.profileCurrentGameScore.textContent = cur;
    }
  }

  setLeaderboardTab(tab = 'current') {
    const isCurrent = tab === 'current';
    const isAll = tab === 'all';
    if (this.tabLeaderboardCurrent) this.tabLeaderboardCurrent.classList.toggle('active', isCurrent);
    if (this.tabLeaderboardAll) this.tabLeaderboardAll.classList.toggle('active', isAll);
    if (this.leaderboardCurrentView) this.leaderboardCurrentView.classList.toggle('hidden', !isCurrent);
    if (this.leaderboardAllView) this.leaderboardAllView.classList.toggle('hidden', !isAll);
  }

  handleDeleteAccountClick() {
    const userName = (this.authUser && this.authUser.name) ? this.authUser.name : this.player.name;
    const confirmed = confirm(`Вы уверены, что хотите безвозвратно удалить аккаунт «${userName}»?\n\nВсе ваши очки за все игры, открытые рецепты и статистика будут удалены с сервера.`);
    if (!confirmed) return;

    const token = localStorage.getItem('foodmatch_auth_token') || sessionStorage.getItem('foodmatch_auth_token');
    network.send('DELETE_ACCOUNT', { authToken: token });
  }

  saveProfile() {
    const fixedName = (this.authUser && this.authUser.name) ? this.authUser.name : (this.player.name || 'Шеф-Повар');
    this.player.name = fixedName;
    this.player.avatar = this.normalizeAvatarPath(this.tempAvatar || '/avatars/chef_male.svg');

    if (this.authUser) {
      this.authUser.name = this.player.name;
      this.authUser.avatar = this.player.avatar;
    }

    sessionStorage.setItem('foodmatch_player_name', this.player.name);
    sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
    localStorage.setItem('foodmatch_player_name', this.player.name);
    localStorage.setItem('foodmatch_player_avatar', this.player.avatar);

    this.updateHeaderProfile();
    if (this.profileModal) {
      this.profileModal.classList.add('hidden');
    }

    network.send('UPDATE_PROFILE', {
      playerName: this.player.name,
      avatar: this.player.avatar
    });
  }

  joinGame() {
    this.updateHeaderProfile();
    network.connect({
      playerName: this.player.name,
      avatar: this.player.avatar,
      roomId: this.player.roomId
    });
  }

  updateHeaderProfile() {
    if (this.headerPlayerAvatar) {
      this.renderAvatarInto(this.headerPlayerAvatar, this.player.avatar, 'header-avatar-img');
    }
    if (this.headerPlayerName) this.headerPlayerName.textContent = this.player.name;
    const currentScore = this.player.roundScore !== undefined ? this.player.roundScore : 0;
    if (this.headerPlayerScore) this.headerPlayerScore.textContent = currentScore;
    if (this.hudScoreVal) this.hudScoreVal.textContent = currentScore;

    // Keep victory window winner avatar synchronized with current player avatar
    if (this.showcaseWinnerName && this.showcaseWinnerAvatar) {
      const winnerName = (this.showcaseWinnerName.textContent || '').trim();
      const myName = (this.player.name || '').trim();
      if (winnerName && myName && (winnerName === myName || (this.authUser && winnerName === this.authUser.name))) {
        this.renderAvatarInto(this.showcaseWinnerAvatar, this.player.avatar, 'showcase-avatar-img');
      }
    }
  }

  handleRestartClick() {
    this.hasVotedRestart = true;
    network.send('RESTART_ROUND');
    if (this.showcaseRestartBtn) {
      this.showcaseRestartBtn.disabled = true;
      this.showcaseRestartBtn.textContent = '⏳ Вы готовы! Ожидание других участников...';
    }
    if (this.newRoundBtn) {
      this.newRoundBtn.textContent = '⏳ Ожидание...';
    }
    if (this.restartConfirmModal) {
      this.restartConfirmModal.classList.add('hidden');
    }
  }

  handleRestartVoteUpdate(payload) {
    const ready = payload.readyCount || 1;
    const total = payload.totalNeeded || 1;
    const isMe = (payload.voterSocketId && payload.voterSocketId === this.player.socketId) ||
                 (payload.voterName && payload.voterName === this.player.name);

    if (isMe) {
      this.hasVotedRestart = true;
    }
    if (Array.isArray(payload.readyPlayerNames) && this.player?.name) {
      if (payload.readyPlayerNames.includes(this.player.name)) {
        this.hasVotedRestart = true;
      }
    }

    if (this.showcaseRestartStatus) {
      if (ready >= total) {
        this.showcaseRestartStatus.textContent = `✅ Все игроки готовы (${ready}/${total})! Запуск нового стола...`;
        this.showcaseRestartStatus.classList.add('all-ready');
      } else {
        this.showcaseRestartStatus.textContent = `Готовы: ${ready} из ${total} участников. Ожидаем остальных...`;
        this.showcaseRestartStatus.classList.remove('all-ready');
      }
    }

    if (this.newRoundBtn) {
      this.newRoundBtn.textContent = `🔄 Готовы: ${ready}/${total}`;
    }

    // Explicit confirmation dialog for all players who haven't confirmed yet
    if (!this.hasVotedRestart && ready < total) {
      const initiator = payload.voterName || 'Другой игрок';
      if (this.restartConfirmMessage) {
        this.restartConfirmMessage.innerHTML = `Шеф <b>«${initiator}»</b> предлагает начать новую игру! Вы готовы?`;
      }
      if (this.restartConfirmVotesStatus) {
        this.restartConfirmVotesStatus.textContent = `Готовы: ${ready} из ${total} участников`;
      }
      if (this.restartConfirmModal) {
        this.restartConfirmModal.classList.remove('hidden');
      }
    } else if (this.hasVotedRestart && this.restartConfirmModal) {
      this.restartConfirmModal.classList.add('hidden');
    }
  }

  showPauseOverlay(title, reason, canResume = null) {
    this.isGamePaused = true;

    let allowResume = false;
    if (canResume !== null) {
      allowResume = canResume;
    } else {
      const snap = this.lastRoomSnapshot;
      const otherPlayersMissing = Array.isArray(snap?.players) && snap.players.some(p => {
        const isMe = (this.player.id && p.playerId === this.player.id) ||
                     (this.player.socketId && p.socketId === this.player.socketId) ||
                     (network.sessionToken && p.sessionToken === network.sessionToken) ||
                     ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());
        return !isMe && (p.isOnline === false || p.isAway);
      });
      allowResume = !otherPlayersMissing && snap?.hasMissingPlayers !== true;
    }

    if (this.pauseToggleBtn) {
      this.pauseToggleBtn.textContent = allowResume ? '▶️ Продолжить' : '⏸️ Пауза';
      this.pauseToggleBtn.disabled = !allowResume;
    }
    if (this.gamePauseOverlay) {
      if (this.pauseTitle && title) this.pauseTitle.textContent = title;
      if (this.pauseReason && reason) this.pauseReason.textContent = reason;

      if (this.resumeGameBtn) {
        if (allowResume) {
          this.resumeGameBtn.classList.remove('hidden');
        } else {
          this.resumeGameBtn.classList.add('hidden');
        }
      }
      if (this.abortAndRestartBtn) {
        this.abortAndRestartBtn.classList.remove('hidden');
      }
      this.gamePauseOverlay.classList.remove('hidden');
    }
  }

  hidePauseOverlay() {
    this.isGamePaused = false;
    this.isRoomServerPaused = false;
    if (this.pauseToggleBtn) {
      this.pauseToggleBtn.textContent = '⏸️ Пауза';
      this.pauseToggleBtn.disabled = false;
    }
    if (this.gamePauseOverlay) {
      this.gamePauseOverlay.classList.add('hidden');
    }
  }

  renderRoomPlayers(playersList) {
    if (!this.roomPlayersChips || !Array.isArray(playersList)) return;
    this.roomPlayersChips.innerHTML = '';

    // Filter out test players (/^(тест|test)/i) so phantom/test runners never display at table
    const visiblePlayers = playersList.filter(p => {
      const isMe = (this.player.id && p.playerId === this.player.id) ||
                   (this.player.socketId && p.socketId === this.player.socketId) ||
                   (network.sessionToken && p.sessionToken === network.sessionToken) ||
                   ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());
      if (isMe) return true;
      return !p.name || !/^(тест|test)/i.test(p.name.trim());
    });

    let onlineCount = 0;
    visiblePlayers.forEach(p => {
      if (p.isOnline !== false) onlineCount++;
      const isMe = (this.player.id && p.playerId === this.player.id) ||
                   (this.player.socketId && p.socketId === this.player.socketId) ||
                   (network.sessionToken && p.sessionToken === network.sessionToken) ||
                   ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());

      const card = document.createElement('div');
      card.className = `room-player-card${isMe ? ' is-me' : ''}${p.isOnline === false ? ' is-offline' : ''}`;
      
      const roundScore = p.roundScore !== undefined ? p.roundScore : (p.score || 0);
      const roundPairs = p.roundPairs !== undefined ? p.roundPairs : 0;
      const isOnline = p.isOnline !== false;

      card.innerHTML = `
        <div class="player-card-avatar-wrap">
          <span class="player-card-avatar">${this.renderAvatarHTML(p.avatar, 'player-card-avatar-img')}</span>
          <span class="player-status-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'В сети' : 'Оффлайн'}"></span>
        </div>
        <div class="player-card-info">
          <div class="player-card-name-row">
            <span class="player-card-name">${this.escapeHtml(p.name || 'Шеф-Повар')}</span>
            ${isMe ? '<span class="player-badge-you">Вы</span>' : ''}
          </div>
          <div class="player-card-stats">
            <span class="player-stat-pill score" title="Очки в раунде">⭐ ${roundScore}</span>
            <span class="player-stat-pill pairs" title="Собрано пар">🍽️ ${roundPairs}</span>
            ${p.comboStreak > 1 ? `<span class="player-stat-pill combo" title="Комбо">🔥 x${p.comboStreak}</span>` : ''}
          </div>
        </div>
      `;
      this.roomPlayersChips.appendChild(card);
    });

    this.updateOnlinePlayersCount(onlineCount);
  }

  initNetworkListeners() {
    network.on('status_change', (data) => {
      this.updateNetworkStatusPill(data.status);
      if (data.status === 'DISCONNECTED') {
        this.offlineBanner.classList.remove('hidden');
        this.offlineQueueBadge.textContent = `Очередь: ${data.queueLength || 0}`;
        this.showPauseOverlay('Обрыв связи с сервером', 'Потеря связи. Автоматическая попытка переподключения...');
      } else if (data.status === 'CONNECTED') {
        this.offlineBanner.classList.add('hidden');
        if (!this.isRoomServerPaused) {
          this.hidePauseOverlay();
        }
        if (this.simulateDropSocketBtn) {
          this.simulateDropSocketBtn.textContent = '🔌 Симуляция обрыва сети';
          this.simulateDropSocketBtn.classList.remove('btn-white');
          this.simulateDropSocketBtn.classList.add('btn-outline');
        }
      }
    });

    network.on('GAME_PAUSED', (payload) => {
      const reason = payload?.reason || 'Один из шеф-поваров потерял связь с сервером. Игра приостановлена.';
      this.isRoomServerPaused = true;
      this.showPauseOverlay('Игра приостановлена', reason);
      if (payload?.room?.elapsedSeconds !== undefined) {
        this.localTimerSeconds = payload.room.elapsedSeconds;
        this.renderTimerDisplay(this.localTimerSeconds);
      }
      this.appendAuditEntry({
        timestamp: new Date().toISOString(),
        description: `⏸️ <b>Пауза раунда</b>: ${this.escapeHtml(reason)}`,
        statusBadge: '⏸️ Пауза'
      });
    });

    network.on('GAME_RESUMED', (payload) => {
      this.isRoomServerPaused = false;
      this.hidePauseOverlay();
      if (payload?.room?.elapsedSeconds !== undefined) {
        this.localTimerSeconds = payload.room.elapsedSeconds;
        this.renderTimerDisplay(this.localTimerSeconds);
      }
      this.appendAuditEntry({
        timestamp: new Date().toISOString(),
        description: `▶️ <b>Игра возобновлена</b>: участники переподключены к столу`,
        statusBadge: '✅ В игре'
      });
      if (payload.room) this.handleRoomUpdate(payload.room);
    });

    network.on('PONG', (payload) => {
      const now = performance.now();
      const rtt = this.lastPingSentAt ? Math.round(now - this.lastPingSentAt) : Math.max(1, Date.now() - (payload?.clientTime || 0));
      if (this.labPingVal) {
        this.labPingVal.textContent = `${rtt} мс`;
      }
      this.recipeEditor.showConflictToast('📡 Пинг WebSocket (RTT)', `Задержка: ${rtt} мс (Full-Duplex WS)`);
      this.appendAuditEntry({
        timestamp: new Date().toISOString(),
        description: `📡 <b>WebSocket Ping / Pong</b>: RTT = <b>${rtt} мс</b>, full-duplex канал подтверждён`,
        statusBadge: '✅ Активен'
      });
    });

    network.on('ROOM_SYNC_RESULT', (payload) => {
      if (payload.room) {
        this.handleRoomUpdate(payload.room);
      }
      this.recipeEditor.showConflictToast('🔄 Синхронизация стола', 'Состояние 16 карточек и участников успешно согласовано с сервером');
      this.appendAuditEntry({
        timestamp: new Date().toISOString(),
        description: `🔄 <b>Authoritative State Sync</b>: снапшот комнаты (${payload.room?.cards?.length || 16} карт) подтверждён сервером`,
        statusBadge: '✅ Sync OK'
      });
    });

    network.on('INIT_STATE', (payload) => {
      if (payload.player) {
        this.player.id = payload.player.playerId;
        this.player.socketId = payload.player.socketId;
        this.player.name = payload.player.name || this.player.name;
        this.player.avatar = payload.player.avatar || this.player.avatar;
        this.player.score = payload.player.score || 0;
        this.player.roundScore = payload.player.roundScore || 0;
        this.player.comboStreak = payload.player.comboStreak || 0;
        if (this.player.avatar) {
          localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
          sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
        }
        if (this.player.name) {
          localStorage.setItem('foodmatch_player_name', this.player.name);
          sessionStorage.setItem('foodmatch_player_name', this.player.name);
        }
        this.updateHeaderProfile();
        this.updateComboStreakUI(this.player.comboStreak);

        if (Array.isArray(payload.player.roundDiscoveredRecipes)) {
          this.recipeEditor.setRecipes(payload.player.roundDiscoveredRecipes);
        }
      }
      if (payload.authUser) {
        this.updateAuthUI(payload.authUser);
      } else {
        const storedToken = localStorage.getItem('foodmatch_auth_token');
        if (!storedToken) {
          this.openAuthModal('login');
        }
      }
      if (payload.room) {
        if (payload.room.roomId) this.player.roomId = payload.room.roomId;
        this.handleRoomUpdate(payload.room);
        if (payload.room.players) {
          this.renderLeaderboardCurrent(payload.room.players);
        }
      } else if (payload.roomLeaderboard) {
        this.renderLeaderboardCurrent(payload.roomLeaderboard);
      }
      if (payload.leaderboard) this.renderLeaderboard(payload.leaderboard);
      if (payload.conflictAuditLog && this.renderConflictAudit) this.renderConflictAudit(payload.conflictAuditLog);
    });

    network.on('SESSION_RESUMED', (payload) => {
      if (payload.player) {
        this.player.id = payload.player.playerId;
        this.player.socketId = payload.player.socketId;
        this.player.name = payload.player.name || this.player.name;
        this.player.avatar = payload.player.avatar || this.player.avatar;
        this.player.score = payload.player.score || 0;
        this.player.roundScore = payload.player.roundScore || 0;
        this.player.comboStreak = payload.player.comboStreak || 0;
        if (this.player.avatar) {
          localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
          sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
        }
        if (this.player.name) {
          localStorage.setItem('foodmatch_player_name', this.player.name);
          sessionStorage.setItem('foodmatch_player_name', this.player.name);
        }
        this.updateHeaderProfile();
        this.updateComboStreakUI(this.player.comboStreak);

        if (Array.isArray(payload.player.roundDiscoveredRecipes)) {
          this.recipeEditor.setRecipes(payload.player.roundDiscoveredRecipes);
        }
      }
      if (payload.authUser) {
        this.updateAuthUI(payload.authUser);
      }
      if (payload.room) {
        if (payload.room.roomId) this.player.roomId = payload.room.roomId;
        this.handleRoomUpdate(payload.room);
        if (payload.room.players) {
          this.renderLeaderboardCurrent(payload.room.players);
        }
      } else if (payload.roomLeaderboard) {
        this.renderLeaderboardCurrent(payload.roomLeaderboard);
      }
      if (payload.leaderboard) this.renderLeaderboard(payload.leaderboard);
      if (payload.conflictAuditLog && this.renderConflictAudit) this.renderConflictAudit(payload.conflictAuditLog);
    });

    network.on('AUTH_SUCCESS', (payload) => {
      if (payload.authToken) {
        sessionStorage.setItem('foodmatch_auth_token', payload.authToken);
        localStorage.setItem('foodmatch_auth_token', payload.authToken);
      }
      this.updateAuthUI(payload.user);
      if (this.authModal) {
        this.authModal.classList.add('hidden');
      }
      this.isGamePaused = false;
      this.isRoomServerPaused = false;
      this.hidePauseOverlay();
      if (payload.player) {
        this.player.name = payload.player.name;
        this.player.avatar = payload.player.avatar;
        this.player.score = payload.player.score || 0;
        if (this.player.avatar) {
          localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
          sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
        }
        if (this.player.name) {
          localStorage.setItem('foodmatch_player_name', this.player.name);
          sessionStorage.setItem('foodmatch_player_name', this.player.name);
        }
        this.updateHeaderProfile();
      }
      this.recipeEditor.showConflictToast('🔑 Авторизация', payload.message || `Добро пожаловать, ${payload.user?.name}!`);
    });

    network.on('AUTH_ERROR', (payload) => {
      this.showAuthError(payload.message || 'Ошибка авторизации');
      soundEngine.playMismatch();
    });

    network.on('AUTH_INVALID', () => {
      sessionStorage.removeItem('foodmatch_auth_token');
      localStorage.removeItem('foodmatch_auth_token');
      this.updateAuthUI(null);
    });

    network.on('LOGOUT_SUCCESS', (payload) => {
      this.hasVotedRestart = false;
      this.victoryModalDismissedByUser = false;
      if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
      if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');
      sessionStorage.removeItem('foodmatch_auth_token');
      localStorage.removeItem('foodmatch_auth_token');
      this.updateAuthUI(null);
      this.isGamePaused = true;
      this.isRoomServerPaused = true;
      this.showPauseOverlay('Игра приостановлена', 'Вы вышли из учетной записи. Время игры приостановлено. Войдите, чтобы продолжить.');
      if (payload?.player) {
        this.player.name = payload.player.name;
        this.player.avatar = payload.player.avatar;
        this.updateHeaderProfile();
      }
      this.recipeEditor.showConflictToast('🚪 Выход', 'Вы вышли из учетной записи. Время игры приостановлено.');
      this.openAuthModal('login');
    });

    network.on('SYNC_TICK', (data) => {
      const snap = data?.snapshot || data?.room || data;
      if (snap && snap.roundState) this.handleRoomUpdate(snap);
    });

    network.on('RESTART_VOTE_UPDATED', (payload) => {
      this.handleRestartVoteUpdate(payload);
    });

    network.on('ROUND_STARTED', (payload) => {
      this.hasVotedRestart = false;
      this.victoryModalShownForRound = null;
      this.victoryModalDismissedByUser = false;
      if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
      if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');
      this.hidePauseOverlay();
      if (this.showcaseRestartBtn) {
        this.showcaseRestartBtn.disabled = false;
        this.showcaseRestartBtn.textContent = '🔄 Играть заново';
      }
      if (this.showcaseRestartStatus) {
        this.showcaseRestartStatus.textContent = 'Нажмите кнопку, чтобы начать новый раунд';
        this.showcaseRestartStatus.classList.remove('all-ready');
      }
      if (this.newRoundBtn) {
        this.newRoundBtn.textContent = '🔄 Заново';
      }
      this.localTimerSeconds = 0;
      this.renderTimerDisplay(0);
      this.recipeEditor.clearRecipes();
      this.player.roundScore = 0;
      this.player.comboStreak = 0;
      this.updateHeaderProfile();
      this.updateComboStreakUI(0);
      if (payload.room) {
        if (Array.isArray(payload.room.cards)) {
          this.lastRenderedRound = payload.room.roundNumber;
          this.renderCardGrid(payload.room.cards);
        }
        this.handleRoomUpdate(payload.room);
        if (payload.room.players) {
          this.renderLeaderboardCurrent(payload.room.players);
        }
      }
    });

    network.on('PLAYER_JOINED', (payload) => {
      if (payload.players) {
        this.renderRoomPlayers(payload.players);
        this.renderLeaderboardCurrent(payload.players);
      } else if (payload.playersCount) {
        this.updateOnlinePlayersCount(payload.playersCount);
      }
      if (payload.room) {
        this.handleRoomUpdate(payload.room);
      }
    });

    network.on('PLAYER_LEFT', (payload) => {
      if (payload.players) {
        this.renderRoomPlayers(payload.players);
        this.renderLeaderboardCurrent(payload.players);
      } else if (payload.playersCount) {
        this.updateOnlinePlayersCount(payload.playersCount);
      }
      if (payload.socketId) this.renderer.removeRemoteCursor(payload.socketId);
      if (payload.isPaused) {
        this.isRoomServerPaused = true;
        this.showPauseOverlay('Игра приостановлена', payload.pauseReason || 'Один из шеф-поваров потерял связь с сервером. Игра приостановлена.');
      }
      if (payload.room) {
        this.handleRoomUpdate(payload.room);
      }
    });

    network.on('PLAYER_RECONNECTED', (payload) => {
      if (payload.players) {
        this.renderRoomPlayers(payload.players);
        this.renderLeaderboardCurrent(payload.players);
      } else if (payload.playersCount) {
        this.updateOnlinePlayersCount(payload.playersCount);
      }
      if (payload.room) {
        this.handleRoomUpdate(payload.room);
      }
    });

    network.on('PLAYER_UPDATED', (payload) => {
      if (payload.players) {
        this.renderRoomPlayers(payload.players);
        this.renderLeaderboardCurrent(payload.players);
      }
      if (payload.player) {
        const isMe = (this.player.id && payload.player.playerId === this.player.id) ||
                     (this.player.socketId && payload.player.socketId === this.player.socketId) ||
                     (payload.player.name && this.player.name && payload.player.name.trim().toLowerCase() === this.player.name.trim().toLowerCase());
        if (isMe) {
          this.player.name = payload.player.name;
          this.player.avatar = payload.player.avatar;
          if (this.authUser) {
            this.authUser.avatar = payload.player.avatar;
            this.authUser.name = payload.player.name;
          }
          sessionStorage.setItem('foodmatch_player_avatar', payload.player.avatar);
          localStorage.setItem('foodmatch_player_avatar', payload.player.avatar);
          this.updateHeaderProfile();
        }
      }
    });

    network.on('PROFILE_UPDATED', (payload) => {
      if (payload.player) {
        this.player.name = payload.player.name || this.player.name;
        this.player.avatar = payload.player.avatar || this.player.avatar;
      }
      if (payload.user) {
        this.authUser = payload.user;
        this.player.avatar = payload.user.avatar || this.player.avatar;
        this.player.name = payload.user.name || this.player.name;
      }
      sessionStorage.setItem('foodmatch_player_name', this.player.name);
      sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
      localStorage.setItem('foodmatch_player_name', this.player.name);
      localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
      this.updateHeaderProfile();
    });

    network.on('CARD_FLIPPED', (payload) => {
      soundEngine.playCardFlip();
      this.updateSingleCardDOM(payload.cardIndex, payload.card, true);

      if (payload.isContention) {
        this.recipeEditor.showConflictToast('⚡ Арбитраж клика', payload.contentionDetails?.message || 'Карточка открыта первым!');
      }
    });

    network.on('PAIR_MATCHED', (payload) => {
      soundEngine.playPairMatch();

      if (Array.isArray(payload.cardIndices)) {
        payload.cardIndices.forEach(idx => {
          const c = payload.cards ? payload.cards.find(x => x.index === idx) : null;
          this.updateSingleCardDOM(idx, c, true, true);
          const el = this.cardsElements[idx];
          if (el) {
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            this.renderer.spawnConfetti(x, y, 25);
          }
        });
      }

      if (payload.remainingPairs !== undefined && this.remainingPairsVal) {
        const found = 8 - payload.remainingPairs;
        this.remainingPairsVal.textContent = `${found} / 8 пар`;
      }

      const isMe = (this.player.id && payload.player?.playerId === this.player.id) ||
                   (this.player.socketId && payload.player?.socketId === this.player.socketId) ||
                   ((payload.player?.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());

      if (isMe && payload.player) {
        this.player.score = payload.player.score;
        this.player.roundScore = payload.player.roundScore !== undefined ? payload.player.roundScore : 0;
        this.player.comboStreak = payload.player.comboStreak || 1;
        this.updateHeaderProfile();
        this.updateComboStreakUI(this.player.comboStreak);

        if (this.player.comboStreak > 1) {
          soundEngine.playComboStreak();
        }

        if (payload.matchedPair) {
          this.recipeEditor.addDiscoveredRecipe(payload.matchedPair);
        }
      }

      if (payload.players) {
        this.renderRoomPlayers(payload.players);
        this.renderLeaderboardCurrent(payload.players);
      }
    });

    network.on('PAIR_MISMATCH', (payload) => {
      soundEngine.playMismatch();

      if (payload.secondCard) {
        this.updateSingleCardDOM(payload.secondCard.index, payload.secondCard, true, false);
      } else if (payload.flipEvent) {
        this.updateSingleCardDOM(payload.flipEvent.cardIndex, payload.flipEvent.card, true, false);
      }

      const isMe = (this.player.id && payload.player?.playerId === this.player.id) ||
                   ((payload.player?.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());
      if (isMe) {
        this.player.comboStreak = 0;
        this.updateComboStreakUI(0);
      }

      if (payload.cardIndices) {
        payload.cardIndices.forEach(idx => {
          const el = this.cardsElements[idx];
          if (el && !el.classList.contains('matched')) {
            el.classList.add('shake');
          }
        });
      }
    });

    network.on('CARDS_UNFLIPPED', (payload) => {
      this.handleCardsUnflipped(payload.cardIndices);
    });

    network.on('FLIP_REJECTED', (payload) => {
      console.warn('[Game] Card flip rejected:', payload.reason);
      if (payload.reason === 'PLAYER_NOT_FOUND' || payload.reason === 'ROUND_NOT_ACTIVE') {
        this.joinGame();
      }
    });

    network.on('CARD_COLLISION_RESOLVED', (payload) => {
      soundEngine.playConflictAlert();
      this.recipeEditor.showConflictToast('⚡ Коллизия выбора', payload.demoNotice || payload.message || `${payload.winner} нажал быстрее!`);
    });

    network.on('LEADERBOARD_UPDATED', (payload) => {
      if (payload.leaderboard) this.renderLeaderboard(payload.leaderboard);
    });

    network.on('AUDIT_LOG_UPDATED', (payload) => {
      if (payload.auditLog) this.renderConflictAudit(payload.auditLog);
    });

    network.on('ROUND_COMPLETED', (payload) => {
      this.currentRoundState = 'SHOWCASE';
      this.victoryModalDismissedByUser = false;
      this.showRoundVictoryModal(payload);
      if (payload.room && payload.room.players) {
        this.renderLeaderboardCurrent(payload.room.players);
      } else if (payload.roomLeaderboard) {
        this.renderLeaderboardCurrent(payload.roomLeaderboard);
      }
    });

    network.on('ACCOUNT_DELETED', (payload) => {
      sessionStorage.removeItem('foodmatch_auth_token');
      localStorage.removeItem('foodmatch_auth_token');
      sessionStorage.removeItem('foodmatch_player_name');
      localStorage.removeItem('foodmatch_player_name');
      sessionStorage.removeItem('foodmatch_player_avatar');
      localStorage.removeItem('foodmatch_player_avatar');
      sessionStorage.removeItem('foodmatch_session_token');
      localStorage.removeItem('foodmatch_session_token');
      network.sessionToken = null;

      this.player.score = 0;
      this.player.roundScore = 0;
      this.player.comboStreak = 0;
      this.updateAuthUI(null);

      if (this.profileModal) {
        this.profileModal.classList.add('hidden');
      }

      this.recipeEditor.showConflictToast('🗑️ Аккаунт удален', payload?.message || 'Ваш аккаунт был успешно удален.');
      soundEngine.playConflictAlert();

      setTimeout(() => {
        this.openAuthModal('register');
      }, 350);
    });

    network.on('DELETE_ACCOUNT_ERROR', (payload) => {
      this.recipeEditor.showConflictToast('⚠️ Ошибка', payload?.message || 'Не удалось удалить аккаунт.');
      soundEngine.playMismatch();
    });

    network.on('USER_PROFILE_RESULT', (payload) => {
      if (payload.user) {
        this.authUser = { ...this.authUser, ...payload.user };
        if (payload.user.avatar) {
          this.player.avatar = payload.user.avatar;
          sessionStorage.setItem('foodmatch_player_avatar', this.player.avatar);
          localStorage.setItem('foodmatch_player_avatar', this.player.avatar);
          this.updateHeaderProfile();
        }
      }
      this.updateProfileModalStats(payload.user, payload.currentGameScore, payload.currentGamePairs);
    });
  }

  updateNetworkStatusPill(status) {
    this.netStatusPill.className = 'status-pill';
    if (status === 'CONNECTED') {
      this.netStatusPill.classList.add('status-connected');
      this.netStatusText.textContent = 'В сети';
    } else if (status === 'RECONNECTING') {
      this.netStatusPill.classList.add('status-reconnecting');
      this.netStatusText.textContent = 'Подключение...';
    } else {
      this.netStatusPill.classList.add('status-disconnected');
      this.netStatusText.textContent = 'Оффлайн';
    }
  }

  renderTimerDisplay(sec) {
    if (!this.roundTimerVal) return;
    const s = Math.max(0, sec || 0);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    this.roundTimerVal.textContent = `${m}:${ss}`;
  }

  updateOnlinePlayersCount(count) {
    if (!this.onlinePlayersCount) return;
    const n = Math.max(1, count || 1);
    this.onlinePlayersCount.textContent = n === 1 ? '1 онлайн' : `${n} онлайн`;
  }

  handleRoomUpdate(snapshot) {
    if (!snapshot) return;
    this.lastRoomSnapshot = snapshot;
    if (snapshot.roomId) this.player.roomId = snapshot.roomId;
    if (this.roomTitleLabel && snapshot.roomName) {
      this.roomTitleLabel.textContent = `👥 ${snapshot.roomName}:`;
    }

    // Online players
    if (Array.isArray(snapshot.players)) {
      this.renderRoomPlayers(snapshot.players);
      this.renderLeaderboardCurrent(snapshot.players);

      const isMe = (p) => (this.player.id && p.playerId === this.player.id) ||
                          (this.player.socketId && p.socketId === this.player.socketId) ||
                          (network.sessionToken && p.sessionToken === network.sessionToken) ||
                          ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());

      const me = snapshot.players.find(isMe);
      if (me) {
        if (!this.player.id && me.playerId) this.player.id = me.playerId;
        this.player.score = me.score || 0;
        this.player.roundScore = me.roundScore !== undefined ? me.roundScore : 0;
        this.player.comboStreak = me.comboStreak || 0;
        if (me.name && me.name !== this.player.name) this.player.name = me.name;
        const localAvatar = sessionStorage.getItem('foodmatch_player_avatar') || localStorage.getItem('foodmatch_player_avatar');
        if (localAvatar) {
          this.player.avatar = this.normalizeAvatarPath(localAvatar);
        } else if (me.avatar && me.avatar !== this.player.avatar) {
          this.player.avatar = this.normalizeAvatarPath(me.avatar);
        }
        this.updateHeaderProfile();
        this.updateComboStreakUI(this.player.comboStreak);
        if (Array.isArray(me.roundDiscoveredRecipes)) {
          this.recipeEditor.setRecipes(me.roundDiscoveredRecipes);
        }
      }

      this.renderer.syncRemoteCursors(snapshot.players, this.player.id, this.player.socketId, this.player.name);
    } else {
      const count = snapshot.playersCount || 1;
      this.updateOnlinePlayersCount(count);
    }

    // Remaining Pairs (e.g. "2 / 8 пар")
    const totalPairs = snapshot.totalPairs || 8;
    const remaining = snapshot.remainingPairs !== undefined ? snapshot.remainingPairs : 8;
    const foundPairs = Math.max(0, totalPairs - remaining);
    if (this.remainingPairsVal) {
      this.remainingPairsVal.textContent = `${foundPairs} / ${totalPairs} пар`;
    }

    // Pause state sync
    this.isRoomServerPaused = !!snapshot.isPaused;
    if (snapshot.isPaused) {
      this.showPauseOverlay('Игра приостановлена', snapshot.pauseReason || 'Один из шеф-поваров потерял связь. Ожидаем переподключения...');
    } else if (network.status === 'CONNECTED') {
      this.hidePauseOverlay();
    }

    // Sync round state & timer
    this.currentRoundState = snapshot.roundState;
    if (snapshot.roundState === 'ACTIVE' && snapshot.elapsedSeconds !== undefined) {
      this.localTimerSeconds = snapshot.elapsedSeconds;
    } else if (snapshot.roundState === 'SHOWCASE') {
      this.localTimerSeconds = snapshot.elapsedSeconds || this.localTimerSeconds;
    }
    this.renderTimerDisplay(this.localTimerSeconds);

    // Sync restart status if present
    if (snapshot.restartStatus) {
      const ready = snapshot.restartStatus.readyCount || 0;
      const total = snapshot.restartStatus.totalNeeded || 1;
      if (this.showcaseRestartStatus && !this.showcaseModal.classList.contains('hidden')) {
        if (ready >= total) {
          this.showcaseRestartStatus.textContent = `✅ Все игроки готовы (${ready}/${total})! Запуск нового стола...`;
          this.showcaseRestartStatus.classList.add('all-ready');
        } else if (ready > 0) {
          this.showcaseRestartStatus.textContent = `Готовы: ${ready} из ${total} участников. Ожидаем остальных...`;
          this.showcaseRestartStatus.classList.remove('all-ready');
        }
      }
      if (this.newRoundBtn && snapshot.roundState === 'SHOWCASE') {
        this.newRoundBtn.textContent = `🔄 Готовы: ${ready}/${total}`;
      }
    }

    // Cards Grid
    if (Array.isArray(snapshot.cards)) {
      const roundChanged = this.lastRenderedRound !== snapshot.roundNumber;
      if (roundChanged || this.cardsElements.length !== snapshot.cards.length || this.cardsState.length === 0) {
        this.lastRenderedRound = snapshot.roundNumber;
        this.renderCardGrid(snapshot.cards);
      } else {
        this.cardsState = snapshot.cards;
        snapshot.cards.forEach((card, idx) => {
          this.updateSingleCardDOM(idx, card, false, card.isMatched);
        });
      }
    }

    if (snapshot.roundState === 'SHOWCASE' && snapshot.lastWinnerInfo) {
      this.currentRoundNumber = snapshot.roundNumber;
      if (!this.victoryModalDismissedByUser) {
        if (this.victoryModalShownForRound !== snapshot.roundNumber) {
          this.showRoundVictoryModal(snapshot.lastWinnerInfo);
        } else if (this.showcaseModal && this.showcaseModal.classList.contains('hidden')) {
          this.showcaseModal.classList.remove('hidden');
        }
      }
    } else if (snapshot.roundState === 'ACTIVE' || snapshot.roundState === 'IDLE') {
      this.victoryModalShownForRound = null;
      this.victoryModalDismissedByUser = false;
      if (this.showcaseModal) this.showcaseModal.classList.add('hidden');
      if (this.newRoundBtn) this.newRoundBtn.textContent = '🔄 Заново';
    }
  }

  renderInitialCards() {
    if (!this.cardsGridContainer) return;
    this.cardsGridContainer.innerHTML = '';
    this.cardsElements = [];
    for (let i = 0; i < 16; i++) {
      const cardEl = document.createElement('div');
      cardEl.className = 'food-card';
      cardEl.dataset.index = i;
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back">🍴</div>
          <div class="card-face card-front">
            <span class="food-emoji">🍴</span>
            <span class="food-name">...</span>
            <span class="partner-hint">Пара</span>
            <span class="matched-badge">✓</span>
          </div>
        </div>
      `;
      cardEl.addEventListener('click', () => {
        this.handleCardClick(i);
      });
      this.cardsGridContainer.appendChild(cardEl);
      this.cardsElements.push(cardEl);
    }
  }

  renderCardGrid(cards) {
    if (!this.cardsGridContainer || !Array.isArray(cards)) return;
    this.cardsGridContainer.innerHTML = '';
    this.cardsElements = [];
    this.cardsState = cards;

    cards.forEach((card, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'food-card';
      cardEl.dataset.index = index;

      const isFlipped = card.isFlipped || card.isMatched;
      if (card.isMatched) {
        cardEl.classList.add('matched', 'flipped');
      } else if (card.isFlipped) {
        cardEl.classList.add('flipped');
      }

      const emoji = isFlipped && card.emoji ? card.emoji : '🍴';
      const name = isFlipped && card.name && card.name !== '?' ? card.name : '...';
      const partner = isFlipped && card.partnerName ? `Пара: ${card.partnerName}` : '';

      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back">🍴</div>
          <div class="card-face card-front">
            <span class="food-emoji">${emoji}</span>
            <span class="food-name">${this.escapeHtml(name)}</span>
            <span class="partner-hint">${this.escapeHtml(partner)}</span>
            <span class="matched-badge">✓</span>
          </div>
        </div>
      `;

      cardEl.addEventListener('click', () => {
        this.handleCardClick(index);
      });

      this.cardsGridContainer.appendChild(cardEl);
      this.cardsElements.push(cardEl);
    });

    this.renderer.resize();
  }

  updateSingleCardDOM(index, card, forceFlip = false, isMatch = false) {
    const el = this.cardsElements[index];
    if (!el) return;

    if (isMatch || card?.isMatched) {
      el.classList.add('matched', 'flipped');
      el.classList.remove('shake');
    } else if (forceFlip || card?.isFlipped) {
      el.classList.add('flipped');
      el.classList.remove('matched', 'shake');
    } else {
      el.classList.remove('flipped', 'matched', 'shake');
    }

    const emojiEl = el.querySelector('.food-emoji');
    const nameEl = el.querySelector('.food-name');
    const hintEl = el.querySelector('.partner-hint');

    if (card && (card.isFlipped || card.isMatched || forceFlip)) {
      if (emojiEl && card.emoji && card.emoji !== '🍴') emojiEl.textContent = card.emoji;
      if (nameEl && card.name && card.name !== '?') nameEl.textContent = card.name;
      if (hintEl && card.partnerName) hintEl.textContent = `Пара: ${card.partnerName}`;
    } else {
      if (emojiEl) emojiEl.textContent = '🍴';
      if (nameEl) nameEl.textContent = '...';
      if (hintEl) hintEl.textContent = '';
    }
  }

  handleCardsUnflipped(indices) {
    if (!Array.isArray(indices)) return;
    indices.forEach(idx => {
      const el = this.cardsElements[idx];
      if (el && !el.classList.contains('matched')) {
        el.classList.remove('flipped', 'shake');
      }
      if (this.cardsState && this.cardsState[idx]) {
        this.cardsState[idx].isFlipped = false;
        this.cardsState[idx].flippedBy = null;
      }
    });
  }

  handleCardClick(index) {
    if (!this.authUser) {
      this.openAuthModal('login');
      this.showAuthError('Для игры необходимо войти или зарегистрироваться!');
      soundEngine.playMismatch();
      return;
    }
    if (this.isGamePaused) {
      this.recipeEditor.showConflictToast('⏸️ Игра на паузе', 'Ожидаем переподключения шеф-повара к столу.');
      return;
    }
    const el = this.cardsElements[index];
    if (!el || el.classList.contains('matched') || el.classList.contains('flipped')) {
      return;
    }
    if (this.currentRoundState === 'IDLE') {
      this.currentRoundState = 'ACTIVE';
    }
    soundEngine.playCardFlip();
    network.send('FLIP_CARD', { cardIndex: index });
  }

  updateComboStreakUI(streak) {
    if (!this.comboStreakBadge) return;
    if (streak >= 2) {
      this.comboStreakBadge.classList.remove('hidden');
      this.comboStreakBadge.textContent = `🔥 x${streak}`;
    } else {
      this.comboStreakBadge.classList.add('hidden');
    }
  }

  showRoundVictoryModal(winnerInfo) {
    if (!this.showcaseModal) return;
    const rNum = winnerInfo?.roundNumber || this.victoryModalShownForRound || 1;
    if (this.victoryModalShownForRound === rNum) return;
    this.victoryModalShownForRound = rNum;
    this.currentRoundNumber = rNum;
    this.hasVotedRestart = false;

    const isMe = winnerInfo?.winnerName && (
      winnerInfo.winnerName === this.player.name ||
      (this.authUser && winnerInfo.winnerName === this.authUser.name) ||
      (winnerInfo.winnerPlayerId && winnerInfo.winnerPlayerId === this.player.playerId)
    );
    const displayAvatar = isMe
      ? (this.player.avatar || (this.authUser && this.authUser.avatar) || winnerInfo?.winnerAvatar || '/avatars/chef_male.svg')
      : (winnerInfo?.winnerAvatar || '/avatars/chef_male.svg');

    if (this.showcaseWinnerAvatar) {
      this.renderAvatarInto(this.showcaseWinnerAvatar, displayAvatar, 'showcase-avatar-img');
    }
    if (this.showcaseWinnerName) this.showcaseWinnerName.textContent = winnerInfo.winnerName || 'Шеф-Повар';
    if (this.showcaseScore) this.showcaseScore.textContent = `+${winnerInfo.winnerScore || 800}`;
    if (this.showcasePairs) this.showcasePairs.textContent = `${winnerInfo.winnerPairs || 8}`;
    if (this.showcaseMessage) this.showcaseMessage.textContent = winnerInfo.message || 'Все пары найдены!';

    if (this.showcaseRestartBtn) {
      this.showcaseRestartBtn.disabled = false;
      this.showcaseRestartBtn.textContent = '🔄 Играть заново';
    }
    if (this.showcaseRestartStatus) {
      this.showcaseRestartStatus.textContent = 'Нажмите кнопку, чтобы начать новый раунд';
      this.showcaseRestartStatus.classList.remove('all-ready');
    }

    if (this.restartConfirmModal) this.restartConfirmModal.classList.add('hidden');

    this.showcaseModal.classList.remove('hidden');
    this.renderer.spawnVictoryCelebration();
    soundEngine.playWinFanfare();
  }

  isTestPlayerName(name) {
    if (!name) return false;
    const n = String(name).trim().toLowerCase();
    if (/^(тест|test)/i.test(n)) return true;
    if (/^шеф\s*([0-9]+|[аб])$/i.test(n)) return true;
    if (/^шеф-повар\s*\([0-9]+\)$/i.test(n)) return true;
    if (/^супер-шеф$/i.test(n)) return true;
    if (/^(alice|bob)$/i.test(n)) return true;
    return false;
  }

  renderLeaderboardCurrent(playersList) {
    if (!this.leaderboardCurrentTbody) return;
    this.leaderboardCurrentTbody.innerHTML = '';

    const visiblePlayers = Array.isArray(playersList)
      ? playersList.filter(p => {
          const isMe = (this.player.id && p.playerId === this.player.id) ||
                       (this.player.socketId && p.socketId === this.player.socketId) ||
                       (network.sessionToken && p.sessionToken === network.sessionToken) ||
                       ((p.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());
          if (isMe) return true;
          return !p.name || !this.isTestPlayerName(p.name);
        })
      : [];

    if (visiblePlayers.length === 0) {
      this.leaderboardCurrentTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">За столом пока нет игроков</td></tr>`;
      return;
    }

    const sorted = [...visiblePlayers].sort((a, b) => {
      const scoreA = a.roundScore !== undefined ? a.roundScore : 0;
      const scoreB = b.roundScore !== undefined ? b.roundScore : 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const pairsA = a.roundPairs !== undefined ? a.roundPairs : 0;
      const pairsB = b.roundPairs !== undefined ? b.roundPairs : 0;
      return pairsB - pairsA;
    });

    sorted.forEach((item, index) => {
      const tr = document.createElement('tr');
      const rank = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}`));
      const isMe = (this.player.id && item.playerId === this.player.id) ||
                   (this.player.socketId && item.socketId === this.player.socketId) ||
                   (network.sessionToken && item.sessionToken === network.sessionToken) ||
                   ((item.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase());

      const roundScore = item.roundScore !== undefined ? item.roundScore : 0;
      const roundPairs = item.roundPairs !== undefined ? item.roundPairs : 0;
      const combo = item.comboStreak > 1 ? `🔥 x${item.comboStreak}` : '—';
      const isOnline = item.isOnline !== false;

      tr.innerHTML = `
        <td>${rank}</td>
        <td>
          ${this.renderAvatarHTML(item.avatar, 'table-avatar-img')} <b>${this.escapeHtml(item.name || 'Шеф-Повар')}</b>
          ${isMe ? '<span class="player-badge-you" style="margin-left:6px;">Вы</span>' : ''}
        </td>
        <td style="color:var(--primary);font-weight:700;">⭐ ${roundScore}</td>
        <td>${roundPairs}</td>
        <td>${combo}</td>
        <td>
          <span class="player-status-dot ${isOnline ? 'online' : 'offline'}" style="display:inline-block; position:static; vertical-align:middle; margin-right:4px;"></span>
          <span style="font-size:12px; color:${isOnline ? 'var(--success)' : 'var(--danger)'};">${isOnline ? 'В игре' : 'Оффлайн'}</span>
        </td>
      `;
      this.leaderboardCurrentTbody.appendChild(tr);
    });
  }

  renderLeaderboard(list) {
    if (!this.leaderboardTbody || !Array.isArray(list)) return;
    this.leaderboardTbody.innerHTML = '';

    const visibleList = list.filter(item => {
      return item && item.name && !this.isTestPlayerName(item.name);
    });

    if (visibleList.length === 0) {
      this.leaderboardTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">Список лидеров пуст</td></tr>`;
      return;
    }

    visibleList.slice(0, 10).forEach((item, index) => {
      const tr = document.createElement('tr');
      const rank = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}`));
      const isMe = (item.name || '').trim().toLowerCase() === (this.player.name || '').trim().toLowerCase();

      tr.innerHTML = `
        <td>${rank}</td>
        <td>
          ${this.renderAvatarHTML(item.avatar, 'table-avatar-img')} <b>${this.escapeHtml(item.name)}</b>
          ${isMe ? '<span class="player-badge-you" style="margin-left:6px;">Вы</span>' : ''}
        </td>
        <td style="color:var(--primary);font-weight:700;">⭐ ${item.totalScore}</td>
        <td>${item.pairsMatched || 0}</td>
        <td>${item.gamesPlayed || 0}</td>
      `;
      this.leaderboardTbody.appendChild(tr);

      if (isMe && this.authUser) {
        this.authUser.gamesPlayed = item.gamesPlayed !== undefined ? item.gamesPlayed : this.authUser.gamesPlayed;
        this.authUser.totalScore = item.totalScore !== undefined ? item.totalScore : this.authUser.totalScore;
        this.authUser.pairsMatched = item.pairsMatched !== undefined ? item.pairsMatched : this.authUser.pairsMatched;
        if (this.profileGamesPlayed && !this.profileModal.classList.contains('hidden')) {
          this.profileGamesPlayed.textContent = this.authUser.gamesPlayed || 0;
        }
      }
    });
  }

  renderMatchHistory(list) {
    // Game history has been removed
  }

  appendAuditEntry({ timestamp, description, statusBadge = '✅ OK' }) {
    if (!this.conflictAuditTbody) return;
    const placeholder = this.conflictAuditTbody.querySelector('td[colspan]');
    if (placeholder) {
      this.conflictAuditTbody.innerHTML = '';
    }
    const tr = document.createElement('tr');
    const timeStr = new Date(timestamp || Date.now()).toLocaleTimeString();
    tr.innerHTML = `
      <td style="color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap;">${timeStr}</td>
      <td>${description}</td>
      <td style="text-align:right;"><span class="audit-badge badge-resolved">${statusBadge}</span></td>
    `;
    this.conflictAuditTbody.insertBefore(tr, this.conflictAuditTbody.firstChild);
    while (this.conflictAuditTbody.children.length > 20) {
      this.conflictAuditTbody.removeChild(this.conflictAuditTbody.lastChild);
    }
  }

  renderConflictAudit(logList) {
    if (!this.conflictAuditTbody || !Array.isArray(logList)) return;
    this.conflictAuditTbody.innerHTML = '';

    if (logList.length === 0) {
      this.conflictAuditTbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:12px;">Сетевых событий пока нет. Нажмите одну из кнопок проверки выше.</td></tr>`;
      return;
    }

    logList.slice(0, 10).forEach(entry => {
      const tr = document.createElement('tr');
      const timeStr = new Date(entry.timestamp).toLocaleTimeString();
      const isRace = entry.targetType === 'CARD_FLIP_RACE';

      let description = entry.description || '';
      if (!description) {
        if (isRace) {
          const delta = entry.timeDeltaMs ? `${entry.timeDeltaMs.toFixed(1)} мс` : '14.2 мс';
          const target = entry.targetTitle || `Карточка #${(entry.cardIndex || 0) + 1}`;
          const winner = entry.winner || 'Шеф-Повар';
          description = `⚡ <b>${this.escapeHtml(target)}</b>: ${this.escapeHtml(winner)} нажал(а) быстрее на <b>${delta}</b> (арбитр hrtime)`;
        } else if (entry.resolutionMessage) {
          description = this.escapeHtml(entry.resolutionMessage);
        } else {
          const title = entry.targetTitle || 'Элемент стола';
          description = `📝 <b>${this.escapeHtml(title)}</b>: согласовано сетевое действие`;
        }
      }

      tr.innerHTML = `
        <td style="color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap;">${timeStr}</td>
        <td>${description}</td>
        <td style="text-align:right;"><span class="audit-badge badge-resolved">${entry.statusBadge || '✅ Решено'}</span></td>
      `;
      this.conflictAuditTbody.appendChild(tr);
    });
  }

  startLoop() {
    const loop = () => {
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  normalizeAvatarPath(avatar) {
    if (!avatar || typeof avatar !== 'string') return '/avatars/chef_male.svg';
    const trimmed = avatar.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('data:image/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const emojiMap = {
      '👨‍🍳': '/avatars/chef_male.svg',
      '👩‍🍳': '/avatars/chef_female.svg',
      '🦊': '/avatars/fox.svg',
      '🐼': '/avatars/panda.svg',
      '🦁': '/avatars/lion.svg',
      '🐱': '/avatars/cat.svg',
      '🍕': '/avatars/pizza.svg',
      '🍔': '/avatars/burger.svg',
      '❓': '/avatars/chef_male.svg'
    };
    return emojiMap[trimmed] || '/avatars/chef_male.svg';
  }

  renderAvatarHTML(avatar, className = '', alt = 'Аватар') {
    const src = this.normalizeAvatarPath(avatar);
    const cls = className ? ` class="${this.escapeHtml(className)}"` : '';
    return `<img src="${this.escapeHtml(src)}"${cls} alt="${this.escapeHtml(alt)}" loading="lazy">`;
  }

  renderAvatarInto(container, avatar, className = '', alt = 'Аватар') {
    if (!container) return;
    container.innerHTML = this.renderAvatarHTML(avatar, className, alt);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
