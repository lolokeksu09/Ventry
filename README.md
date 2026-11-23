# Ventry

Ventry — сайт цифровых проектов. Первый представленный проект — «Расчёт» (в разработке).

## Публичный сайт

**Основной HTTPS:** https://ventrylab.top/

**Сохранённый технический HTTPS:** https://135-106-227-179.sslip.io/

Адрес `http://135.106.227.179/` по-прежнему перенаправляется на технический HTTPS-хост (308). Старые ссылки и маршруты доступны, но canonical, Open Graph и sitemap указывают на `ventrylab.top`.

Caddy получает и продлевает публичный сертификат ACME автоматически; `/healthz` отвечает `ok`; GitHub Actions обращается к нему по HTTPS с проверкой сертификата. Сам Caddy использует сохранённые Docker-тома для сертификатов.

## Структура

- `site/` — статический адаптивный сайт (HTML, CSS, JavaScript, SVG).
- `site/fonts/` — локальные Golos Text WOFF2 (кириллица/латиница) и лицензия SIL OFL.
- `site/og-cover.png` — обложка ссылки 1200×630, согласованная с оформлением сайта.
- `site/projects/raschet/` — отдельная страница проекта «Расчёт», доступная по прямой ссылке и без JavaScript.
- `tools/verify-site.py` — проверка внутренних маршрутов, фрагментов и метаданных.
- `docs/AUDIT.md` — аудит, реестр текущего улучшения и точка продолжения.
- `docs/VENTRY-DESIGN-CONCEPT-2.0.md` — предлагаемая концепция корпоративного сайта Ventry 2.0, архитектура страниц, контент, визуальная система и доступность.
- `docs/VENTRY-DESIGN-ROADMAP-2.0.md` — этапы согласования, макетирования, реализации, проверки и публикации Ventry 2.0.
- `deploy/Caddyfile` — Caddy, HTTPS, CSP, фильтрация опасных URL, перенаправление HTTP и `/healthz`.
- `deploy/Dockerfile` — официальный runtime Caddy с заменённым бинарником, собранным из Caddy v2.11.9 с `golang.org/x/net v0.62.0`.
- `tools/build-patched-caddy.sh` — сборка патченного Caddy в CI на Go 1.27.4; бинарник не хранится в Git.
- `compose.yaml` — изолированный Docker Compose-проект `ventry`.
- `.github/workflows/deploy.yml` — Gitleaks, тесты, сборка и проверка Caddy, деплой из `main`.
- `.github/workflows/security-audit.yml` — еженедельная проверка итогового Caddy-образа Trivy с ошибкой при устранимых HIGH/CRITICAL.
- `docs/SECURITY-AUDIT-2026-11.md` — аудит безопасности и закрытие `CVE-2026-78661`.
- `.github/workflows/vds-status.yml` — ручная проверка SSH-доступа к VDS.
- `PROJECT.md` — подтверждённые цели, ограничения и критерии приёмки.

## Сервер и адрес

- Selectel VDS: `135.106.227.179`.
- Каталог: `/opt/ventry/`.
- Порты: TCP 80/443 и UDP 443 (публикуются только в контейнере `ventry-web-1`).
- Основной HTTPS-хост: `ventrylab.top`.
- Старый HTTPS-хост: `135-106-227-179.sslip.io` (оставлен для существующих ссылок).
- Оба домена явно закреплены в `deploy/Caddyfile`. Переменная `VENTRY_SITE_ADDRESS` больше не используется в Docker Compose, поэтому старое значение в `/opt/ventry/.env` не может изменить публичный хост при деплое.
- GitHub Actions не изменяет `/opt/ventry/.env` и Docker-тома. При изменении доменов обновляются Caddyfile, SEO-метаданные и проверки деплоя совместно.
- Перед выдачей сертификатов DNS должен указывать на сервер, а TCP 80/443 должны быть доступны для ACME.

## GitHub Actions и безопасность

Секреты `VENTRY_SSH_KEY` (приватный SSH-ключ) и `VENTRY_KNOWN_HOSTS` (закреплённый ключ сервера) находятся только в GitHub Actions Secrets. Не храните их в репозитории.

`Deploy Ventry` последовательно:

1. На PR и перед публикацией сканирует историю Gitleaks, проверяет исходники, собирает Caddy 2.11.9 с исправленным `x/net v0.62.0`, проверяет зависимости бинарника и тестирует Caddy по HTTP.
2. Передаёт через GitHub artifact **тот же проверенный бинарник** в задачу деплоя, записывает SHA в `site/version.json` и создаёт tar-архив с `compose.yaml`, `site/` и `deploy/` (включая бинарник).
3. Передаёт архив через SSH-команду `ventry-deploy`, которую ограничивает серверный entrypoint `/usr/local/sbin/ventry-github-status`.
4. Сервер проверяет пути архива, обновляет только `/opt/ventry/`, локально упаковывает проверенный Caddy в Docker-образ, запускает отдельный Compose-проект и сообщает `VENTRY_DEPLOY_OK`.
5. Проверяет HTTPS с доверенным сертификатом, CSP/другие заголовки, побайтное соответствие SHA и файлов пакета, маршруты страниц, HTTP → HTTPS (308) и ответ 404. Деплой разрешён только для `main`; в PR выполняется только validate.

Первоначальная установка ограниченного серверного entrypoint описана в `deploy/ventry-github-status`. Обновление файла в репозитории само по себе **не обновляет** уже установленный скрипт на VDS. Существующий `.env`, Docker-тома и другие проекты деплой не изменяет. Развёртывание кратковременно перезапускает контейнер Ventry.

## Разработка и проверки

```sh
docker compose --project-name ventry config --quiet
node --check site/app.js
node tests/copy-link.cjs
python3 tools/verify-site.py
# Production checks run in the GitHub Actions workflow after deployment.
```

Сборка исправленного Caddy требует Go **1.27.4** и Docker:

```sh
bash tools/build-patched-caddy.sh
docker build -t ventry-caddy:patched-test -f deploy/Dockerfile .
VENTRY_CADDY_IMAGE=ventry-caddy:patched-test bash tests/security-http.sh
```

Уязвимость `CVE-2026-78661` (старый `golang.org/x/net`) устранена в развернутой Ventry-сборке: GitHub Actions [Deploy #45](https://github.com/lolokeksu09/Ventry/actions/runs/44256270618) и [Trivy #7](https://github.com/lolokeksu09/Ventry/actions/runs/44256270666) прошли успешно; сканер сообщил 0 HIGH/CRITICAL. Это самостоятельная сборка из официального исходного кода, а не новая официальная версия Caddy.

Не используйте `curl -k` для HTTPS-проверок — это скрывает ошибки сертификата. `site/index.html` можно открыть локально для проверки вёрстки; это не подтверждает TLS или работу на VDS. Проверки выбираем по риску (L1 — синтаксис/конфиг, L2/L3 — поведение HTTP/TLS, L5 — реальная публикация) в соответствии с приложенным пользователем Project Workflow Standard v1.0.

## Статус продукта

- Действующий сайт Ventry и адаптивная навигация.
- Первый проект «Расчёт» — карточка, краткий диалог и отдельная страница `/projects/raschet/` с FAQ и копированием ссылки. Приложение разрабатывается отдельно.
- Описание, переходы и FAQ работают без JavaScript; меню и копирование ссылки улучшают базовый HTML.
- `/version.json` генерируется при деплое, содержит только commit SHA и не хранится в исходниках.
- Собственный домен `ventrylab.top` используется как основной. Старый `sslip.io` остаётся техническим и не заменяет основной в SEO-метаданных.
