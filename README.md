# AI-DND Engine

Проект — локальный движок для текстовой ролевой игры (D&D-стиля), где реплики и решения персонажей генерируются LLM, а состояние игры синхронизируется между двумя интерфейсами: GM-консолью и зрительским экраном. Сервер на FastAPI раздает статические фронтенды, ведет состояние игры в JSON-файлах, раздает обновления через SSE и опционально озвучивает реплики через Coqui XTTS v2.

**Ключевые возможности**
- Два интерфейса: `GM Console` и `Spectator View` (статические страницы).
- Единые SSE-потоки для обновлений и событий.
- Генерация реплик персонажей через LLM с промптами на основе текущего состояния.
- Архивирование событий, сжатие контекста, генерация заметок игроков.
- Опциональная локальная TTS-озвучка (XTTS v2) и воспроизведение фоновой музыки.

**Архитектура**
- `orchestrator.py` — основной FastAPI сервер, SSE, игровые API, статика.
- `archivist.py` — архивирование логов, сжатие истории, заметки игроков.
- `prompt_builder.py` — сборка промптов для персонажей, наблюдателя, архивариуса.
- `response_handler.py` — парсинг ответа LLM в формат журнала событий.
- `tts_service.py` — локальная озвучка Coqui XTTS v2 (опционально).
- `frontend/gm-console` — GM-консоль (управление сценой, персонажами, музыкой).
- `frontend/spectator` — зрительский экран (сцена, реплики, музыка, дайс-роллы).

**Быстрый старт**
1. Установить зависимости и поднять Redis.
2. Настроить `.env` с API ключом.
3. Запустить `run_dev.py`.

```bash
python run_dev.py
```

После запуска откройте:
- `http://127.0.0.1:8000/gm/console-gm.html`
- `http://127.0.0.1:8000/spectator`

**Зависимости**
- Python 3.9+.
- Redis (локально, `redis://127.0.0.1:6379`).
- Зависимости из `requirements.txt`.

**Конфигурация**
- `OPENAI_API_KEY` — ключ LLM-провайдера.
- `OPENAI_BASE_URL` — базовый URL API (по умолчанию `https://routerai.ru/api/v1`).

**Данные и структура JSON**
- `data/characters.json` — персонажи игроков.
- `data/npc.json` — NPC/противники.
- `data/active_characters.json` — активные персонажи сцены.
- `data/locations.json` — карта локаций и пути к изображениям.
- `data/public_state.json` — публичное состояние сцены (локация, музыка, масштаб аватаров).
- `data/event_log.json` — журнал действий.

Минимальный формат персонажа (игрок или NPC) в `characters.json` и `npc.json`:
```json
{
  "some_id": {
    "meta": {
      "model_id": "google/gemini-2.5-flash-lite",
      "role": "Player",
      "sprite_id": "some_portrait.png",
      "voice_sample": "assets/voices/some_voice.wav"
    },
    "identity": { "name": "Имя", "bio": "Биография" },
    "stats": {
      "hp": { "current": 10, "max": 10 },
      "mp": { "current": 5, "max": 5 },
      "attributes": { "STR": 10, "DEX": 10, "END": 10, "INT": 10, "WIS": 10 },
      "status_effects": []
    },
    "inventory": [],
    "memory": { "global_chronicle": [""], "private_notes": [""] }
  }
}
```

**API (основные эндпоинты)**
- `GET /api/spectator_stream` — SSE-поток для зрительского экрана.
- `GET /api/gm_stream` — SSE-поток для GM-консоли.
- `POST /act` — сгенерировать ход персонажа через LLM.
- `POST /api/add_gm_action` — добавить действие GM в лог.
- `POST /api/observer_analysis` — анализ действий и JSON patch для статов/инвентаря.
- `POST /api/apply_json_patch` — применить патч к персонажам.
- `POST /api/characters/activate` — активировать персонажа в сцене.
- `POST /api/characters/deactivate` — деактивировать персонажа в сцене.
- `POST /api/update_active_characters` — массовое обновление активных.
- `GET /api/characters` — список игроков.
- `GET /api/npcs` — список NPC.
- `GET /api/all_characters` — все персонажи.
- `GET /api/locations` — список локаций.
- `GET /api/event_log` — журнал событий.
- `GET /api/game_state` — текущее публичное состояние.
- `POST /api/set_location` — смена локации.
- `POST /api/settings/avatar-size` — изменение масштаба аватаров.
- `POST /api/broadcast_dice_roll` — отправить бросок d20 в SSE.
- `GET /api/music` — список треков.
- `POST /api/music/play` — проиграть трек.
- `POST /api/music/stop` — остановить музыку.
- `POST /api/music/volume` — установить громкость.
- `POST /api/archive_event` — архивировать текущий лог в `logs/`.
- `POST /api/compress_context` — сжать историю (оставляет последние 10 ходов).
- `POST /api/generate_player_notes` — сгенерировать заметки игроков.

**TTS и аудио**
- XTTS v2 используется из `TTS` (Coqui). Рекомендуется GPU с CUDA, но CPU тоже поддерживается.
- Сэмплы голоса: `assets/voices/*.wav`, путь хранится в `meta.voice_sample`.
- Генерируемые реплики: `assets/audio/generated/`.
- Фоновая музыка: `assets/audio/music/` (поддерживаются `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`).
- Если TTS недоступен или у персонажа нет `voice_sample`, система отправляет текст без аудио.

**Структура проекта**
- `archivist.py`, `orchestrator.py`, `prompt_builder.py`, `response_handler.py`, `tts_service.py`
- `frontend/gm-console/` — GM-консоль.
- `frontend/spectator/` — зрительский экран.
- `data/` — состояние игры в JSON.
- `assets/` — изображения, аудио, голоса.
- `logs/` — логи промптов и архивы событий.

**Замечания**
- `run_dev.py` создаст `venv`, установит зависимости и запустит Uvicorn с `--reload`.
- Redis обязателен для очереди озвучки и broadcast-событий.
