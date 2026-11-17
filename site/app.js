'use strict';

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
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
}

if (dialog && typeof dialog.showModal === 'function') {
  document.querySelectorAll('[data-open-project]').forEach(button => {
    button.addEventListener('click', () => dialog.showModal());
  });
  dialog.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}
