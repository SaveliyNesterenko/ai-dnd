"""
Orchestrator.py
Основной серверный скрипт (Backend).
Отвечает за логику игры: загружает данные персонажей, историю событий,
формирует промт (контекст) и обращается к API нейросети.
"""

import os  # стандартная библиотека для работы с файловой системой и временем.
# стандартная библиотека для работы с файловой системой и временем.
import json
# стандартная библиотека для работы с файловой системой и временем.
import datetime
import uvicorn  # сервер для запуска FastAPI приложений.
from fastapi import FastAPI, HTTPException  # фреймворк для создания веб-API.
from fastapi.middleware.cors import CORSMiddleware
# библиотека для валидации входящих данных (типизация запросов).
from pydantic import BaseModel
from dotenv import load_dotenv  # загрузка секретных ключей из файла .env.
# клиент для взаимодействия с API (совместим с DeepSeek/RouterAI).
from openai import OpenAI

# Загрузка переменных окружения из файла .env.
# Это критически важно для безопасности API ключей.

# Инициализация клиента OpenAI.
# Мы используем кастомный base_url (RouterAI), но библиотека OpenAI
# используется как удобная обертка для отправки запросов.
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")

# Инициализация клиента OpenAI.
# Мы используем кастомный base_url (RouterAI), но библиотека OpenAI
# используется как удобная обертка для отправки запросов.
client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

# Инициализация приложения FastAPI.
app = FastAPI()

# Настройка CORS (Cross-Origin Resource Sharing).
# Это разрешает браузеру (Frontend), запущенному локально или на другом порту,
# отправлять запросы к нашему серверу. Без этого браузер заблокирует запрос.
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

# Создаем папку для логов, если её нет
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)


def load_json(filepath):
    """
    Безопасная загрузка JSON-файлов.

    Функционал:
    1. Проверяет физическое наличие файла.
    2. Пытается распарсить JSON.
    3. Обрабатывает ошибки (файл не найден, битый JSON), 
       чтобы сервер не упал, а вывел понятную ошибку в консоль.

    Возвращает: dict (словарь данных) или None в случае ошибки.
    """
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


def save_prompt_to_log(char_key, prompt_text):
    """
    Функция записывает полный текст промта в файл с текущей датой и временем.
    """
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"{LOG_DIR}/prompt_{char_key}_{now}.txt"

    try:
        with open(filename, "w", encoding="utf-8") as f:
            f.write(prompt_text)
        print(f"📝 Промт успешно сохранен в файл: {filename}")
    except Exception as e:
        print(f"⚠️ Ошибка при сохранении лога: {e}")


