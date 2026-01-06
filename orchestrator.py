"""
Orchestrator.py
Основной серверный скрипт (Backend).
Отвечает за логику игры, обслуживание фронтенда и API.
"""

import os
import json
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
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
from archivist import router as archivist_router

# --- Инициализация --- 
load_dotenv()
app = FastAPI()
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")
)

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

@app.get("/", response_class=RedirectResponse, include_in_schema=False)
async def root():
    return "/gm/gm-console.html"

@app.get("/spectator", response_class=RedirectResponse, include_in_schema=False)
async def spectator_redirect():
    return "/sp/spectator.html"

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

class SetLocationRequest(BaseModel): 
    location_id: str

# --- Константы файлов ---
CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOCATIONS_FILE = "./data/locations.json"
ACTIVE_CHARACTERS_FILE = "./data/active_characters.json"
PUBLIC_STATE_FILE = "./data/public_state.json"

# --- Server-Sent Events (SSE) --- 
last_known_event_data = {}
last_known_character_data = {}

async def event_stream_generator():
    global last_known_event_data
    while True:
        try:
            current_data = load_json(EVENT_LOG_FILE)
            if current_data != last_known_event_data:
                last_known_event_data = current_data
                yield f"data: {json.dumps(current_data)}\n\n"
        except Exception as e:
            print(f"Error in event_stream_generator: {e}")
        await asyncio.sleep(1)

async def character_stream_generator():
    global last_known_character_data
    # При первом запуске, инициализируем состояние
    initial_chars = await get_all_characters()
    if initial_chars:
        last_known_character_data = initial_chars

    while True:
        try:
            all_chars = await get_all_characters()
            # Проверяем, есть ли изменения
            if all_chars and all_chars != last_known_character_data:
                # Если есть, ищем, у кого именно
                for char_id, char_data in all_chars.items():
                    if char_id not in last_known_character_data or \
                       last_known_character_data[char_id] != char_data:
                        update_payload = {"id": char_id, "data": char_data}
                        print(f"SENDING CHARACTER UPDATE: {char_id}")
                        yield f"data: {json.dumps(update_payload)}\n\n"
                # Обновляем сохраненное состояние
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
    if save_json(ACTIVE_CHARACTERS_FILE, request.dict()):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save active characters.")

@app.get("/api/characters")
async def get_characters():
    data = load_json(CHARACTERS_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Characters file not found.")
    return data

@app.get("/api/npcs")
async def get_npcs():
    data = load_json(NPC_FILE)
    if data is None: raise HTTPException(status_code=404, detail="NPC file not found.")
    return data

@app.get("/api/locations")
async def get_locations():
    data = load_json(LOCATIONS_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Locations file not found.")
    return data.get("locations", {})

@app.get("/api/all_characters")
async def get_all_characters(): 
    chars = load_json(CHARACTERS_FILE) or {}
    npcs = load_json(NPC_FILE) or {}
    return {**chars, **npcs}

@app.get("/api/event_log")
async def get_event_log(): 
    data = load_json(EVENT_LOG_FILE)
    if data is None: raise HTTPException(status_code=404, detail="Event log not found.")
    return data

@app.get("/api/game_state")
async def get_game_state():
    return load_json(PUBLIC_STATE_FILE) or {"current_location": None}

@app.post("/api/set_location")
async def set_location(request: SetLocationRequest):
    location_id = request.location_id
    locations_data = load_json(LOCATIONS_FILE)
    if not locations_data or location_id not in locations_data.get("locations", {}):
        raise HTTPException(404, f"Location '{location_id}' not found.")
    
    image_path = locations_data["locations"][location_id]
    client_safe_path = image_path.replace("../", "")
    
    location_details = {"id": location_id, "name": location_id, "image_url": client_safe_path}
    
    public_state = load_json(PUBLIC_STATE_FILE) or {}
    public_state["current_location"] = location_details
    if save_json(PUBLIC_STATE_FILE, public_state):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save public state.")

@app.post("/api/add_gm_action")
async def add_gm_action(request: GmActionRequest):
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    history = event_data.get("history", [])
    new_step = history[-1].get("step", 0) + 1 if history else 1
    history.append({"step": new_step, "name": "Game Master", "role": "gm", "action": request.text})
    if save_json(EVENT_LOG_FILE, {"history": history}):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save GM action.")

@app.post("/api/observer_analysis")
async def observer_analysis(request: ObserverRequest):
    active_data = load_json(ACTIVE_CHARACTERS_FILE)
    active_ids = active_data.get("characters_id", []) if active_data else []
    if not active_ids: raise HTTPException(404, "Active characters not set.")
    
    all_chars = await get_all_characters()
    active_chars = {k: all_chars[k] for k in active_ids if k in all_chars}
    if not active_chars: raise HTTPException(404, "Active characters data not found.")

    prompt = build_observer_prompt(request.action, request.dice_roll, active_chars)
    save_prompt_to_log("observer", prompt)

    response = client.chat.completions.create(
        model="deepseek/deepseek-v3.2",
        messages=[{"role": "system", "content": "Ты — Процессор Игровой Логики."}, {"role": "user", "content": prompt}]
    )
    return {"response": response.choices[0].message.content}

@app.post("/api/apply_json_patch")
async def apply_json_patch(request: JsonPatchRequest):
    characters = load_json(CHARACTERS_FILE) or {}
    npcs = load_json(NPC_FILE) or {}
    for char_id, updates in request.patch.items():
        target_dict = characters if char_id in characters else npcs
        if char_id in target_dict:
            for key, value in updates.items():
                if isinstance(value, dict) and key in target_dict.get(char_id, {}):
                    target_dict[char_id][key].update(value)
                else: 
                    target_dict[char_id][key] = value
    save_json(CHARACTERS_FILE, characters)
    save_json(NPC_FILE, npcs)
    return {"status": "success"}

@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key
    all_chars = await get_all_characters()
    if char_key not in all_chars: raise HTTPException(404, f"Character '{char_key}' not found.")
    
    char = all_chars[char_key]
    history = (load_json(EVENT_LOG_FILE) or {}).get("history", [])
    prompt = build_prompt(char, history)
    save_prompt_to_log(char_key, prompt)

    response = client.chat.completions.create(
        model=char.get("meta", {}).get("model_id", "deepseek/deepseek-v3.2"),
        messages=[{"role": "system", "content": "Ты — игрок в текстовой ролевой игре."}, {"role": "user", "content": prompt}]
    )
    ai_response = response.choices[0].message.content
    
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    updated_event_data = handle_response(
        ai_response, event_data, char.get("identity", {}).get('name'), char.get("meta", {}).get('role')
    )
    save_json(EVENT_LOG_FILE, updated_event_data)
    return {"response": ai_response}

# --- Запуск --- 
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
