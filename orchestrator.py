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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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


class ActionRequest(BaseModel):
    character_key: str


CHARACTERS_FILE = "./data/characters.json"
EVENT_LOG_FILE = "./data/event_log.json"
LOG_DIR = "./logs"

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)


def load_json(filepath):
    abs_path = os.path.abspath(filepath)
    print(f"📂 Загрузка файла: {abs_path}")

    if not os.path.exists(filepath):
        print(f"❌ ОШИБКА: Файл физически не найден по пути: {filepath}")
        return None

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict):
                print(f"✅ Файл загружен. Найдены ключи: {list(data.keys())}")
            return data
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


@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key

    characters_data = load_json(CHARACTERS_FILE)
    if not characters_data or char_key not in characters_data:
        raise HTTPException(
            status_code=404, detail=f"Character '{char_key}' not found.")

    char = characters_data[char_key]
    meta = char.get("meta", {})
    identity = char.get("identity", {})
    stats = char.get("stats", {})
    inventory = char.get("inventory", [])
    memory = char.get("memory", {})

    event_data = load_json(EVENT_LOG_FILE)
    history = event_data.get("history", []) if event_data else []

    bio_block = (
        f"Роль: {meta.get('role', 'Unknown')}\n"
        f"Имя: {identity.get('name', 'Unknown')}\n"
        f"Биография: {identity.get('bio', '')}"
    )

    hp_curr = stats.get('hp', {}).get('current', '?')
    hp_max = stats.get('hp', {}).get('max', '?')
    mp_curr = stats.get('mp', {}).get('current', '?')
    mp_max = stats.get('mp', {}).get('max', '?')

    attributes_dict = stats.get('attributes', {})
    attributes_list = [f"{k}: {v}" for k, v in attributes_dict.items()]
    attributes_str = ", ".join(attributes_list)

    effects_list = stats.get('status_effects', [])
    effects_str = ", ".join(effects_list) if effects_list else "Нет"

    stats_str = (
        f"Здоровье (HP): {hp_curr}/{hp_max} | Мана (MP): {mp_curr}/{mp_max}\n"
        f"Атрибуты: {attributes_str}\n"
        f"Эффекты: {effects_str}"
    )

    inv_str = "Инвентарь:\n"
    if inventory:
        for item in inventory:
            inv_str += f"- {item.get('name')} ({item.get('quantity')} шт): {item.get('description')}\n"
    else:
        inv_str += "Пусто."

    state_block = f"{stats_str}\n{inv_str}"

    global_mem = "\n".join(memory.get("global_chronicle", []))
    private_mem = "\n".join(memory.get("private_notes", []))
    memory_block = f"Глобальные знания:\n{global_mem}\n\nЛичные заметки:\n{private_mem}"

    context_lines = []
    for event in history:
        step_info = f"[Шаг {event.get('step')}] {event.get('name')}:"
        action_text = f"Действие/Речь: {event.get('action')}"
        context_lines.append(f"{step_info} {action_text}")

    context_block = "История событий (Лог):\n" + "\n".join(context_lines)

    goal_block = "Твоя задача — отыгрывать роль своего персонажа, опираясь на его характер, состояние и историю событий."

    format_block = (
        '''Твой ответ должен быть простым текстом, четко разделенным специальными тегами на два блока
        [THOUGHTS] Мысли и [ACTION] Действие / Речь.
        Строго следуй формату.
        Сначала напиши скрытые мысли персонажа, затем то, что он делает и (или) говорит вслух.'''
    )

    final_prompt = (
        f"--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---\n{bio_block}\n\n"
        f"--- СОСТОЯНИЕ ---\n{state_block}\n\n"
        f"--- ПАМЯТЬ ---\n{memory_block}\n\n"
        f"--- КОНТЕКСТ ИГРЫ ---\n{context_block}\n\n"
        f"--- ЦЕЛЬ ---\n{goal_block}\n\n"
        f"--- ФОРМАТ ОТВЕТА ---\n{format_block}"
    )

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

        event_data = load_json(EVENT_LOG_FILE)
        if event_data is None:
            event_data = {"history": []}

        character_name = identity.get('name', 'Unknown')
        updated_event_data = handle_response(ai_response, event_data, character_name)

        save_json(EVENT_LOG_FILE, updated_event_data)

        return {"response": ai_response}

    except Exception as e:
        print(f"Error calling API: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
