import os
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import APIRouter, HTTPException

from utils.file_utils import load_json, save_json
from utils.logger import save_prompt_to_log
from prompt_builder import create_archivist_prompt, create_player_recollection_prompt

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

        event_summary = ""
        for event in event_log["history"]:
            event_summary += f'Ход {event["step"]}: [{event["name"]}]\n{event["action"]}\n\n'

        characters = load_json("data/characters.json") or {}
        active_characters_data = load_json("data/active_characters.json")
        active_character_keys = active_characters_data.get("characters_id", [])
        
        # Получаем предыдущую хронику от первого активного персонажа (она у всех одинаковая)
        previous_chronicle = []
        if active_character_keys:
            first_char_key = active_character_keys[0]
            if first_char_key in characters:
                previous_chronicle = characters[first_char_key].get("memory", {}).get("global_chronicle", [])

        prompt = create_archivist_prompt(event_summary, previous_chronicle)
        save_prompt_to_log("archivist", prompt)

        response = client.chat.completions.create(
            model="google/gemini-2.5-flash-lite",
            messages=[
                {"role": "system", "content": "Ты — Синтезатор Хроники."},
                {"role": "user", "content": prompt}
            ]
        )
        new_chronicle = response.choices[0].message.content.strip()

        # Обновляем хронику для всех активных персонажей
        for char_key in active_character_keys:
            if char_key in characters:
                char = characters[char_key]
                if "memory" not in char: 
                    char["memory"] = {}
                # Полностью заменяем хронику новым содержанием
                char["memory"]["global_chronicle"] = [new_chronicle]

        save_json("data/characters.json", characters)

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file_name = f"logs/event_log_{timestamp}.json"
        save_json(log_file_name, event_log)

        event_log["history"] = []
        save_json("data/event_log.json", event_log)

        return {"status": "success", "message": "Событие успешно заархивировано, глобальная хроника обновлена."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compress_context", tags=["Archivist"])
async def handle_compress_context():
    """
    Сжимает историю событий, заменяя старые записи (все, кроме последних 10)
    одним конспектом.
    """
    try:
        event_log = load_json("data/event_log.json")
        history = event_log.get("history", [])

        if len(history) <= 10:
            return {"status": "skipped", "message": "Недостаточно событий для сжатия (нужно больше 10)."}

        history_to_compress = history[:-10]
        recent_history = history[-10:]

        event_summary = ""
        for event in history_to_compress:
            step = event.get("step", "N/A")
            name = event.get("name", "Game Master")
            action = event.get("action", "")
            event_summary += f'Ход {step}: [{name}]\n{action}\n\n'
        # Для сжатия контекста нам не нужна предыдущая хроника, поэтому передаем пустой список
        prompt = create_archivist_prompt(event_summary, [])
        save_prompt_to_log("context_compressor", prompt)

        response = client.chat.completions.create(
            model="google/gemini-2.5-flash-lite",
            messages=[
                {"role": "system", "content": "Ты — Синтезатор Хроники. Твоя задача - сделать краткий конспект событий."},
                {"role": "user", "content": prompt}
            ]
        )
        summary = response.choices[0].message.content

        first_step = history_to_compress[0].get('step')
        last_step = history_to_compress[-1].get('step')
        
        if isinstance(first_step, str) and '-' in first_step:
            first_step = first_step.split('-')[0]

        compressed_step_label = f"{first_step}-{last_step}"

        compressed_event = {
            "step": compressed_step_label,
            "name": "Game Master",
            "action": summary
        }

        new_history = [compressed_event] + recent_history
        event_log["history"] = new_history
        save_json("data/event_log.json", event_log)

        return {"status": "success", "message": f"История событий с шага {first_step} по {last_step} была сжата."}

    except Exception as e:
        print(f"Ошибка при сжатии контекста: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate_player_notes", tags=["Archivist"])
async def handle_player_recollection():
    """
    Создает персональные заметки для каждого игрока на основе последних событий.
    """
    try:
        event_log = load_json("data/event_log.json")
        history = event_log.get("history")

        if not history:
            return {"status": "success", "message": "Нет событий для создания заметок."}

        active_characters_data = load_json("data/active_characters.json")
        active_character_keys = active_characters_data.get("characters_id", [])
        characters = load_json("data/characters.json") or {}

        updated_character_names = []

        for char_key in active_character_keys:
            if char_key in characters and characters[char_key].get("meta", {}).get("role") == "Player":
                char_data = characters[char_key]
                
                prompt = create_player_recollection_prompt(char_data, history)
                save_prompt_to_log(f"recollection_{char_key}", prompt)
                
                response = client.chat.completions.create(
                    model=char_data.get("meta", {}).get("model_id", "google/gemini-2.5-flash-lite"),
                    messages=[
                        {"role": "system", "content": "Ты — Актёр, исполняющий роль своего персонажа. Твоя задача — вести личный дневник от его лица."},
                        {"role": "user", "content": prompt}
                    ]
                )
                new_note = response.choices[0].message.content.strip()

                # Создаем структуру, если она отсутствует
                if "memory" not in char_data:
                    char_data["memory"] = {}
                
                # Полностью заменяем заметки новым содержанием
                char_data["memory"]["private_notes"] = [new_note]

                updated_character_names.append(char_data.get("identity", {}).get("name", char_key))

        save_json("data/characters.json", characters)

        return {"status": "success", "message": "Заметки успешно сгенерированы и обновлены.", "notes_generated_for": updated_character_names}

    except Exception as e:
        print(f"Ошибка при генерации заметок игрока: {e}")
        raise HTTPException(status_code=500, detail=str(e))