@app.post("/act")
async def generate_action(request: ActionRequest):
    char_key = request.character_key

    # --- ШАГ 1: Загрузка данных ---
    # Загружаем JSON с персонажами и ищем там запрошенный ключ (например, "grommash").
    # Если ключа нет — выбрасываем ошибку 404.
    # Также загружаем глобальный лог событий (event_log.json).
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

    # --- ШАГ 2: Формирование блоков ---

    # Bio Block
    bio_block = (
        f"Роль: {meta.get('role', 'Unknown')}\n"
        f"Имя: {identity.get('name', 'Unknown')}\n"
        f"Биография: {identity.get('bio', '')}"
    )

    # State Block
    hp_curr = stats.get('hp', {}).get('current', '?')
    hp_max = stats.get('hp', {}).get('max', '?')
    mp_curr = stats.get('mp', {}).get('current', '?')
    mp_max = stats.get('mp', {}).get('max', '?')

    # Обработка атрибутов
    attributes_dict = stats.get('attributes', {})
    attributes_list = [f"{k}: {v}" for k, v in attributes_dict.items()]
    attributes_str = ", ".join(attributes_list)

    # Обработка эффектов
    effects_list = stats.get('status_effects', [])
    effects_str = ", ".join(effects_list) if effects_list else "Нет"

    # Сборка строки характеристик
    stats_str = (
        f"Здоровье (HP): {hp_curr}/{hp_max} | Мана (MP): {mp_curr}/{mp_max}\n"
        f"Атрибуты: {attributes_str}\n"
        f"Эффекты: {effects_str}"
    )

    # Обработка инвентаря
    inv_str = "Инвентарь:\n"
    if inventory:
        for item in inventory:
            inv_str += f"- {item.get('name')} ({item.get('quantity')} шт): {item.get('description')}\n"
    else:
        inv_str += "Пусто."

    state_block = f"{stats_str}\n{inv_str}"

    # Memory Block
    global_mem = "\n".join(memory.get("global_chronicle", []))
    private_mem = "\n".join(memory.get("private_notes", []))
    memory_block = f"Глобальные знания:\n{global_mem}\n\nЛичные заметки:\n{private_mem}"

    # Context Block
    # Context Block (История):
    # Проходим циклом по массиву 'history' из event_log.json.
    # Превращаем каждый объект события в строку диалога.
    # Формат: "[Шаг 1] Имя: Действие (Мысли)".
    # Это позволяет нейросети понимать хронологию и контекст беседы.
    context_lines = []
    for event in history:
        step_info = f"[Шаг {event.get('step')}] {event.get('name')}:"
        action_text = f"Действие/Речь: {event.get('action')}"
        thoughts_text = f" (Мысли: {event.get('thoughts')})" if event.get(
            'thoughts') else ""
        context_lines.append(f"{step_info} {action_text}{thoughts_text}")

    context_block = "История событий (Лог):\n" + "\n".join(context_lines)

    goal_block = "Твоя задача — отыгрывать роль своего персонажа, опираясь на его характер, состояние и историю событий."

    format_block = (
        """Твой ответ должен быть простым текстом, разделенным специальными тегами на два блока
        [THOUGHTS] Мысли [THOUGHTS] и [ACTION/SPEECH] Действие / Речь [ACTION/SPEECH]
        Сначала напиши скрытые мысли персонажа, затем то, что он делает и (или) говорит вслух."""
    )

    # --- ШАГ 3: Суммаризация ---
    # Склеиваем все подготовленные блоки (Биография, Состояние, Память, История, Цель)
    # в одну большую строку (final_prompt).
    # Используем разделители (--- ЗАГОЛОВКИ ---), чтобы модели было проще
    # ориентироваться в структуре данных.
    final_prompt = (
        f"--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---\n{bio_block}\n\n"
        f"--- СОСТОЯНИЕ ---\n{state_block}\n\n"
        f"--- ПАМЯТЬ ---\n{memory_block}\n\n"
        f"--- КОНТЕКСТ ИГРЫ ---\n{context_block}\n\n"
        f"--- ЦЕЛЬ ---\n{goal_block}\n\n"
        f"--- ФОРМАТ ОТВЕТА ---\n{format_block}"
    )

    # --- ЛОГИРОВАНИЕ ---
    print(f"Запрос к модели: {meta.get('model_id')}")
    save_prompt_to_log(char_key, final_prompt)

    # --- ШАГ 4: Отправка запроса ---
    # Отправляем запрос через клиент OpenAI.
    # model=meta.get("model_id") — позволяет для каждого персонажа использовать
    # свою модель (указанную в characters.json), или дефолтную, если поле пустое.
    try:
        response = client.chat.completions.create(
            model=meta.get("model_id", "deepseek/deepseek-v3.2"),
            messages=[
                {"role": "system", "content": "Ты — игрок в текстовой ролевой игре."},
                {"role": "user", "content": final_prompt}
            ]
        )

        ai_response = response.choices[0].message.content
        return {"response": ai_response}

    except Exception as e:
        print(f"Error calling API: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        # В случае ошибки API (нет интернета, кончились деньги, неверный ключ)
        # сервер вернет ошибку 500 с описанием проблемы.
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
