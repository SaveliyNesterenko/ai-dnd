"""
Orchestrator.py
Основной серверный скрипт (Backend), версия с единым SSE-потоком.
Отвечает за логику игры, обслуживание фронтенда и API.
"""

import os
import json
import asyncio
import redis.asyncio as redis
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
from utils.parser import parse_ai_response # <-- ИМПОРТИРУЕМ НОВЫЙ ПАРСЕР
from prompt_builder import build_prompt, build_observer_prompt
from archivist import router as archivist_router

# --- Инициализация ---
load_dotenv()
app = FastAPI()
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")
)

# --- Redis Pub/Sub Настройки ---
REDIS_URL = "redis://127.0.0.1:6379" 
redis_pool = redis.ConnectionPool.from_url(REDIS_URL, decode_responses=True)
SPEECH_CHANNEL = "speech_channel"

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Статичные файлы и роуты фронтенда ---
app.include_router(archivist_router, prefix="/api")
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/gm", StaticFiles(directory="frontend/gm-console"), name="gm-console")
app.mount("/sp", StaticFiles(directory="frontend/spectator"), name="spectator")

# --- Константы файлов ---
CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOCATIONS_FILE = "./data/locations.json"
ACTIVE_CHARACTERS_FILE = "./data/active_characters.json"
PUBLIC_STATE_FILE = "./data/public_state.json"

# --- Модели данных ---
class SpeechRequest(BaseModel): thought_text: Optional[str] = None; action_text: Optional[str] = None
class ActionRequest(BaseModel): character_key: str
class GmActionRequest(BaseModel): text: str
class CharacterActionRequest(BaseModel): character_id: str
class UpdateCharactersRequest(BaseModel): characters_id: List[str]
class ObserverRequest(BaseModel): action: str; dice_roll: Optional[int] = None
class JsonPatchRequest(BaseModel): patch: Dict[str, Any]
class SetLocationRequest(BaseModel): location_id: str

# --- Система Server-Sent Events (SSE) ---

def sse_format(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

async def spectator_stream_generator(request: Request):
    redis_conn = redis.Redis(connection_pool=redis_pool)
    pubsub = redis_conn.pubsub()
    last_game_state, last_active_chars = {}, {"characters_id": []}
    try:
        await pubsub.subscribe(SPEECH_CHANNEL)
        while True:
            if await request.is_disconnected(): break
            redis_msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.01)
            if redis_msg: yield sse_format("character_speech", json.loads(redis_msg['data']))
            current_game_state = load_json(PUBLIC_STATE_FILE) or {}
            if current_game_state != last_game_state:
                last_game_state = current_game_state
                yield sse_format("game_state_update", current_game_state)
            current_active_chars = load_json(ACTIVE_CHARACTERS_FILE) or {}
            if current_active_chars != last_active_chars:
                last_active_chars = current_active_chars
                yield sse_format("active_characters_update", current_active_chars.get("characters_id", []))
            await asyncio.sleep(0.5)
    finally:
        await pubsub.unsubscribe(SPEECH_CHANNEL)
        await redis_conn.close()

async def gm_stream_generator(request: Request):
    last_event_log, last_all_characters = {}, {}
    try:
        while True:
            if await request.is_disconnected(): break
            current_event_log = load_json(EVENT_LOG_FILE) or {}
            if current_event_log != last_event_log:
                last_event_log = current_event_log
                yield sse_format("event_log_update", current_event_log)
            all_chars = {**(load_json(CHARACTERS_FILE) or {}), **(load_json(NPC_FILE) or {})}
            if all_chars != last_all_characters:
                if not last_all_characters: last_all_characters = all_chars
                for char_id, char_data in all_chars.items():
                    if char_id not in last_all_characters or last_all_characters[char_id] != char_data:
                        yield sse_format("character_update", {"id": char_id, "data": char_data})
                last_all_characters = all_chars
            await asyncio.sleep(1)
    finally:
        pass

@app.get("/api/spectator_stream")
async def spectator_stream(request: Request): return StreamingResponse(spectator_stream_generator(request), media_type="text/event-stream")

