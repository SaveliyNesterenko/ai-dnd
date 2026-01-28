"""
Orchestrator.py
Основной серверный скрипт (Backend), версия с единым SSE-потоком.
Отвечает за логику игры, обслуживание фронтенда и API.
"""

import os
import json
import time
import asyncio
import redis.asyncio as redis
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from openai import OpenAI

# Внутренние импорты
from response_handler import handle_response
from utils.file_utils import load_json, save_json
from utils.logger import save_prompt_to_log
from utils.parser import parse_ai_response
from prompt_builder import build_prompt, build_observer_prompt
from archivist import router as archivist_router
from tts_service import TTSService

# --- Настройка Redis и жизненного цикла приложения ---
load_dotenv()

REDIS_URL = "redis://127.0.0.1:6379"
SPEECH_LIST_KEY = "speech_list"
CHARACTER_UPDATE_QUEUE = "character_update_queue"
DICE_ROLL_QUEUE = "dice_roll_queue"

app_state = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("--- Application startup: Connecting to Redis...")
    redis_pool = redis.ConnectionPool.from_url(
        REDIS_URL, decode_responses=True)
    app_state["redis_pool"] = redis_pool
    print("--- Redis connection pool created successfully.")

    print("--- Application startup: Initializing TTS Service...")
    try:
        tts_service = TTSService()
        app_state["tts_service"] = tts_service
    except Exception as e:
        app_state["tts_service"] = None
        print(f"--- CRITICAL: Failed to initialize TTSService: {e}")

    yield

    print("--- Application shutdown: Closing Redis connection pool...")
    pool = app_state.get("redis_pool")
    if pool:
        await pool.disconnect()
    print("--- Redis connection pool closed.")

app = FastAPI(lifespan=lifespan)

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(archivist_router, prefix="/api")
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/gm", StaticFiles(directory="frontend/gm-console"), name="gm-console")
app.mount("/sp", StaticFiles(directory="frontend/spectator"), name="spectator")

CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOCATIONS_FILE = "./data/locations.json"
ACTIVE_CHARACTERS_FILE = "./data/active_characters.json"
PUBLIC_STATE_FILE = "./data/public_state.json"

# --- Модели Pydantic для валидации запросов ---


class SpeechRequest(BaseModel):
    thought_text: Optional[str] = None
    action_text: Optional[str] = None


class ActionRequest(BaseModel):
    character_key: str


class GmActionRequest(BaseModel):
    text: str


class CharacterActionRequest(BaseModel):
    character_id: str


class UpdateCharactersRequest(BaseModel):
    characters_id: List[str]


class ObserverRequest(BaseModel):
    action: str
    character_id: str
    dice_roll: Optional[int] = None


class JsonPatchRequest(BaseModel):
    patch: Dict[str, Any]


class SetLocationRequest(BaseModel):
    location_id: str


class DiceRollRequest(BaseModel):
    roll: int


class AvatarSizeRequest(BaseModel):
    avatar_size: int


