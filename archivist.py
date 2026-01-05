import os
import json
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
from utils.file_utils import read_file, write_file
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
        event_log_data = read_file("data/event_log.json")
        event_log = json.loads(event_log_data)

        if not event_log.get("history"):
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
        active_characters_data = read_file("data/active_characters.json")
        active_character_keys = json.loads(active_characters_data)["characters_id"]

        characters_data = read_file("data/characters.json")
        characters = json.loads(characters_data)
        npcs_data = read_file("data/npc.json")
        npcs = json.loads(npcs_data)

        for char_key in active_character_keys:
            if char_key in characters:
                if "global_chronicle" not in characters[char_key]:
                    characters[char_key]["global_chronicle"] = ""
                characters[char_key]["global_chronicle"] += f"\n\n---\nСобытие от {datetime.now().strftime('%Y-%m-%d')}:\n{summary}"
            elif char_key in npcs:
                if "global_chronicle" not in npcs[char_key]:
                    npcs[char_key]["global_chronicle"] = ""
                npcs[char_key]["global_chronicle"] += f"\n\n---\nСобытие от {datetime.now().strftime('%Y-%m-%d')}:\n{summary}"

        write_file("data/characters.json", json.dumps(characters, indent=4, ensure_ascii=False))
        write_file("data/npc.json", json.dumps(npcs, indent=4, ensure_ascii=False))

        # Логирование
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file_name = f"logs/event_log_{timestamp}.json"
        write_file(log_file_name, json.dumps(event_log, indent=4, ensure_ascii=False))

        # Очистка event_log.json
        event_log["history"] = []
        write_file("data/event_log.json", json.dumps(event_log, indent=4, ensure_ascii=False))

        return {"status": "success", "message": "Событие успешно заархивировано."}

    except Exception as e:
        print(f"Ошибка при архивации события: {e}")
        return {"status": "error", "message": str(e)}
