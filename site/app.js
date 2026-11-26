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
  const desktop = window.matchMedia('(min-width: 931px)');
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


// Native screenshot viewer with three unique screens. Direct links work without JavaScript.
const screenDialog = document.querySelector('#screen-dialog');
if (screenDialog && typeof screenDialog.showModal === 'function') {
  const image = screenDialog.querySelector('#screen-dialog-image');
  const caption = screenDialog.querySelector('#screen-dialog-caption');
  const position = screenDialog.querySelector('#screen-dialog-position');
  const previous = screenDialog.querySelector('#screen-prev');
  const next = screenDialog.querySelector('#screen-next');
  const close = screenDialog.querySelector('.screen-dialog-close');
  const links = Array.from(document.querySelectorAll('[data-screen-preview]'));
  const screens = Array.from(document.querySelectorAll('.android-gallery-grid [data-screen-preview]'));
  let index = 0;
  let opener = null;
  const show = value => {
    index = (value + screens.length) % screens.length;
    const link = screens[index];
    const source = link.querySelector('img');
    image.src = link.href;
    image.alt = source.alt;
    caption.textContent = link.closest('figure').querySelector('figcaption').innerText.replace(/\s+/g, ' ').trim();
    position.textContent = 'Экран ' + (index + 1) + ' из ' + screens.length;
  };
  if (screens.length) {
    for (const link of links) {
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || screenDialog.open) return;
        const target = screens.findIndex(screen => screen.href === link.href);
        if (target < 0) return;
        event.preventDefault();
        opener = link;
        show(target);
        screenDialog.showModal();
        close.focus();
      });
    }
    previous.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));
    close.addEventListener('click', () => screenDialog.close());
    screenDialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + (event.key === 'ArrowRight' ? 1 : -1));
      }
    });
    screenDialog.addEventListener('click', event => {
      if (event.target === screenDialog) {
        const rect = screenDialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) screenDialog.close();
      }
    });
    screenDialog.addEventListener('close', () => {
      if (screenDialog.open) return;
      image.removeAttribute('src');
      image.alt = '';
      caption.textContent = '';
      position.textContent = '';
      if (opener && opener.isConnected) opener.focus({preventScroll:true});
      opener = null;
    });
  }
}
