'use strict';

document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#main-nav');
const dialog = document.querySelector('#project-dialog');
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

if (dialog && typeof dialog.showModal === 'function') {
  document.querySelectorAll('[data-open-project]').forEach(button => {
    button.hidden = false;
    button.addEventListener('click', () => dialog.showModal());
  });
  dialog.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}

// Sharing is optional: the project page remains readable without JavaScript.
const copyButton = document.querySelector('[data-copy-link]');
const copyStatus = document.querySelector('[data-copy-status]');
const copyFallback = document.querySelector('.copy-fallback');
if (copyButton && copyStatus && copyFallback) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    const url = document.querySelector('link[rel="canonical"]').href;
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(url);
      copyFallback.hidden = true;
      copyStatus.textContent = 'Ссылка скопирована. Можно отправить её в сообщении.';
    } catch {
      copyStatus.textContent = 'Не удалось скопировать автоматически. Используйте адрес ниже.';
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
