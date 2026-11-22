# Workflow Ventry — Project Workflow Standard v1.0

Это **адаптация** приложенного владельцем `Project-Workflow-Standard-v1.0.zip` для существующего репозитория Ventry. Оригинальные PROJECT.md/README.md не заменены образцами. Применимые правила находятся в корневом [AGENTS.md](../../AGENTS.md), уровни в [TESTING-LEVELS.md](../../TESTING-LEVELS.md), карточка проекта — [PROJECT.md](../../PROJECT.md).

## Использование

- **Light:** локальная правка — запись в PR или задаче + проверки по риску; отдельный план не обязателен.
- **Full:** связанная, длительная или рискованная работа — [PLAN.md](PLAN.md) с единым реестром REQ-ID, при необходимости [CONTINUATION.md](CONTINUATION.md) и [VERIFICATION.md](VERIFICATION.md).
- **Аудит:** применяй существующий [docs/AUDIT.md](../AUDIT.md); [AUDIT.md](AUDIT.md) здесь — только шаблон.
- **Выпуск:** [RELEASE.md](RELEASE.md) помогает документировать кандидата, разрешение, восстановление и L5; он не разрешает merge/деплой.

Шаблоны намеренно незаполнены и **не являются активными заданиями**. Источники выполнения тестов и деплоя — существующие `.github/workflows/`, `tests/`, `tools/`, `deploy/` и корневой README. Не создавай вторую истину для текущей задачи.

## Отображение стандартного комплекта

| В комплекте v1.0 | В Ventry |
| --- | --- |
| `AGENTS.md` | [корневой AGENTS.md](../../AGENTS.md) (адаптирован) |
| `PROJECT.md` | [корневой PROJECT.md](../../PROJECT.md) (сохранён и дополнен) |
| `TESTING-LEVELS.md` | [корневой TESTING-LEVELS.md](../../TESTING-LEVELS.md) (адаптирован) |
| `templates/*` | Шаблоны в этой папке |
| `README.md` | Этот указатель + [README Ventry](../../README.md) |
| `CHANGELOG.md`, `VALIDATION.md`, учебные примеры и исходный `check_standard.py` | Это материалы **самого универсального комплекта**, не активные документы Ventry; проверяются у оригинального источника |

## Инварианты

Документационная адаптация не меняет содержимое `site/`, `compose.yaml`, Docker/Caddy, секреты и серверную конфигурацию; merge в `main` вызовет production-деплой, поэтому выполняется отдельно при разрешении.
