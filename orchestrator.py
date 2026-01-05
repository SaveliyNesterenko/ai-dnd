
"""
Orchestrator.py
Основной серверный скрипт (Backend).
Отвечает за логику игры: загружает данные персонажей, историю событий,
формирует промт (контекст) и обращается к API нейросети.
"""

import os
import json
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from openai import OpenAI

from response_handler import handle_response
from utils.file_utils import load_json, save_json
from utils.logger import save_prompt_to_log
from prompt_builder import build_prompt, build_observer_prompt
from archivist import router as archivist_router  # Импортируем роутер

# Загрузка переменных окружения
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")

# Инициализация клиента OpenAI
client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

# Инициализация приложения FastAPI
app = FastAPI()

# Подключение роутера из archivist.py
app.include_router(archivist_router, prefix="/api")

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтирование статичной папки
app.mount("/data", StaticFiles(directory="data"), name="data")

# --- Модели данных ---

class ActionRequest(BaseModel):
    character_key: str

class GmActionRequest(BaseModel):
    text: str

class ActiveCharactersRequest(BaseModel):
    characters_id: List[str]

class ObserverRequest(BaseModel):
    action: str
    dice_roll: Optional[int] = None

class JsonPatchRequest(BaseModel):
    patch: Dict[str, Any]

# --- Константы файлов ---

CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOCATIONS_FILE = "./data/locations.json"
ACTIVE_CHARACTERS_FILE = "./data/active_characters.json"

# --- SSE (Server-Sent Events) --- 

last_known_event_data = {}
last_known_character_data = {}

async def event_stream_generator():
    global last_known_event_data
    while True:
        try:
            current_data = load_json(EVENT_LOG_FILE)
            if current_data and current_data != last_known_event_data:
                last_known_event_data = current_data
                yield f"data: {json.dumps(current_data)}\n\n"
        except Exception as e:
            print(f"Error in event_stream_generator: {e}")
        await asyncio.sleep(1)

async def character_stream_generator():
    global last_known_character_data
    initial_chars = await get_all_characters()
    if initial_chars:
        last_known_character_data = initial_chars
    
    while True:
        try:
            all_chars = await get_all_characters()
            if all_chars and all_chars != last_known_character_data:
                for char_id, char_data in all_chars.items():
                    if char_id not in last_known_character_data or \
                       last_known_character_data[char_id] != char_data:
                        update_payload = {"id": char_id, "data": char_data}
                        print(f"SENDING CHARACTER UPDATE: {char_id}")
                        yield f"data: {json.dumps(update_payload)}\n\n"
                last_known_character_data = all_chars
        except Exception as e:
            print(f"Error in character_stream_generator: {e}")
        await asyncio.sleep(1)

@app.get("/api/event_stream")
async def event_stream():
    return StreamingResponse(event_stream_generator(), media_type="text/event-stream")

@app.get("/api/character_stream")
async def character_stream():
    return StreamingResponse(character_stream_generator(), media_type="text/event-stream")


# --- Основные API эндпоинты ---

@app.post("/api/update_active_characters")
async def update_active_characters(request: ActiveCharactersRequest):
    try:
        if save_json(ACTIVE_CHARACTERS_FILE, request.dict()):
            return {"status": "success", "message": "Active characters updated."}
        else:
            raise HTTPException(status_code=500, detail="Failed to save file.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/characters")
async def get_characters():
    data = load_json(CHARACTERS_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Not found.")
    return data

@app.get("/api/npcs")
async def get_npcs():
    data = load_json(NPC_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Not found.")
    return data

@app.get("/api/locations")
async def get_locations():
    data = load_json(LOCATIONS_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Not found.")
    return data.get("locations", {})

@app.get("/api/all_characters")
async def get_all_characters():
    characters_data = load_json(CHARACTERS_FILE) or {}
    npc_data = load_json(NPC_FILE) or {}
    return {**characters_data, **npc_data}

@app.get("/api/event_log")
async def get_event_log():
    data = load_json(EVENT_LOG_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Not found.")
    return data

@app.post("/api/add_gm_action")
async def add_gm_action(request: GmActionRequest):
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    history = event_data.get("history", [])
    new_step = history[-1].get("step", 0) + 1 if history else 1
    new_action = {"step": new_step, "name": "Game Master", "role": "gm", "action": request.text}
    history.append(new_action)
    event_data["history"] = history
    if save_json(EVENT_LOG_FILE, event_data):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save event log.")

# --- Логика "Наблюдателя" (Observer) ---

@app.post("/api/observer_analysis")
async def observer_analysis(request: ObserverRequest):
    try:
        active_chars_data = load_json(ACTIVE_CHARACTERS_FILE)
        if not active_chars_data or not active_chars_data.get("characters_id"):
            raise HTTPException(status_code=404, detail="Active characters not set.")
        
        all_chars = await get_all_characters()
        active_ids = active_chars_data.get("characters_id")
        active_chars_details = {k: all_chars[k] for k in active_ids if k in all_chars}

        if not active_chars_details:
             raise HTTPException(status_code=404, detail="Active characters data not found.")

        prompt = build_observer_prompt(request.action, request.dice_roll, active_chars_details)
        save_prompt_to_log("observer", prompt)

        response = client.chat.completions.create(
            model="deepseek/deepseek-v3.2",
            messages=[
                {"role": "system", "content": "Ты — Процессор Игровой Логики."},
                {"role": "user", "content": prompt}
            ]
        )
        return {"response": response.choices[0].message.content}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/apply_json_patch")
async def apply_json_patch(request: JsonPatchRequest):
    try:
        characters = load_json(CHARACTERS_FILE) or {}
        npcs = load_json(NPC_FILE) or {}

        for char_id, updates in request.patch.items():
            target_dict = characters if char_id in characters else npcs if char_id in npcs else None
            if target_dict:
                for key, value in updates.items():
                    if isinstance(value, dict) and key in target_dict[char_id]:
                        target_dict[char_id][key].update(value)
                    else:
                        target_dict[char_id][key] = value

        save_json(CHARACTERS_FILE, characters)
        save_json(NPC_FILE, npcs)
        return {"status": "success"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Основная игровая логика ---

@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key
    all_chars = await get_all_characters()
    if char_key not in all_chars:
        raise HTTPException(status_code=404, detail=f"Character '{char_key}' not found.")
    
    char = all_chars[char_key]
    event_data = load_json(EVENT_LOG_FILE)
    history = event_data.get("history", []) if event_data else []

    prompt = build_prompt(char, history)
    model_id = char.get("meta", {}).get("model_id", "deepseek/deepseek-v3.2")
    save_prompt_to_log(char_key, prompt)

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": "Ты — игрок в текстовой ролевой игре."},
                {"role": "user", "content": prompt}
            ]
        )
        ai_response = response.choices[0].message.content
        
        event_data = load_json(EVENT_LOG_FILE) or {"history": []}
        char_name = char.get("identity", {}).get('name', 'Unknown')
        char_role = char.get("meta", {}).get('role', 'Unknown')
        updated_event_data = handle_response(ai_response, event_data, char_name, char_role)
        save_json(EVENT_LOG_FILE, updated_event_data)
        
        return {"response": ai_response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
