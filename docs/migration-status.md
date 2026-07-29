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

Очистка Git history не выполнена намеренно: она требует отдельного согласия
владельца и закрытого mirror backup.
