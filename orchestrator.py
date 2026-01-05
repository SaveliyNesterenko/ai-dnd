
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
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from openai import OpenAI
from response_handler import handle_response
from utils.file_utils import load_json, save_json
from utils.logger import save_prompt_to_log
from prompt_builder import build_prompt, build_observer_prompt

# Загрузка переменных окружения из файла .env.
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")

# Инициализация клиента OpenAI.
client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

# Инициализация приложения FastAPI.
app = FastAPI()

# Настройка CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтирование статичной папки для раздачи данных.
app.mount("/data", StaticFiles(directory="data"), name="data")


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


CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOCATIONS_FILE = "./data/locations.json"
ACTIVE_CHARACTERS_FILE = "./data/active_characters.json"

# --- SSE (Server-Sent Events) Endpoints ---

last_known_event_data = {}
last_known_character_data = {}

async def event_stream_generator():
    """
    Генератор, который следит за изменениями в event_log.json
    и отправляет обновления клиенту.
    """
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
    """
    Генератор, который следит за изменениями в файлах персонажей
    и отправляет обновления клиенту.
    """
    global last_known_character_data
    # При первом запуске, кешируем начальное состояние без отправки
    initial_chars = await get_all_characters()
    if initial_chars:
        last_known_character_data = initial_chars
    
    while True:
        try:
            all_chars = await get_all_characters()
            if all_chars and all_chars != last_known_character_data:
                # Определяем, какие персонажи изменились
                for char_id, char_data in all_chars.items():
                    if char_id not in last_known_character_data or \
                       last_known_character_data[char_id] != char_data:
                        update_payload = {
                            "id": char_id,
                            "data": char_data
                        }
                        print(f"SENDING CHARACTER UPDATE: {char_id}")
                        yield f"data: {json.dumps(update_payload)}\n\n"
                last_known_character_data = all_chars
        except Exception as e:
            print(f"Error in character_stream_generator: {e}")
        await asyncio.sleep(1)

@app.get("/api/event_stream")
async def event_stream():
    """
    Эндпоинт для получения обновлений журнала событий.
    """
    return StreamingResponse(event_stream_generator(), media_type="text/event-stream")

@app.get("/api/character_stream")
async def character_stream():
    """
    Эндпоинт для получения обновлений данных персонажей.
    """
    return StreamingResponse(character_stream_generator(), media_type="text/event-stream")


# --- Standard API Endpoints ---

@app.post("/api/update_active_characters")
async def update_active_characters(request: ActiveCharactersRequest):
    """
    Обновляет файл active_characters.json списком ID активных персонажей.
    """
    try:
        # Мы просто перезаписываем файл, так как нам не нужно сохранять предыдущее состояние
        if save_json(ACTIVE_CHARACTERS_FILE, request.dict()):
            return {"status": "success", "message": "Active characters updated."}
        else:
            raise HTTPException(status_code=500, detail="Failed to save active characters file.")
    except Exception as e:
        print(f"Error updating active characters: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/characters")
async def get_characters():
    characters_data = load_json(CHARACTERS_FILE)
    if characters_data is None:
        raise HTTPException(status_code=404, detail="Character data not found.")
    return characters_data

@app.get("/api/npcs")
async def get_npcs():
    npc_data = load_json(NPC_FILE)
    if npc_data is None:
        raise HTTPException(status_code=404, detail="NPC data not found.")
    return npc_data

@app.get("/api/locations")
async def get_locations():
    locations_data = load_json(LOCATIONS_FILE)
    if locations_data is None:
        raise HTTPException(status_code=404, detail="Locations data not found.")
    return locations_data.get("locations", {})

@app.get("/api/all_characters")
async def get_all_characters():
    characters_data = load_json(CHARACTERS_FILE) or {}
    npc_data = load_json(NPC_FILE) or {}
    combined_data = {**characters_data, **npc_data}
    # Не вызываем HTTPException, чтобы стрим работал, даже если файлы пусты
    return combined_data

@app.get("/api/event_log")
async def get_event_log():
    event_log_data = load_json(EVENT_LOG_FILE)
    if event_log_data is None:
        raise HTTPException(status_code=404, detail="Event log not found.")
    return event_log_data

