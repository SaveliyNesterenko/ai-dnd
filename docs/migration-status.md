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

## Временный compatibility слой

Legacy Python и vanilla frontend пока оставлены в корне и `frontend/` только
для characterization и ручного сравнения поведения. Новый launcher их не
загружает и runtime JSON не изменяет.

## Следующий cutover

Перед удалением legacy-кода необходимо вручную подтвердить функциональный
паритет для музыки, STT/TTS, управления локациями и полного сценария
Архивариуса. После подтверждения можно удалить старые endpoints, Redis-код,
`requirements.txt`, старый launcher и vanilla UI отдельным reviewable commit.

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
