"""
Orchestrator.py
Основной серверный скрипт (Backend).
Отвечает за логику игры: загружает данные персонажей, историю событий,
формирует промт (контекст) и обращается к API нейросети.
"""

import os
import json
import datetime
import uvicorn
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
from response_handler import handle_response

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


CHARACTERS_FILE = "./data/characters.json"
NPC_FILE = "./data/npc.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOG_DIR = "./logs"

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)


def load_json(filepath):
    abs_path = os.path.abspath(filepath)
    if not os.path.exists(filepath):
        print(f"❌ ОШИБКА: Файл физически не найден по пути: {filepath}")
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ ОШИБКА JSON: Неверный формат файла {filepath}. Детали: {e}")
        return None
    except Exception as e:
        print(f"❌ ОШИБКА: Не удалось открыть файл. Детали: {e}")
        return None


def save_json(filepath, data):
    """
    Безопасное сохранение JSON-файлов.
    """
    abs_path = os.path.abspath(filepath)
    print(f"💾 Сохранение файла: {abs_path}")
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"✅ Файл успешно сохранен.")
        return True
    except Exception as e:
        print(f"❌ ОШИБКА: Не удалось сохранить файл. Детали: {e}")
        return False


def save_prompt_to_log(char_key, prompt_text):
    print(f"🗂️  Logging prompt for char_key: {char_key}")
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"{LOG_DIR}/{now}_{char_key}.txt"
    try:
        with open(filename, "w", encoding="utf-8") as f:
            f.write(prompt_text)
        print(f"📝 Промт успешно сохранен в файл: {filename}")
    except Exception as e:
        print(f"⚠️ Ошибка при сохранении лога: {e}")

# --- SSE (Server-Sent Events) Endpoint ---

last_known_data = {}

async def event_stream_generator():
    """
    Генератор, который следит за изменениями в event_log.json
    и отправляет обновления клиенту.
    """
    global last_known_data
    while True:
        try:
            with open(EVENT_LOG_FILE, 'r', encoding='utf-8') as f:
                current_data = json.load(f)
            if current_data != last_known_data:
                last_known_data = current_data
                yield f"data: {json.dumps(current_data)}\n\n"
        except (IOError, json.JSONDecodeError):
            pass
        await asyncio.sleep(1)

@app.get("/api/event_stream")
async def event_stream():
    """
    Эндпоинт, к которому будет подключаться клиент для получения
    обновлений журнала событий в реальном времени.
    """
    return StreamingResponse(event_stream_generator(), media_type="text/event-stream")


# --- Standard API Endpoints ---

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

@app.get("/api/all_characters")
async def get_all_characters():
    characters_data = load_json(CHARACTERS_FILE) or {}
    npc_data = load_json(NPC_FILE) or {}
    combined_data = {**characters_data, **npc_data}
    if not combined_data:
        raise HTTPException(status_code=404, detail="No character or NPC data found.")
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

# --- MAIN GAME LOGIC ---

@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key
    all_chars_data = await get_all_characters()
    if char_key not in all_chars_data:
        raise HTTPException(status_code=404, detail=f"Character '{char_key}' not found.")
    
    char = all_chars_data[char_key]
    meta = char.get("meta", {})
    identity = char.get("identity", {})
    stats = char.get("stats", {})
    inventory = char.get("inventory", [])
    memory = char.get("memory", {})
    event_data = load_json(EVENT_LOG_FILE)
    history = event_data.get("history", []) if event_data else []

    bio_block = f"Роль: {meta.get('role', 'Unknown')}\nИмя: {identity.get('name', 'Unknown')}\nБиография: {identity.get('bio', '')}"
    hp_curr, hp_max = stats.get('hp', {}).get('current', '?'), stats.get('hp', {}).get('max', '?')
    mp_curr, mp_max = stats.get('mp', {}).get('current', '?'), stats.get('mp', {}).get('max', '?')
    attributes_str = ", ".join([f"{k}: {v}" for k, v in stats.get('attributes', {}).items()])
    effects_str = ", ".join(stats.get('status_effects', [])) or "Нет"
    stats_str = f"Здоровье (HP): {hp_curr}/{hp_max} | Мана (MP): {mp_curr}/{mp_max}\nАтрибуты: {attributes_str}\nЭффекты: {effects_str}"
    
    inv_str = "Инвентарь:\n" + ("\n".join([f"- {item.get('name')} ({item.get('quantity')} шт): {item.get('description')}" for item in inventory]) if inventory else "Пусто.")
    state_block = f"{stats_str}\n{inv_str}"

    global_mem = "\n".join(memory.get("global_chronicle", []))
    private_mem = "\n".join(memory.get("private_notes", []))
    memory_block = f"Глобальные знания:\n{global_mem}\n\nЛичные заметки:\n{private_mem}"

    context_lines = [f"[Шаг {e.get('step')}] {e.get('name')}: Действие/Речь: {e.get('action')}" for e in history]
    context_block = "История событий (Лог):\n" + "\n".join(context_lines)

    goal_block = "Твоя задача — отыгрывать роль своего персонажа, опираясь на его характер, состояние и историю событий."
    format_block = "Твой ответ должен быть простым текстом, четко разделенным специальными тегами на два блока\n[THOUGHTS] Мысли и [ACTION] Действие / Речь.\nСтрого следуй формату.\nСначала напиши скрытые мысли персонажа, затем то, что он делает и (или) говорит вслух."

    final_prompt = f"--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---\n{bio_block}\n\n--- СОСТОЯНИЕ ---\n{state_block}\n\n--- ПАМЯТЬ ---\n{memory_block}\n\n--- КОНТЕКСТ ИГРЫ ---\n{context_block}\n\n--- ЦЕЛЬ ---\n{goal_block}\n\n--- ФОРМАТ ОТВЕТА ---\n{format_block}"

    print(f"Запрос к модели: {meta.get('model_id')}")
    save_prompt_to_log(char_key, final_prompt)

    try:
        response = client.chat.completions.create(
            model=meta.get("model_id", "deepseek/deepseek-v3.2"),
            messages=[
                {"role": "system", "content": "Ты — игрок в текстовой ролевой игре."},
                {"role": "user", "content": final_prompt}
            ]
        )
        ai_response = response.choices[0].message.content
        event_data = load_json(EVENT_LOG_FILE) or {"history": []}
        character_name = identity.get('name', 'Unknown')
        updated_event_data = handle_response(ai_response, event_data, character_name)
        save_json(EVENT_LOG_FILE, updated_event_data)
        return {"response": ai_response}
    except Exception as e:
        print(f"Error calling API: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
