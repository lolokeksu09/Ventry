# Ventry — единое актуальное состояние
Снимок 28.11.2026. Для продолжения сверить `main`, рабочий PR, CI его SHA и фактически поставленную версию нужного компонента. Обновлять только изменившиеся факты. Этот документ ведёт общую очередь работ.

## Архитектура
| Компонент | Источник истины | Назначение |
|---|---|---|
| Сайт | site/, deploy/Caddyfile, compose.yaml | Корпоративный каталог, вымышленное демо |
| Delivery | delivery/service, migrations 001–007, deploy, public | Rust/Axum, PostgreSQL, Go gateway, выдача APK, Ed25519 лицензии, зашифрованные копии |
| Admin | admin-android | Приватный Kotlin/Compose клиент: карточки, оплаты, продления, активация |
| Расчёт | [dolg-book](https://github.com/lolokeksu09/dolg-book), android/, rust-core/ | Offline-first SQLite, Java/Kotlin/Compose, частичная MVVM, Rust JNI release |
| История | dolg-book/dist, server, deploy, Amvera | Прототипы; не действующая общая книга, не Delivery |

Публичное лицензирование: license.ventrylab.top → Caddy сайта → ventry-delivery-public → Go gateway → private TLS edge → loopback Rust API → PostgreSQL. Admin: отдельный private TLS/WireGuard, порт 18443. Private download 18444. Public download и admin закрыты Caddy. Delivery state /opt/ventry-delivery-state. Site deploy не обновляет Delivery.

## Подтверждённое состояние
| Компонент | Доказательство | Остаток |
|---|---|---|
| Ventry main | `3307b472c241ecbd75b9e0351b620d8eed0fb385`; #99 4/4, #100 5/5 PR workflows success | Postmerge [core](https://github.com/lolokeksu09/Ventry/actions/runs/46146951646) success, [service](https://github.com/lolokeksu09/Ventry/actions/runs/46146951631) и [Admin](https://github.com/lolokeksu09/Ventry/actions/runs/46146951636) success; Delivery rollout отдельно |
| Production сайта | `934ff550dca68931d25e40eb4b7d0e1a4be5867b` — [Production Actions](https://github.com/lolokeksu09/Ventry/actions/runs/46143023166) success: SSH, healthz, точное совпадение version.json, внешний HTTPS лицензирования | Свежая независимая проверка URL недоступна в текущей среде; образ и APK Delivery отдельно |
| Delivery VDS | Владелец подтвердил schema cloud_backup, DELIVERY_CLOUD_PRIVATE_READY, DELIVERY_PRIVATE_TLS_STAGING_OK, DELIVERY_PUBLIC_CLOUD_GATEWAY_READY; синтетические POST 404 activation_unavailable / backup_unavailable | Не новая SSH-проверка; реальная авторизация и запись не приняты |
| Расчёт main | `91bfbe76b8c519f336e0124087caa351d7aee733`; #37 и #38 по 6/6 PR workflows success; [main contract](https://github.com/lolokeksu09/dolg-book/actions/runs/46148808045) success | Физическая приёмка отдельно |
| Единый release «Расчёта» | `0.31.0-beta.3` / `38`, Android SHA `91bfbe76b8c519f336e0124087caa351d7aee733`, [signed CI](https://github.com/lolokeksu09/dolg-book/actions/runs/46148807987) success, [ZIP](https://github.com/lolokeksu09/dolg-book/actions/runs/46148807987/artifacts/15265081013), ZIP SHA-256 `71293a90491df8c0f91aa38ebdaff3b482cc7c97248e1754813b0ffd7841563b` | До 05.12.2026 16:19 МСК; независимая проверка содержимого и физическая приёмка не выполнены; active APK отдельно |
| Зарегистрированная выдача | delivery/service/release.json: code35 0.30.0-beta.1, sha 02ae25ba938e103574ce2b5234a292b5787fc22e382797e228f4f30abeb2d8dc | Старый нелицензируемый RC; фактический mount отдельно проверить; не продавать как licensed |
| Витрина релизов | #99 обновил проверенный снимок до публичного `0.30.0-beta.1-rc.1`; [visual QA](https://github.com/lolokeksu09/Ventry/actions/runs/46142738858) success и production deploy выше | Остальные E-06 UX/справка/доступность независимо |
| Admin | `0.8.0-alpha.1`, #95, [main CI](https://github.com/lolokeksu09/Ventry/actions/runs/46146951636) success; [staging ZIP](https://github.com/lolokeksu09/Ventry/actions/runs/46146951636/artifacts/15264147104) до 12.12.2026 15:58 МСК | Staging package dev.ventry.admin.staging, debug signer; сначала rollout API; физическая приёмка отдельно |

## Единый план
| ID | Приоритет | Следующее действие | Критерий |
|---|---|---|---|
| E-01 | P0 | Код переключения active APK/manifest с журналом и откатом слит #100; [изолированная проверка](https://github.com/lolokeksu09/Ventry/actions/runs/46143191717) success. Осталось испытание двух реальных подписанных APK и owner-run rollout | Изолированный тест смены, сбоя, возврата; старые grant не подменяют новую версию |
| E-02 | P0 | Принять единый подписанный APK с локальной книгой и облаком | Точный SHA и подпись, физическое обновление, активация, истечение, перенос, восстановление, JobScheduler после перезагрузки |
| E-03 | P0 | Обновление Delivery #95/#100 и Admin | Postmerge CI success; owner-run rollout, private TLS, внешний HTTPS, Admin совместимость остаются |
| E-04 | P0 | Сроки хранения и удаление, перенос после истечения, защищённая копия вне VDS, коммерческая приёмка | Решение владельца, ёмкость, [приёмка восстановления Delivery](DELIVERY-RECOVERY.md), правовая проверка фактических потоков и оплаты, отдельное включение выдачи |
| E-05 | P1 | Разделить MainActivity и состояние; точная причина превышения лимита автокопии реализована #37, физическая проверка в E-02 | Проверки lifecycle и SAF. На книге сверх облачного лимита предыдущая копия сохраняется, интерфейс сообщает причину и предлагает экспорт JSON |
| E-06 | P1 | Сайт: согласованность, доступность, актуальные релизы и справка, производительность | Проверенный снимок релизов, реальные действия в браузере, снимки, Lighthouse точной ревизии |
| E-07 | P2 | Общая книга/сотрудники | Отдельный утверждённый контракт: tenant isolation, роли, журнал, idempotency, offline conflicts |

E-01/E-02 независимы до поставки; E-03 после CI; E-04 блокирует коммерческую выдачу. E-05/E-06 независимы. E-07 не означает подключение старого server pilot к реальным данным.

## Контракт продукта
Модель разработки: trial 7 дней, 299 ₽/месяц, 799 ₽/3 месяца, 2490 ₽/год; источник реализации delivery.plan. Не оферта. Истечение блокирует новые долги, не чтение/оплату/экспорт. Cloud: три слота до 16 МиБ каждый, 1/2 ручные, 3 opt-in автоматический. Пароль восстановления вне сервера; при утрате сервер не расшифрует книгу. Новая запись требует активного доступа; чтение прежней — при сохранённой привязке. Cloud backup не синхронизация. Не обещать бессрочное хранение.

## Навигация
[Аудит](ECOSYSTEM-AUDIT-2026-11-28.md) · [Эксплуатация](DELIVERY-OPERATIONS.md) · [Восстановление Delivery](DELIVERY-RECOVERY.md) · [Готовность к выдаче](RASCHET-DISTRIBUTION-READINESS.md) · [Облачные копии](VENTRY-CLOUD-BACKUPS.md) · [Admin](VENTRY-ADMIN-ANDROID.md) · [Расчёт: локальный статус](https://github.com/lolokeksu09/dolg-book/blob/main/docs/CONTINUATION.md).

[Планы, исследование дизайна и отчёты 2.0–4.0 в истории Git](https://github.com/lolokeksu09/Ventry/tree/a6878a804f3773aa226ae725691df0b6d0789589/docs).
