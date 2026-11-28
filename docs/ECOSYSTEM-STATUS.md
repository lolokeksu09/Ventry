# Ventry — единое актуальное состояние
Снимок 28.11.2026, не live-мониторинг. При продолжении сверить main, рабочие PR, CI exact head и поставленную версию. Обновлять только изменившиеся факты. Исторические планы не являются новой очередью работ.

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
| Ventry main | fcdd22c40f196ce86d6bc758367b0d7a972fc930; #95 5/5 CI | Postmerge 3/3 success: [core](https://github.com/lolokeksu09/Ventry/actions/runs/46125066653), [service](https://github.com/lolokeksu09/Ventry/actions/runs/46125066739), [Admin](https://github.com/lolokeksu09/Ventry/actions/runs/46125066743); обновление Delivery VDS отдельно |
| Production сайта | f170413777dedc80284d7711b1dd7fd9cba90b45, [46111671534 attempt 2](https://github.com/lolokeksu09/Ventry/actions/runs/46111671534), VENTRY_DEPLOY_OK, LICENSE_PUBLIC_HTTPS_OK | Не доказывает обновление Delivery |
| Delivery VDS | Владелец подтвердил schema cloud_backup, DELIVERY_CLOUD_PRIVATE_READY, DELIVERY_PRIVATE_TLS_STAGING_OK, DELIVERY_PUBLIC_CLOUD_GATEWAY_READY; синтетические POST 404 activation_unavailable / backup_unavailable | Не новая SSH-проверка; реальная авторизация и запись не приняты |
| Расчёт main | dcbf02c0d91e5bce730e74b6bb0ac58fa419be09, #31 7/7 CI; [main contract](https://github.com/lolokeksu09/dolg-book/actions/runs/46123275955) success | Автокопирование ещё не проверено в signed candidate |
| Signed candidate | [46111775220](https://github.com/lolokeksu09/dolg-book/actions/runs/46111775220), artifact 15249614919; revision 31ec0b320d0dfd52b19780837a71503f58507324; code36 0.31.0-beta.1 | До автоматики; ZIP digest eff558795d131b80dd3e1c17a73343febad158581899d7912a30373a46329f3c, не APK hash |
| Зарегистрированная выдача | delivery/service/release.json: code35 0.30.0-beta.1, sha 02ae25ba938e103574ce2b5234a292b5787fc22e382797e228f4f30abeb2d8dc | Старый нелицензируемый RC; фактический mount отдельно проверить; не продавать как licensed |
| Admin | #85 0.8, #95 подтверждение конкретного SHA при выдаче | Новый API сначала, новый Admin потом; физическая приёмка отдельно |

## Единый план
| ID | Приоритет | Следующее действие | Критерий |
|---|---|---|---|
| E-01 | P0 | Переключение active APK/manifest с откатом; #92/#94 закрывают только intake и привязку выдачи | Изолированный тест смены, сбоя, возврата; старые grant не подменяют новую версию |
| E-02 | P0 | Signed кандидат после #31, различимая версия | Exact main dispatch, signer/hash, физический upgrade, activation/expiry, transfer, restore, JobScheduler/reboot |
| E-03 | P0 | Обновление Delivery #95 и Admin | Postmerge CI, owner-run rollout, private TLS, внешний HTTPS, Admin совместимость |
| E-04 | P0 | Retention/delete, recovery after expiry на новом телефоне, резерв вне одного VDS, коммерческая приёмка | Решение владельца, capacity, изолированный restore, правовая проверка фактических потоков/оплаты; отдельное включение download |
| E-05 | P1 | Разделить MainActivity, state/navigation, устойчивость cloud job | Проверки сценариев, lifecycle, slow network, сохранность данных |
| E-06 | P1 | Сайт: согласованность, доступность, актуальность справки, performance | Реальные browser actions, снимки, Lighthouse точной ревизии |
| E-07 | P2 | Общая книга/сотрудники | Отдельный утверждённый контракт: tenant isolation, роли, журнал, idempotency, offline conflicts |

E-01/E-02 независимы до поставки; E-03 после CI; E-04 блокирует коммерческую выдачу. E-05/E-06 независимы. E-07 не означает подключение старого server pilot к реальным данным.

## Контракт продукта
Модель разработки: trial 7 дней, 299 ₽/месяц, 799 ₽/3 месяца, 2490 ₽/год; источник реализации delivery.plan. Не оферта. Истечение блокирует новые долги, не чтение/оплату/экспорт. Cloud: три слота до 16 МиБ каждый, 1/2 ручные, 3 opt-in автоматический. Пароль восстановления вне сервера; при утрате сервер не расшифрует книгу. Новая запись требует активного доступа; чтение прежней — при сохранённой привязке. Cloud backup не синхронизация. Не обещать бессрочное хранение.

## Навигация
[Аудит](ECOSYSTEM-AUDIT-2026-11-28.md) · [Эксплуатация](DELIVERY-OPERATIONS.md) · [Готовность к выдаче](RASCHET-DISTRIBUTION-READINESS.md) · [Cloud](VENTRY-CLOUD-BACKUPS.md) · [Admin](VENTRY-ADMIN-0.8.md) · [Расчёт: локальный статус](https://github.com/lolokeksu09/dolg-book/blob/main/docs/CONTINUATION.md). Планы 2.0–4.0 и предыдущие отчёты — история.
