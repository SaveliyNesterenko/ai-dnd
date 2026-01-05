import os
import json
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
from utils.file_utils import load_json, save_json
from prompt_builder import create_archivist_prompt

# Загрузка переменных окружения
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routerai.ru/api/v1")

# Инициализация клиента OpenAI
client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

def archive_current_event():
    """
    Архивирует текущее игровое событие.
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

        # Обновление персонажей
        active_characters_data = load_json("data/active_characters.json")
        active_character_keys = active_characters_data["characters_id"]

        characters = load_json("data/characters.json")
        npcs = load_json("data/npc.json")

        for char_key in active_character_keys:
            # Определяем, в каком словаре находится персонаж
            char_dict = None
            if char_key in characters:
                char_dict = characters
            elif char_key in npcs:
                char_dict = npcs
            
            if char_dict:
                if "memory" not in char_dict[char_key]:
                    char_dict[char_key]["memory"] = {}
                if "global_chronicle" not in char_dict[char_key]["memory"]:
                    char_dict[char_key]["memory"]["global_chronicle"] = ""
                
                # Добавляем конспект в хронику
                char_dict[char_key]["memory"]["global_chronicle"] += f"\n\n---\nСобытие от {datetime.now().strftime('%Y-%m-%d')}:\n{summary}"

        save_json("data/characters.json", characters)
        save_json("data/npc.json", npcs)

        # Логирование
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file_name = f"logs/event_log_{timestamp}.json"
        save_json(log_file_name, event_log)

        # Очистка event_log.json
        event_log["history"] = []
        save_json("data/event_log.json", event_log)

        return {"status": "success", "message": "Событие успешно заархивировано."}

    except Exception as e:
        print(f"Ошибка при архивации события: {e}")
        return {"status": "error", "message": str(e)}