@app.post("/api/add_gm_action")
async def add_gm_action(request: GmActionRequest):
    event_data = load_json(EVENT_LOG_FILE) or {"history": []}
    history = event_data.get("history", [])
    new_step_number = history[-1].get("step", 0) + 1 if history else 1
    new_action = {
        "step": new_step_number,
        "name": "Game Master",
        "action": request.text
    }
    history.append(new_action)
    event_data["history"] = history
    if save_json(EVENT_LOG_FILE, event_data):
        return {"status": "success", "message": "GM action added."}
    else:
        raise HTTPException(status_code=500, detail="Failed to save event log.")

# --- OBSERVER LOGIC ---

@app.post("/api/observer_analysis")
async def observer_analysis(request: ObserverRequest):
    try:
        # 1. Загружаем ID активных персонажей
        active_chars_data = load_json(ACTIVE_CHARACTERS_FILE)
        if not active_chars_data or not active_chars_data.get("characters_id"):
            raise HTTPException(status_code=404, detail="Active characters not found or empty.")
        active_ids = active_chars_data.get("characters_id")

        # 2. Загружаем полные данные персонажей
        all_chars = await get_all_characters()
        active_chars_details = {char_id: all_chars[char_id] for char_id in active_ids if char_id in all_chars}

        if not active_chars_details:
             raise HTTPException(status_code=404, detail="No active characters with valid data found.")

        # 3. Формируем промт
        prompt = build_observer_prompt(request.action, request.dice_roll, active_chars_details)
        save_prompt_to_log("observer", prompt) # Сохраняем промт для дебага

        # 4. Отправляем запрос к модели
        response = client.chat.completions.create(
            model="deepseek/deepseek-v3.2", # Или другая модель по выбору
            messages=[
                {"role": "system", "content": "Ты — Процессор Игровой Логики."},
                {"role": "user", "content": prompt}
            ]
        )
        observer_response = response.choices[0].message.content
        return {"response": observer_response}

    except Exception as e:
        print(f"Error in observer_analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/apply_json_patch")
async def apply_json_patch(request: JsonPatchRequest):
    try:
        patch_data = request.patch
        
        # Загружаем текущие данные
        characters_data = load_json(CHARACTERS_FILE) or {}
        npc_data = load_json(NPC_FILE) or {}

        # Применяем изменения
        for char_id, updates in patch_data.items():
            if char_id in characters_data:
                # Глубокое обновление словаря
                for key, value in updates.items():
                    if isinstance(value, dict) and key in characters_data[char_id]:
                        characters_data[char_id][key].update(value)
                    else:
                        characters_data[char_id][key] = value
            elif char_id in npc_data:
                 for key, value in updates.items():
                    if isinstance(value, dict) and key in npc_data[char_id]:
                        npc_data[char_id][key].update(value)
                    else:
                        npc_data[char_id][key] = value

        # Сохраняем обновленные данные
        save_json(CHARACTERS_FILE, characters_data)
        save_json(NPC_FILE, npc_data)

        return {"status": "success", "message": "Characters and NPCs updated successfully."}

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format in patch.")
    except Exception as e:
        print(f"Error applying JSON patch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- MAIN GAME LOGIC ---

@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key
    all_chars_data = await get_all_characters()
    if char_key not in all_chars_data:
        raise HTTPException(status_code=404, detail=f"Character '{char_key}' not found.")
    
    char = all_chars_data[char_key]
    event_data = load_json(EVENT_LOG_FILE)
    history = event_data.get("history", []) if event_data else []

    final_prompt = build_prompt(char, history)
    
    model_id = char.get("meta", {}).get("model_id", "deepseek/deepseek-v3.2")
    print(f"Запрос к модели: {model_id}")
    save_prompt_to_log(char_key, final_prompt)

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": "Ты — игрок в текстовой ролевой игре."},
                {"role": "user", "content": final_prompt}
            ]
        )
        ai_response = response.choices[0].message.content
        event_data = load_json(EVENT_LOG_FILE) or {"history": []}
        character_name = char.get("identity", {}).get('name', 'Unknown')
        updated_event_data = handle_response(ai_response, event_data, character_name)
        save_json(EVENT_LOG_FILE, updated_event_data)
        return {"response": ai_response}
    except Exception as e:
        print(f"Error calling API: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
