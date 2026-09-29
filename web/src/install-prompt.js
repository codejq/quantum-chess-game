// Offers to install the game on phones and tablets, as a pop-up the player can
// accept, postpone ("Later") or decline for good ("No thanks").
const CHOICE_STORAGE_KEY = 'quantum-chess-install-choice';
const LATER_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_AFTER_MS = 2500;
const WAIT_FOR_BROWSER_PROMPT_MS = 4000;

let deferredPrompt = null;

export function initInstallPrompt() {
  if (isNativeApp()) return;
  registerServiceWorker();
  if (!isMobileDevice() || isRunningInstalled() || !shouldAsk()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-bar hidden; the pop-up offers the install instead.
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    saveChoice('installed');
    closePopup();
  });

  const delay = isIos() ? SHOW_AFTER_MS : Math.max(SHOW_AFTER_MS, WAIT_FOR_BROWSER_PROMPT_MS);
  setTimeout(showPopup, delay);
}

function showPopup() {
  if (document.querySelector('.install-popup') || isRunningInstalled()) return;

  const popup = document.createElement('div');
  popup.className = 'install-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'false');
  popup.setAttribute('aria-labelledby', 'install-popup-title');
  popup.innerHTML = `
    <div class="install-card">
      <img class="install-icon" src="./icons/icon-192.png" alt="" width="56" height="56" />
      <div class="install-text">
        <h2 id="install-popup-title">Install Quantum Chess</h2>
        <p class="install-lead">Add the game to your home screen to play full screen, even offline.</p>
        <p class="install-steps" hidden></p>
      </div>
      <div class="install-actions">
        <button type="button" class="install-yes">Install</button>
        <button type="button" class="install-later">Later</button>
        <button type="button" class="install-no">No thanks</button>
      </div>
    </div>`;
  document.body.append(popup);
  requestAnimationFrame(() => popup.classList.add('is-open'));

  popup.querySelector('.install-yes').addEventListener('click', () => install(popup));
  popup.querySelector('.install-later').addEventListener('click', () => {
    saveChoice(`later:${Date.now()}`);
    closePopup();
  });
  popup.querySelector('.install-no').addEventListener('click', () => {
    saveChoice('never');
    closePopup();
  });
  popup.querySelector('.install-yes').focus({ preventScroll: true });
}

async function install(popup) {
  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    saveChoice(outcome === 'accepted' ? 'installed' : `later:${Date.now()}`);
    closePopup();
    return;
  }

  // No install dialog from the browser (iPhone and iPad, or some Android browsers):
  // show the manual steps instead.
  const steps = popup.querySelector('.install-steps');
  steps.textContent = isIos()
    ? 'Tap the Share button in Safari, then choose “Add to Home Screen”.'
    : 'Open your browser menu (⋮), then choose “Install app” or “Add to Home screen”.';
  steps.hidden = false;
  popup.querySelector('.install-lead').hidden = true;
  const yes = popup.querySelector('.install-yes');
  yes.textContent = 'Got it';
  yes.replaceWith(yes.cloneNode(true));
  popup.querySelector('.install-yes').addEventListener('click', () => {
    saveChoice(`later:${Date.now()}`);
    closePopup();
  });
}

function closePopup() {
  const popup = document.querySelector('.install-popup');
  if (!popup) return;
  popup.classList.remove('is-open');
  setTimeout(() => popup.remove(), 250);
}

function shouldAsk() {
  const choice = readChoice();
  if (choice === 'never' || choice === 'installed') return false;
  if (choice?.startsWith('later:')) return Date.now() - Number(choice.slice(6)) > LATER_DELAY_MS;
  return true;
}

function readChoice() {
  try {
    return localStorage.getItem(CHOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveChoice(choice) {
  try {
    localStorage.setItem(CHOICE_STORAGE_KEY, choice);
  } catch {
    // Without storage the pop-up simply asks again on the next visit.
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The game still works online without the offline cache.
  });
}

function isMobileDevice() {
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOs;
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isRunningInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isNativeApp() {
  return '__TAURI_INTERNALS__' in window;
}
