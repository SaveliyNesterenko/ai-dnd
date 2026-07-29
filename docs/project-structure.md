# Структура проекта AI-DND

Статус: актуально на 29 июля 2026 года, проверено по состоянию репозитория
`c889ffc`.

Этот документ описывает фактическую структуру checkout. Архитектурные решения и
границы ответственности подробнее разобраны в [architecture.md](architecture.md),
а состояние переноса функций из прототипа — в
[migration-status.md](migration-status.md).

## Карта репозитория

```text
ai-dnd_V2/
├── src/ai_dnd/                  # Основной Python backend
│   ├── api/                     # HTTP/WebSocket transport, DTO и middleware
│   │   └── routes/              # /api/v1: auth, campaigns, jobs, assets, voice...
│   ├── application/             # Игровые сценарии, jobs, realtime и legacy import
│   ├── domain/                  # Статусы, ошибки и правила переходов
│   ├── infrastructure/          # SQLAlchemy, SQLite и локальная безопасность
│   ├── integrations/            # LLM- и voice-провайдеры
│   ├── core/                    # Настройки и логирование
│   ├── alembic/                 # Миграции схемы SQLite
│   ├── cli.py                   # Команды ai-dnd
│   ├── main.py                  # FastAPI application factory
│   └── migrations.py            # Запуск встроенных Alembic migrations
│
├── web/                         # Основной React 19 + TypeScript frontend
│   ├── src/
│   │   ├── api/                 # API client, типы и сгенерированный OpenAPI client
│   │   ├── components/          # Общие и GM-компоненты
│   │   ├── hooks/               # Realtime и другие React hooks
│   │   ├── pages/               # GM Console и Spectator
│   │   ├── store/               # Локальное UI-состояние Zustand
│   │   ├── App.tsx              # Выбор /gm или /spectator
│   │   └── main.tsx             # Точка входа Vite
│   ├── e2e/                     # Playwright smoke tests
│   ├── package.json             # npm-команды и frontend-зависимости
│   └── vite.config.ts           # Сборка и dev server
│
├── tests/
│   ├── unit/                    # Изолированные backend-тесты
│   ├── integration/             # API, БД, jobs и legacy import
│   └── conftest.py              # Общие pytest fixtures
│
├── docs/
│   ├── adr/                     # Architecture Decision Records
│   ├── architecture.md          # Архитектура и runtime-инварианты
│   ├── project-structure.md     # Этот документ
│   ├── product-vision.md        # Цели продукта
│   ├── migration-status.md      # Статус перехода с прототипа
│   ├── functional-parity.md     # Матрица переноса возможностей
│   └── openapi.json             # Версионируемый API-контракт
│
├── demo/                        # Публичные лицензированные demo-данные
├── scripts/                     # Проверка миграций и экспорт OpenAPI
├── .github/                     # CI, Dependabot и GitHub-шаблоны
│
├── frontend/                    # Legacy vanilla JS UI, не основной frontend
├── utils/                       # Legacy Python utilities
├── archivist.py                 # Legacy Python
├── orchestrator.py              # Legacy Python
├── prompt_builder.py            # Legacy Python
├── response_handler.py          # Legacy Python
├── run_dev.py                   # Legacy launcher
├── tts_service.py               # Legacy voice service
├── requirements.txt             # Legacy dependencies
│
├── pyproject.toml               # Python package, зависимости и инструменты
├── uv.lock                      # Зафиксированные Python-зависимости
├── alembic.ini                  # Конфигурация Alembic
├── .env.example                 # Шаблон локальной конфигурации
└── README.md                    # Запуск и обзор проекта
```

Дерево намеренно не перечисляет каждый компонент, route и migration. Оно
показывает стабильные точки навигации; полный список файлов даёт `git ls-files`.

## Основной runtime-контур

1. Команда `ai-dnd` объявлена в `pyproject.toml` и вызывает
   `ai_dnd.cli:main`.
2. `ai-dnd serve` применяет миграции и запускает FastAPI-приложение из
   `src/ai_dnd/main.py`.
3. Backend предоставляет `/api/v1` и WebSocket, а также раздаёт собранный
   `web/dist`.
4. `web/src/App.tsx` загружает отдельные страницы GM Console и Spectator.
5. Постоянное состояние хранится в SQLite в системной директории данных
   пользователя, а не внутри checkout.

`data/` и `assets/`, если они присутствуют локально, относятся к старой кампании
и исключены из Git. Версионируемые demo-материалы размещаются только в `demo/`.

## Современный и legacy-код

Новый функционал следует добавлять в `src/ai_dnd/` и `web/`. Каталог
`frontend/`, корневые Python-модули, `utils/` и `requirements.txt` сохранены
временно для сверки поведения и импорта старых данных. Новый launcher их не
загружает.

Удалять legacy-контур следует отдельным изменением после подтверждения
функционального паритета по [functional-parity.md](functional-parity.md).

## Фактические границы модулей

Названия каталогов выражают целевое разделение ответственности, но зависимости
пока не полностью изолированы: часть `application` использует SQLAlchemy-модели
из `infrastructure` и DTO из `api`, а некоторые routes обращаются к моделям
хранения напрямую. Поэтому схема в `architecture.md` является целевой
архитектурой, а не строгим описанием текущего import graph.

## Что не хранится в Git

- `.env` и секреты;
- виртуальные окружения и tool caches;
- SQLite runtime-базы и локальные backups;
- пользовательские `data/` и `assets/`;
- `web/node_modules/`, `web/dist/` и результаты Playwright;
- логи и сгенерированное во время игры аудио.

## Когда обновлять этот документ

Обновление обязательно при:

- добавлении или переименовании верхнеуровневого каталога;
- изменении CLI, application factory или расположения frontend entry point;
- смене источника истины или места хранения runtime-данных;
- переносе кода между современным и legacy-контурами;
- изменении процесса генерации OpenAPI или миграций БД.

При расхождении документа с кодом приоритет имеют `pyproject.toml`,
`web/package.json`, `.gitignore` и фактические точки входа.
