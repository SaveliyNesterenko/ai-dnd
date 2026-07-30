# Статус миграции

## Готово

- Новый package layout, uv lock, строгие линтеры и типизация.
- Закрытая pre-modernization backup текущих JSON, assets и product concept
  создана вне checkout в системной директории AI-DND.
- SQLite-модель, Alembic migration, demo seed и legacy dry-run/import/export.
- Event state machine, campaign revision и типизированные Observer operations.
- `/api/v1`, problem details, GM/spectator access и role-specific projections.
- Durable WebSocket broadcast/replay.
- Bounded background jobs и OpenAI-compatible structured output adapter.
- React GM Console и Spectator с reconnect/error/degraded states.
- Production build, native CLI launcher, тесты и CI-конфигурация.

## Завершённый cutover

Legacy Python, Redis-контур, старый launcher, отдельный `requirements.txt` и
vanilla frontend исключены из публичного репозитория. Локальная копия сохранена
в игнорируемом архиве для справки и не участвует в сборке, тестах или runtime.

Поддерживаемый legacy-import остаётся частью новой архитектуры: он переносит
пользовательские JSON и assets в SQLite и системное хранилище приложения, но не
запускает старый код.

Очистка Git history выполнена после отдельного подтверждения владельца; закрытый
mirror backup сохранён вне checkout.

## Текущий перенос функциональности

Реализованы нормализованное состояние сцены, верхнее управление локацией и
музыкой, единый выбор персонажей для GM-карточек, spectator и игрового события,
три категории персонажей, публичные мысли, опциональный серверный d20 и
редактируемый AI-черновик до публикации. Старый редактор перемещения аватаров
удалён до проектирования новой механики. Персональные хроники 40 персонажей
перенесены без сведения к одной кампанийной версии. Актуальная матрица:
[functional-parity.md](functional-parity.md).