def sse_format(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

# --- Потоки данных (Server-Sent Events) ---


async def spectator_stream_generator(request: Request):
    redis_conn = redis.Redis(connection_pool=app_state["redis_pool"])
    last_game_state, last_active_chars, last_character_states = None, None, {}

    while True:
        try:
            if await request.is_disconnected():
                break

            message_tuple = await redis_conn.blpop([SPEECH_LIST_KEY, DICE_ROLL_QUEUE], timeout=1)
            if message_tuple:
                queue_name, message_data = tuple(message_tuple)
                data = json.loads(message_data)

                event_type = None
                if queue_name == SPEECH_LIST_KEY:
                    event_type = data.pop("event_type", "generic_event")
                elif queue_name == DICE_ROLL_QUEUE:
                    event_type = "dice_roll"

                if event_type:
                    yield sse_format(event_type, data)
                continue

            current_game_state = load_json(PUBLIC_STATE_FILE) or {}
            if current_game_state != last_game_state:
                last_game_state = current_game_state
                yield sse_format("game_state_update", current_game_state)

            current_active_chars_doc = load_json(ACTIVE_CHARACTERS_FILE) or {}
            current_active_char_ids = current_active_chars_doc.get(
                "characters_id", [])
            if current_active_chars_doc != last_active_chars:
                last_active_chars = current_active_chars_doc
                yield sse_format("active_characters_update", current_active_char_ids)

            all_chars = {**(load_json(CHARACTERS_FILE) or {}),
                         **(load_json(NPC_FILE) or {})}
            for char_id in current_active_char_ids:
                if char_id in all_chars:
                    current_char_data = all_chars[char_id]
                    if char_id not in last_character_states or last_character_states[char_id] != current_char_data:
                        last_character_states[char_id] = current_char_data
                        yield sse_format("character_full_update", {"id": char_id, "data": current_char_data})

            removed_ids = set(last_character_states.keys()) - \
                set(current_active_char_ids)
            for char_id in removed_ids:
                del last_character_states[char_id]

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Error in spectator stream: {e}")
            await asyncio.sleep(1)


async def gm_stream_generator(request: Request):
    last_event_log, last_all_characters = {}, {}
    try:
        while True:
            if await request.is_disconnected():
                break
            current_event_log = load_json(EVENT_LOG_FILE) or {}
            if current_event_log != last_event_log:
                last_event_log = current_event_log
                yield sse_format("event_log_update", current_event_log)
            all_chars = {**(load_json(CHARACTERS_FILE) or {}),
                         **(load_json(NPC_FILE) or {})}
            if all_chars != last_all_characters:
                if not last_all_characters:
                    last_all_characters = all_chars
                for char_id, char_data in all_chars.items():
                    if char_id not in last_all_characters or last_all_characters[char_id] != char_data:
                        yield sse_format("character_update", {"id": char_id, "data": char_data})
                last_all_characters = all_chars
            await asyncio.sleep(1)
    finally:
        pass

# --- НОВЫЙ ОТКАЗОУСТОЙЧИВЫЙ ОРКЕСТРАТОР РЕПЛИК ---


async def dispatch_speech_events(
    redis_pool, tts_service, char_key: str,
    thought_text: Optional[str], action_text: Optional[str],
    voice_sample_path: str, step: int
):
    """Последовательно обрабатывает реплики и отправляет единые события на фронтенд."""
    loop = asyncio.get_running_loop()
    redis_conn = redis.Redis(connection_pool=redis_pool)

    async def process_and_dispatch(text_type: str, text: str):
        if not text:
            return

        print(
            f"--- Preparing '{text_type.upper()}' speech event for step {step}...")

        # 1. Пытаемся синтезировать аудио в фоновом потоке
        audio_path = await loop.run_in_executor(
            None, tts_service.synthesize, text,
            voice_sample_path, f"{char_key}_{int(time.time())}_{text_type}.wav"
        )

        # 2. Готовим URL для события (будет None, если синтез не удался)
        final_audio_url = audio_path.replace("\\", "/") if audio_path else None

        if final_audio_url:
            print(
                f"--- SUCCESS: {text_type.upper()} audio generated (step {step}).")
            # Обновляем лог игры, добавляя ссылку на аудиофайл
            try:
                event_data = load_json(EVENT_LOG_FILE)
                target_event = next((e for e in event_data.get(
                    'history', []) if e.get('step') == step), None)
                if target_event:
                    # Ключ в event_log.json - 'thoughts' для мыслей
                    log_key_type = 'thoughts' if text_type == 'thought' else 'action'
                    target_event[f'audio_{log_key_type}_url'] = final_audio_url
                    save_json(EVENT_LOG_FILE, event_data)
            except Exception as e:
                print(
                    f"--- WARNING: Failed to save audio URL to event log: {e}")
        else:
            print(
                f"--- FAILURE: {text_type.upper()} audio synthesis failed (step {step}). Proceeding with text only.")

        # 3. ВСЕГДА отправляем единое событие, содержащее текст и опциональное аудио
        speech_event = {
            "event_type": "speech",
            "character": char_key,
            "type": text_type,      # 'thought' или 'action'
            "text": text,           # Текст реплики (обязательно)
            "step": step,
            "audio_url": final_audio_url  # Путь к аудио или null
        }
        await redis_conn.rpush(SPEECH_LIST_KEY, json.dumps(speech_event))
        print(
            f"--- Dispatched '{text_type.upper()}' speech event to spectator.")

    # Последовательно обрабатываем сначала мысль, потом действие
    await process_and_dispatch('thought', thought_text)
    await process_and_dispatch('action', action_text)

# --- Основные API эндпоинты ---


@app.get("/api/spectator_stream")
async def spectator_stream(request: Request): return StreamingResponse(
    spectator_stream_generator(request), media_type="text/event-stream")


@app.get("/api/gm_stream")
async def gm_stream(request: Request): return StreamingResponse(
    gm_stream_generator(request), media_type="text/event-stream")


@app.get("/", response_class=RedirectResponse, include_in_schema=False)
async def root(): return "/gm/console-gm.html"


@app.get("/spectator", response_class=RedirectResponse, include_in_schema=False)
async def spectator_redirect(): return "/sp/spectator.html"


@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key
    all_chars = {**(load_json(CHARACTERS_FILE) or {}),
                 **(load_json(NPC_FILE) or {})}
    if char_key not in all_chars:
        raise HTTPException(404, f"Character '{char_key}' not found.")

    char = all_chars[char_key]
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    history = event_data.get("history", [])
    new_step_number = len(history) + 1

    # Загружаем данные об активных персонажах
    active_char_ids = (load_json(ACTIVE_CHARACTERS_FILE)
                       or {}).get("characters_id", [])
    active_characters = [all_chars[char_id]
                         for char_id in active_char_ids if char_id in all_chars]

    prompt = build_prompt(char, history, active_characters)
    save_prompt_to_log(char_key, prompt)

    try:
        response = client.chat.completions.create(
            model=char.get("meta", {}).get(
                "model_id", "deepseek/deepseek-v3.2"),
            messages=[{"role": "system", "content": "Ты — игрок в текстовой ролевой игре."}, {
                "role": "user", "content": prompt}]
        )
        ai_response = response.choices[0].message.content
    except Exception as e:
        raise HTTPException(
            status_code=502, detail="AI model API call failed.")

    updated_event_data = handle_response(
        ai_response, event_data, char_key, char.get("identity", {}).get('name'),
        char.get("meta", {}).get('role'), new_step_number
    )
    save_json(EVENT_LOG_FILE, updated_event_data)

    # Логика отправки текста и аудио теперь полностью делегирована dispatch_speech_events
    parsed_data = parse_ai_response(ai_response)
    thought_text = parsed_data.get("thought")
    action_text = parsed_data.get("action")

    tts_service = app_state.get("tts_service")
    voice_sample_path = char.get("meta", {}).get("voice_sample")

    # Запускаем фоновую задачу для синтеза и отправки событий
    # Это гарантирует, что эндпоинт /act вернет ответ немедленно
    if tts_service and voice_sample_path:
        asyncio.create_task(
            dispatch_speech_events(
                redis_pool=app_state["redis_pool"], tts_service=tts_service, char_key=char_key,
                thought_text=thought_text, action_text=action_text,
                voice_sample_path=voice_sample_path, step=new_step_number
            )
        )
    else:
        # ОТКАЗОУСТОЙЧИВОСТЬ: Если TTS не работает или нет голоса, отправляем только текст
        print("--- TTS service not available or no voice sample. Dispatching text only.")
        asyncio.create_task(
            dispatch_speech_events(
                redis_pool=app_state["redis_pool"], tts_service=None, char_key=char_key,
                thought_text=thought_text, action_text=action_text,
                voice_sample_path="", step=new_step_number
            )
        )

    return {"response": ai_response}


@app.post("/api/broadcast_dice_roll")
async def broadcast_dice_roll(request: DiceRollRequest):
    redis_conn = redis.Redis(connection_pool=app_state["redis_pool"])
    try:
        await redis_conn.rpush(DICE_ROLL_QUEUE, json.dumps({"roll": request.roll}))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to broadcast dice roll.")


@app.post("/api/characters/activate")
async def activate_character(request: CharacterActionRequest):
    d = load_json(ACTIVE_CHARACTERS_FILE) or {"characters_id": []}
    if request.character_id not in d["characters_id"]:
        d["characters_id"].append(request.character_id)
    save_json(ACTIVE_CHARACTERS_FILE, d)
    return {"status": "success"}


@app.post("/api/characters/deactivate")
async def deactivate_character(request: CharacterActionRequest):
    d = load_json(ACTIVE_CHARACTERS_FILE) or {"characters_id": []}
    if request.character_id in d["characters_id"]:
        d["characters_id"].remove(request.character_id)
    save_json(ACTIVE_CHARACTERS_FILE, d)
    return {"status": "success"}


@app.post("/api/settings/avatar-size")
async def update_avatar_size(request: AvatarSizeRequest):
    state = load_json(PUBLIC_STATE_FILE) or {}
    state["avatar_size"] = request.avatar_size
    save_json(PUBLIC_STATE_FILE, state)
    return {"status": "success", "avatar_size": request.avatar_size}


@app.post("/api/update_active_characters")
async def update_active_characters(request: UpdateCharactersRequest):
    save_json(ACTIVE_CHARACTERS_FILE, {"characters_id": request.characters_id})
    return {"status": "success"}


@app.get("/api/active_characters")
async def get_active_characters(): return (load_json(ACTIVE_CHARACTERS_FILE)
                                           or {"characters_id": []}).get("characters_id", [])


@app.get("/api/characters")
async def get_characters(): return load_json(CHARACTERS_FILE)


@app.get("/api/npcs")
async def get_npcs(): return load_json(NPC_FILE)


@app.get("/api/locations")
async def get_locations(): return (
    load_json(LOCATIONS_FILE) or {}).get("locations", {})


@app.get("/api/all_characters")
async def get_all_characters(): return {
    **(load_json(CHARACTERS_FILE) or {}), **(load_json(NPC_FILE) or {})}


@app.get("/api/event_log")
async def get_event_log(): return load_json(EVENT_LOG_FILE)


@app.get("/api/game_state")
async def get_game_state(): return load_json(
    PUBLIC_STATE_FILE) or {"current_location": None}


@app.post("/api/set_location")
async def set_location(request: SetLocationRequest):
    locs = load_json(LOCATIONS_FILE)
    if request.location_id not in locs.get("locations", {}):
        raise HTTPException(404)
    img_path = locs["locations"][request.location_id].replace("../", "")
    details = {"id": request.location_id,
               "name": request.location_id, "image_url": img_path}
    state = load_json(PUBLIC_STATE_FILE) or {}
    state["current_location"] = details
    save_json(PUBLIC_STATE_FILE, state)
    return {"status": "success"}


@app.post("/api/add_gm_action")
async def add_gm_action(request: GmActionRequest):
    d = load_json(EVENT_LOG_FILE) or {"history": []}
    h = d.get("history", [])
    step = h[-1].get("step", 0) + 1 if h else 1
    h.append({"step": step, "name": "Game Master",
             "role": "gm", "action": request.text})
    save_json(EVENT_LOG_FILE, {"history": h})
    return {"status": "success"}


@app.post("/api/observer_analysis")
async def observer_analysis(request: ObserverRequest):
    active_ids = (load_json(ACTIVE_CHARACTERS_FILE)
                  or {}).get("characters_id", [])
    if not active_ids:
        raise HTTPException(404)
    all_chars = await get_all_characters()
    active_chars = {k: all_chars[k] for k in active_ids if k in all_chars}
    if not active_chars:
        raise HTTPException(404)
    
    if request.character_id not in all_chars:
        raise HTTPException(status_code=404, detail=f"Character with id '{request.character_id}' not found.")

    char_name = all_chars[request.character_id].get("identity", {}).get("name", "Unknown")

    prompt = build_observer_prompt(
        action=request.action,
        dice_roll=request.dice_roll,
        characters=active_chars,
        character_name=char_name
    )
    
    save_prompt_to_log("observer", prompt)
    response = client.chat.completions.create(model="deepseek/deepseek-v3.2", messages=[
                                              {"role": "system", "content": "Ты — Процессор Игровой Логики."}, {"role": "user", "content": prompt}])
    return {"response": response.choices[0].message.content}


@app.post("/api/apply_json_patch")
async def apply_json_patch(request: JsonPatchRequest):
    chars, npcs = load_json(CHARACTERS_FILE) or {}, load_json(NPC_FILE) or {}
    for char_id, updates in request.patch.items():
        target = chars if char_id in chars else npcs
        if char_id in target:
            for key, value in updates.items():
                if isinstance(value, dict) and key in target.get(char_id, {}):
                    target[char_id][key].update(value)
                else:
                    target[char_id][key] = value
    save_json(CHARACTERS_FILE, chars)
    save_json(NPC_FILE, npcs)
    return {"status": "success"}
