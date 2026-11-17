# Ventry

Ventry — сайт цифровых проектов. Первый представленный проект — «Расчёт» (в разработке).

## Структура

- `site/` — статический адаптивный сайт (HTML, CSS, JavaScript, SVG).
- `deploy/Caddyfile` — веб-сервер Caddy, заголовки безопасности и `/healthz`.
- `compose.yaml` — изолированный проект Docker Compose `ventry`.
- `.github/workflows/deploy.yml` — проверка и автоматическая публикация при изменениях в `main`.
- `.github/workflows/vds-status.yml` — ручная проверка SSH-доступа к VDS.

## Сервер

Selectel VDS: `135.106.227.179`. Путь размещения: `/opt/ventry/`.

Для первого запуска используется `VENTRY_SITE_ADDRESS=:80` — HTTP по IP. Сайт доступен на `http://135.106.227.179/` при открытом TCP-порту 80.

Для домена после настройки DNS A → `135.106.227.179` создайте файл `/opt/ventry/.env`:

```dotenv
VENTRY_SITE_ADDRESS=example.com
```

Замените `example.com` реальным доменом. Caddy получит HTTPS-сертификат автоматически, если доступны TCP 80/443 (и при необходимости UDP 443). Для изменения адреса после деплоя:

```sh
cd /opt/ventry && docker compose --project-name ventry up -d
```

**Важно:** адрес домена пока не согласован. В GitHub Actions проверка доступности нацелена на HTTP/IP; при переключении на домен скорректируйте smoke-check на реальный домен и HTTPS.

## GitHub Actions

Для SSH нужны секреты `VENTRY_SSH_KEY` (полный приватный ключ OpenSSH) и `VENTRY_KNOWN_HOSTS` (проверенная строка `known_hosts`). Приватный ключ никогда не добавляется в файлы репозитория.

`Deploy Ventry` выполняет:

1. Проверку JavaScript, Docker Compose и Caddyfile.
2. Синхронизацию **только** каталогов `site/` и `deploy/`, а также файла `compose.yaml` на VDS.
3. `docker compose up -d --pull always --remove-orphans` в отдельном проекте `ventry`.
4. HTTP smoke-check `/healthz` и главной страницы.

Каталоги `/opt/ventry/site/` и `/opt/ventry/deploy/` управляются деплоем: удалённые лишние файлы внутри них будут удалены `rsync --delete`. Файл `/opt/ventry/.env`, данные Docker-томов и проекты вне `/opt/ventry/` не затрагиваются.

**Порты:** веб-сервер привязывается к TCP 80/443 и UDP 443. Если они заняты другим приложением, запуск завершится ошибкой — перед развёртыванием требуется освободить порты или согласовать reverse proxy.

## Локальная разработка

```sh
docker compose --project-name ventry up -d
curl -f http://localhost/healthz
```

Без Docker можно открыть `site/index.html` в браузере; JavaScript используется только для мобильного меню и окна с описанием проекта.

## Статус

- Сайт компании и адаптивная навигация.
- Первый проект «Расчёт» — информационная карточка с работающим диалогом.
- Само приложение «Расчёт» будет развиваться отдельно. Адрес запуска и домен Ventry не указаны, пока не подтверждены.