@app.get("/api/gm_stream")
async def gm_stream(request: Request): return StreamingResponse(gm_stream_generator(request), media_type="text/event-stream")

# --- Основные роуты и API ---

@app.get("/", response_class=RedirectResponse, include_in_schema=False)
async def root(): return "/gm/console-gm.html"

@app.get("/spectator", response_class=RedirectResponse, include_in_schema=False)
async def spectator_redirect(): return "/sp/spectator.html"

@app.post("/api/character/{character_id}/say")
async def character_say(character_id: str, request: SpeechRequest):
    redis_conn = redis.Redis(connection_pool=redis_pool)
    try:
        if request.thought_text:
            await redis_conn.publish(SPEECH_CHANNEL, json.dumps({"character": character_id, "type": "thought", "text": request.thought_text}))
        if request.action_text:
            await redis_conn.publish(SPEECH_CHANNEL, json.dumps({"character": character_id, "type": "action", "text": request.action_text}))
    finally:
        await redis_conn.close()
    return {"status": "success"}

@app.post("/act")
async def generate_action(request: ActionRequest):
    print("\n\n--- EXECUTING /act ENDPOINT (STANDARDIZED VERSION) ---\n") # DEBUG
    char_key = request.character_key
    all_chars = await get_all_characters()
    if char_key not in all_chars: raise HTTPException(404, f"Character '{char_key}' not found.")
    
    char = all_chars[char_key]
    history = (load_json(EVENT_LOG_FILE) or {}).get("history", [])
    prompt = build_prompt(char, history)
    save_prompt_to_log(char_key, prompt)

    # Генерация ответа модели (ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ РАЗРАБОТКИ)
    # try:
    #     response = client.chat.completions.create(
    #         model=char.get("meta", {}).get("model_id", "deepseek/deepseek-v3.2"),
    #         messages=[{"role": "system", "content": "Ты — игрок в текстовой ролевой игре."}, {"role": "user", "content": prompt}]
    #     )
    #     ai_response = response.choices[0].message.content
    # except Exception as e:
    #     print(f"AI API call failed: {e}")
    #     raise HTTPException(status_code=502, detail="AI model API call failed.")
    
    # ИСПРАВЛЕННАЯ ВРЕМЕННАЯ ЗАГЛУШКА для ответа модели
    ai_response = f"[THOUGHTS]Это тестовая мысль для персонажа {char_key}.[ACTION]Это тестовое действие для персонажа {char_key}."
    print(f"--- DEBUG: Mock AI response created: {ai_response}")
    
    # --- Логика парсинга и отправки ---
    parsed_data = parse_ai_response(ai_response)
    print(f"\n--- IMPORTANT DEBUG: PARSED DATA IS: {parsed_data}\n")

    redis_conn = None
    try:
        redis_conn = redis.Redis(connection_pool=redis_pool)
        
        if parsed_data.get("thought"):
            message = {"character": char_key, "type": "thought", "text": parsed_data["thought"]}
            print(f"--- DEBUG: Publishing THOUGHT: {message}")
            await redis_conn.publish(SPEECH_CHANNEL, json.dumps(message))

        if parsed_data.get("action"):
            message = {"character": char_key, "type": "action", "text": parsed_data["action"]}
            print(f"--- DEBUG: Publishing ACTION: {message}")
            await redis_conn.publish(SPEECH_CHANNEL, json.dumps(message))
            
        print("--- DEBUG: Publish commands sent.")

    except Exception as e:
        print(f"--- CRITICAL ERROR during Redis publishing in /act: {e}")
    finally:
        if redis_conn:
            await redis_conn.close()
            print("--- DEBUG: Redis connection closed.")

    # Существующая логика: сохранение в лог событий
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    updated_event_data = handle_response(
        ai_response, event_data, char.get("identity", {}).get('name'), char.get("meta", {}).get('role')
    )
    save_json(EVENT_LOG_FILE, updated_event_data)
    
    return {"response": ai_response}

# (Остальные эндпоинты без изменений)

