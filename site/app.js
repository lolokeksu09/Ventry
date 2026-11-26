'use strict';

document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#main-nav');
const year = document.querySelector('#year');

if (year) year.textContent = String(new Date().getFullYear());

if (menuButton && menu) {
  const closeMenu = () => {
    menu.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Открыть меню');
  };

  menuButton.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
  });
  const desktop = window.matchMedia('(min-width: 801px)');
  desktop.addEventListener('change', closeMenu);
  menu.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!menu.contains(document.activeElement) && document.activeElement !== menuButton) closeMenu();
    });
  });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('is-open')) {
      closeMenu();
      menuButton.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
}

// Sharing is optional: the project page remains readable without JavaScript.
const copyButton = document.querySelector('[data-copy-link]');
const copyStatus = document.querySelector('[data-copy-status]');
const copyFallback = document.querySelector('.copy-fallback');
if (copyButton && copyStatus && copyFallback) {
  copyButton.hidden = false;
  let clearStatusTimer;
  copyButton.addEventListener('click', async () => {
    clearTimeout(clearStatusTimer);
    copyStatus.textContent = '';
    const url = document.querySelector('link[rel="canonical"]').href;
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(url);
      copyFallback.hidden = true;
      copyStatus.textContent = 'Ссылка скопирована';
      clearStatusTimer = setTimeout(() => { copyStatus.textContent = ''; }, 3000);
    } catch {
      copyStatus.textContent = 'Не удалось скопировать автоматически. Используйте адрес ниже.';
      clearStatusTimer = setTimeout(() => { copyStatus.textContent = ''; }, 6000);
      copyFallback.hidden = false;
      const input = copyFallback.querySelector('input');
      input.value = url;
      input.focus();
      input.select();
    } finally {
      copyButton.disabled = false;
    }
  });
}


// Native, keyboard-accessible screenshot viewer. Links remain usable without JavaScript.
const screenDialog = document.querySelector('#screen-dialog');
if (screenDialog && typeof screenDialog.showModal === 'function') {
  const screenImage = screenDialog.querySelector('#screen-dialog-image');
  const screenCaption = screenDialog.querySelector('#screen-dialog-caption');

  document.querySelectorAll('[data-screen-preview]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const sourceImage = link.querySelector('img');
      if (!sourceImage) return;
      event.preventDefault();
      screenImage.src = link.href;
      screenImage.alt = sourceImage.alt;
      const figure = link.closest('figure');
      const caption = figure && figure.querySelector('figcaption');
      screenCaption.textContent = caption ? caption.innerText.replace(/\\s+/g, ' ').trim() : sourceImage.alt;
      screenDialog.showModal();
    });
  });

  screenDialog.addEventListener('click', event => {
    if (event.target === screenDialog) screenDialog.close();
  });
  screenDialog.addEventListener('close', () => {
    screenImage.removeAttribute('src');
    screenImage.alt = '';
    screenCaption.textContent = '';
  });
}
