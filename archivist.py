import os
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import APIRouter, HTTPException

from utils.file_utils import load_json, save_json
from prompt_builder import create_archivist_prompt

# Инициализация роутера
router = APIRouter()

# Загрузка переменных окружения и инициализация клиента OpenAI
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")

client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

@router.post("/archive_event", tags=["Archivist"])
async def handle_archive_event():
    """
    Архивирует текущее игровое событие, обновляя хронику только для персонажей (не NPC).
    """
    try:
        event_log = load_json("data/event_log.json")

        if not event_log or not event_log.get("history"):
            return {"status": "success", "message": "Нет событий для архивации."}

        # Подготовка данных для промта
        event_summary = ""
        for event in event_log["history"]:
            event_summary += f'Ход {event["step"]}: [{event["name"]}]\n{event["action"]}\n\n'

        # Формирование промта
        prompt = create_archivist_prompt(event_summary)

        # Вызов API языковой модели
        response = client.chat.completions.create(
            model="deepseek/deepseek-v3.2",
            messages=[
                {"role": "system", "content": "Ты — Синтезатор Хроники."},
                {"role": "user", "content": prompt}
            ]
        )
        summary = response.choices[0].message.content

        # Обновление персонажей из characters.json
        active_characters_data = load_json("data/active_characters.json")
        active_character_keys = active_characters_data.get("characters_id", [])

        characters = load_json("data/characters.json")
        if not characters:
            characters = {}

        formatted_summary = f"Событие от {datetime.now().strftime('%Y-%m-%d')}:\n{summary}"

        for char_key in active_character_keys:
            if char_key in characters:
                char = characters[char_key]
                if "memory" not in char: char["memory"] = {}
                if "global_chronicle" not in char["memory"]: char["memory"]["global_chronicle"] = []

                if isinstance(char["memory"]["global_chronicle"], list):
                    char["memory"]["global_chronicle"].append(formatted_summary)
                else:
                    old_data = char["memory"]["global_chronicle"]
                    char["memory"]["global_chronicle"] = [old_data, formatted_summary]

        save_json("data/characters.json", characters)

        # Логирование
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file_name = f"logs/event_log_{timestamp}.json"
        save_json(log_file_name, event_log)

        # Очистка event_log.json
        event_log["history"] = []
        save_json("data/event_log.json", event_log)

        return {"status": "success", "message": "Событие успешно заархивировано. Хроника персонажей обновлена."}

    except Exception as e:
        print(f"Ошибка при архивации события: {e}")
        raise HTTPException(status_code=500, detail=str(e))
