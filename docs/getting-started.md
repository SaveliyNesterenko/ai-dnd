# Запуск и настройка AI-DND

## Требования

- Python 3.11 или 3.12;
- [uv](https://docs.astral.sh/uv/);
- Node.js 22+.

## Установка

### macOS и Linux

```bash
uv sync --locked
cd web
npm ci
npm run build
cd ..
uv run --no-sync ai-dnd serve --open
```

### Windows PowerShell

```powershell
uv sync --locked
Set-Location web
npm.cmd ci
npm.cmd run build
Set-Location ..
uv run --no-sync ai-dnd serve --open
```

После запуска CLI выводит:

- одноразовую bootstrap-ссылку ГМ;
- шестизначный spectator-код;
- локальный адрес приложения.

`--no-sync` сохраняет установленный набор extras. Без него `uv run` может
пересобрать окружение по базовому набору зависимостей и удалить voice-extra.

## Конфигурация LLM и STT

Настройки читаются из `.env` в корне проекта или из переменных окружения.
Шаблон находится в `.env.example`. Все имена имеют префикс `AI_DND_`.

| Переменная | Назначение | Значение без неё |
| --- | --- | --- |
| `AI_DND_OPENAI_API_KEY` | ходы моделей, Наблюдатель и Архивариус | генерация работает в degraded-режиме |
| `AI_DND_OPENAI_BASE_URL` | endpoint LLM-провайдера | `https://routerai.ru/api/v1` |
| `AI_DND_STT_API_KEY` | распознавание речи ГМ | расшифровка недоступна |
| `AI_DND_STT_BASE_URL` | endpoint STT-провайдера | `https://api.nexara.ru/api/v1` |

`.env` читается при старте, поэтому после изменения настроек сервер нужно
перезапустить. Текущие возможности доступны через `GET /api/v1/capabilities`;
ключи этот endpoint не возвращает.

## Локальная озвучка

Установите voice-extra:

```bash
uv sync --locked --extra voice
uv run --no-sync ai-dnd serve --open
```

При первом синтезе XTTS v2 лениво загрузит модель. Если движок или голосовой
образец недоступен, spectator автоматически продолжит работу в текстовом режиме.

## LAN-режим

Доступ из локальной сети выключен по умолчанию. Для доверенной LAN:

```bash
uv run --no-sync ai-dnd serve --lan --open
```

Публичное интернет-развёртывание не входит в модель угроз текущей версии.

## Импорт пробной кампании

Скачайте ZIP из [релиза v0.1.0](https://github.com/SaveliyNesterenko/AI-dnd_v2/releases/tag/v0.1.0),
откройте меню «Кампания» в GM Console и выберите «Импортировать ZIP».
Распаковывать архив не нужно.

## Импорт legacy-кампании

Сначала выполните безопасную проверку без изменения данных:

```bash
uv run ai-dnd import-legacy ./data
```

Для подтверждённого импорта:

```bash
uv run ai-dnd import-legacy ./data --apply --name "Моя кампания"
```

Спрайты, голоса, локации и музыка копируются в локальное системное хранилище,
а не в Git checkout. JSON используется только для импорта и экспорта.

## Разработка

### Backend

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest --cov=ai_dnd
uv run python scripts/check_migrations.py
```

### Frontend

```bash
cd web
npm run lint
npm test
npm run build
npm run test:e2e
```

В Windows PowerShell используйте `npm.cmd` вместо `npm`.

### OpenAPI-клиент

```bash
uv run python scripts/export_openapi.py
cd web
npm run generate:api
```
