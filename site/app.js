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


// Local-only search over static help; all content remains readable without JS.
const knowledge = document.querySelector('[data-knowledge]');
if (knowledge) {
  const controls = knowledge.querySelector('[data-knowledge-controls]');
  const search = controls.querySelector('[data-knowledge-search]');
  const filters = [...controls.querySelectorAll('[data-knowledge-filter]')];
  const items = [...knowledge.querySelectorAll('[data-knowledge-item]')];
  const count = controls.querySelector('[data-knowledge-count]');
  const empty = controls.querySelector('[data-knowledge-empty]');
  const normalize = value => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  const indexed = items.map(el => ({el, text: normalize(el.textContent), category: el.dataset.knowledgeItem}));
  let category = 'all';
  const refresh = () => {
    const terms = normalize(search.value.slice(0, 120)).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const item of indexed) {
      const match = (category === 'all' || item.category === category) && terms.every(term => item.text.includes(term));
      item.el.hidden = !match;
      if (match) shown++;
    }
    for (const button of filters) button.setAttribute('aria-pressed', String(button.dataset.knowledgeFilter === category));
    count.textContent = 'Найдено: ' + shown + ' из ' + items.length;
    empty.hidden = shown !== 0;
  };
  const reset = () => {search.value = '';category = 'all';refresh();};
  search.addEventListener('input', refresh);
  filters.forEach(button => button.addEventListener('click', () => {category = button.dataset.knowledgeFilter;refresh();}));
  controls.querySelector('[data-knowledge-reset]').addEventListener('click', () => {reset();search.focus();});
  const revealAnchor = hash => {
    let target;
    try {target = document.getElementById(decodeURIComponent(hash.slice(1)));} catch {return;}
    if (!target || !knowledge.contains(target)) return;
    if (target.closest('[data-knowledge-item][hidden]')) {
      reset();
      target.scrollIntoView({block:'start'});
    }
  };
  window.addEventListener('hashchange', () => revealAnchor(location.hash));
  knowledge.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link) revealAnchor(link.hash);
  });
  controls.hidden = false;
  refresh();
}


// Public availability: one bounded check per visit or explicit retry, no polling.
const availability = document.querySelector('[data-availability]');
if (availability) {
  const button = availability.querySelector('#availability-refresh');
  const summary = availability.querySelector('#availability-summary');
  const time = availability.querySelector('#availability-time');
  const services = [
    {key: 'health', path: '/healthz', method: 'GET', validate: async response => (await response.text()).trim() === 'ok'},
    {key: 'home', path: '/', method: 'HEAD'},
    {key: 'demo', path: '/raschet/', method: 'HEAD'},
  ];
  let running = false;
  function show(service, state, message) {
    const row = availability.querySelector('[data-service="' + service.key + '"]');
    const label = row.querySelector('.availability-state');
    label.dataset.state = state;
    label.textContent = message;
  }
  async function check(service) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(service.path, {method: service.method, credentials:'omit', cache:'no-store', redirect:'error', signal:controller.signal});
      if (!response.ok) {
        show(service,'warning','HTTP ' + response.status);
        return false;
      }
      if (service.validate && !(await service.validate(response))) {
        show(service,'warning','Неожиданный ответ');
        return false;
      }
      show(service,'available','Доступно');
      return true;
    } catch {
      show(service,'unknown','Не удалось проверить');
      return false;
    } finally {clearTimeout(timeout);}
  }
  async function run() {
    if (running) return;
    running = true;
    button.disabled = true;
    summary.textContent = 'Проверяем публичные адреса…';
    for (const service of services) show(service,'checking','Проверяем…');
    const results = await Promise.all(services.map(check));
    const passed = results.filter(Boolean).length;
    summary.textContent = passed === services.length
      ? 'Все три публичных адреса ответили успешно.'
      : 'Успешных ответов: ' + passed + ' из ' + services.length + '. Остальные адреса требуют повторной проверки.';
    time.textContent = 'Последняя проверка: ' + new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'medium'}).format(new Date()) + ' (местное время)';
    button.disabled = false;
    running = false;
  }
  button.hidden = false;
  button.addEventListener('click',run);
  run();
}