@app.post("/api/characters/activate")
async def activate_character(request: CharacterActionRequest):
    d = load_json(ACTIVE_CHARACTERS_FILE) or {"characters_id": []}
    if request.character_id not in d["characters_id"]: d["characters_id"].append(request.character_id)
    save_json(ACTIVE_CHARACTERS_FILE, d)
    return {"status": "success"}

@app.post("/api/characters/deactivate")
async def deactivate_character(request: CharacterActionRequest):
    d = load_json(ACTIVE_CHARACTERS_FILE) or {"characters_id": []}
    if request.character_id in d["characters_id"]: d["characters_id"].remove(request.character_id)
    save_json(ACTIVE_CHARACTERS_FILE, d)
    return {"status": "success"}

@app.post("/api/update_active_characters")
async def update_active_characters(request: UpdateCharactersRequest):
    save_json(ACTIVE_CHARACTERS_FILE, {"characters_id": request.characters_id})
    return {"status": "success"}

@app.get("/api/active_characters")
async def get_active_characters(): return (load_json(ACTIVE_CHARACTERS_FILE) or {"characters_id": []}).get("characters_id", [])

@app.get("/api/characters")
async def get_characters(): return load_json(CHARACTERS_FILE)

@app.get("/api/npcs")
async def get_npcs(): return load_json(NPC_FILE)

@app.get("/api/locations")
async def get_locations(): return (load_json(LOCATIONS_FILE) or {}).get("locations", {})

@app.get("/api/all_characters")
async def get_all_characters(): return {**(load_json(CHARACTERS_FILE) or {}), **(load_json(NPC_FILE) or {})}

@app.get("/api/event_log")
async def get_event_log(): return load_json(EVENT_LOG_FILE)

@app.get("/api/game_state")
async def get_game_state(): return load_json(PUBLIC_STATE_FILE) or {"current_location": None}

@app.post("/api/set_location")
async def set_location(request: SetLocationRequest):
    locs = load_json(LOCATIONS_FILE)
    if request.location_id not in locs.get("locations", {}): raise HTTPException(404)
    img_path = locs["locations"][request.location_id].replace("../", "")
    details = {"id": request.location_id, "name": request.location_id, "image_url": img_path}
    state = load_json(PUBLIC_STATE_FILE) or {}
    state["current_location"] = details
    save_json(PUBLIC_STATE_FILE, state)
    return {"status": "success"}

@app.post("/api/add_gm_action")
async def add_gm_action(request: GmActionRequest):
    d = load_json(EVENT_LOG_FILE) or {"history": []}
    h = d.get("history", [])
    step = h[-1].get("step", 0) + 1 if h else 1
    h.append({"step": step, "name": "Game Master", "role": "gm", "action": request.text})
    save_json(EVENT_LOG_FILE, {"history": h})
    return {"status": "success"}

@app.post("/api/observer_analysis")
async def observer_analysis(request: ObserverRequest):
    active_ids = (load_json(ACTIVE_CHARACTERS_FILE) or {}).get("characters_id", [])
    if not active_ids: raise HTTPException(404)
    all_chars = await get_all_characters()
    active_chars = {k: all_chars[k] for k in active_ids if k in all_chars}
    if not active_chars: raise HTTPException(404)
    prompt = build_observer_prompt(request.action, request.dice_roll, active_chars)
    save_prompt_to_log("observer", prompt)
    response = client.chat.completions.create(model="deepseek/deepseek-v3.2", messages=[{"role": "system", "content": "Ты — Процессор Игровой Логики."}, {"role": "user", "content": prompt}])
    return {"response": response.choices[0].message.content}

@app.post("/api/apply_json_patch")
async def apply_json_patch(request: JsonPatchRequest):
    chars, npcs = load_json(CHARACTERS_FILE) or {}, load_json(NPC_FILE) or {}
    for char_id, updates in request.patch.items():
        target = chars if char_id in chars else npcs
        if char_id in target: 
            for key, value in updates.items():
                if isinstance(value, dict) and key in target.get(char_id, {}): target[char_id][key].update(value)
                else: target[char_id][key] = value
    save_json(CHARACTERS_FILE, chars); save_json(NPC_FILE, npcs)
    return {"status": "success"}
