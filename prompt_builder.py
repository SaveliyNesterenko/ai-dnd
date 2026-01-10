import json
from utils.logger import save_prompt_to_log

def build_prompt(char, history):
    meta = char.get("meta", {})
    identity = char.get("identity", {})
    stats = char.get("stats", {})
    inventory = char.get("inventory", [])
    memory = char.get("memory", {})

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

    context_lines = [f"[Ход {e.get('step')}] {e.get('name')}: Действие/Речь: {e.get('action')}" for e in history]
    context_block = "История событий (Лог):\n" + "\n".join(context_lines)

    goal_block = "Твоя задача — отыгрывать роль своего персонажа, опираясь на его характер, состояние и историю событий."
    format_block = "Твой ответ должен быть простым текстом, четко разделенным специальными тегами на два блока\n[THOUGHTS] Мысли и [ACTION] Действие / Речь.\nСтрого следуй формату.\nСначала напиши скрытые мысли персонажа, затем то, что он делает и (или) говорит вслух."

    final_prompt = f"""--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---
{bio_block}

--- СОСТОЯНИЕ ---
{state_block}

--- ПАМЯТЬ ---
{memory_block}

--- КОНТЕКСТ ИГРЫ ---
{context_block}

--- ЦЕЛЬ ---
{goal_block}

--- ФОРМАТ ОТВЕТА ---
{format_block}"""

    return final_prompt

def build_observer_prompt(action, dice_roll, characters):
    """
    Формирует промт для "Наблюдателя".
    """
    # Системная инструкция для модели
    instruction_block = """Ты — Процессор Игровой Логики (Game Logic Engine) и эксперт по механикам D&D 5e. Твоя основная задача — технический анализ игровых событий, расчет изменений характеристик персонажей и подготовка данных для обновления системы. Каждый твой ответ должен строго следовать структуре из двух блоков:
[GM BRIEF]
Краткая сводка для ГМ-а: что произошло технически, какие ресурсы потрачены, какие изменения внесены.
[JSON PATCH]
Фрагмент кода в формате JSON, содержащий только обновленные поля персонажей."""

    # Блок с описанием события
    event_block = f"Событие: {action}"
    if dice_roll:
        event_block += f"\nБросок кубика d20: {dice_roll}"

    # Блок с данными персонажей в формате JSON
    characters_json = json.dumps(characters, indent=2, ensure_ascii=False)
    characters_block = f"Текущие данные персонажей:\n{characters_json}"

    # Финальный промт
    final_prompt = f"""{instruction_block}

--- ВХОДНЫЕ ДАННЫЕ ---
{event_block}
{characters_block}
"""
    
    save_prompt_to_log("observer", final_prompt)

    return final_prompt

def create_archivist_prompt(event_summary):
    """
    Формирует промт для "Архивариуса".
    """
    instruction = """Ты — Синтезатор Хроники. Твоя задача — анализировать завершенное игровое событие и превращать объемный лог ходов в краткий, фактологический конспект. Этот конспект станет «внешней памятью» для всех моделей-игроков."""

    final_prompt = f"""{instruction}

--- ЛОГ СОБЫТИЯ ---
{event_summary}

--- ЗАДАЧА ---
Проанализируй лог и напиши краткий конспект произошедшего. Отрази только ключевые факты, решения и их последствия. Не добавляй лишних деталей, художественных описаний или диалогов. Конспект должен быть написан в прошедшем времени от третьего лица.
"""
    return final_prompt

def create_player_recollection_prompt(character, event_history):
    """
    Формирует промт для персонажа-игрока, чтобы он сделал личные заметки.
    """
    char_name = character.get("identity", {}).get("name", "Неизвестный")
    char_bio = character.get("identity", {}).get("bio", "")

    # Формируем персонализированную сводку событий
    event_summary = ""
    for event in event_history:
        actor = event.get("name", "N/A")
        action = event.get("action", "")
        event_step = event.get("step", "N/A")
        
        event_line = f'Ход {event_step}: [{actor}]\n{action}\n'
        
        # Добавляем мысли, если это ход текущего персонажа
        if actor == char_name and "thoughts" in event:
            thoughts = event.get("thoughts", "")
            if thoughts:
                event_line += f'Мои мысли в тот момент: {thoughts}\n'

        event_summary += event_line + "\n"

    # Системная инструкция и задача
    instruction = f'''Ты — {char_name}, {char_bio}. Проанализируй события, которые только что произошли. Вспомни не только действия других, но и свои собственные мысли в ключевые моменты.'''
    
    task = '''Твоя задача — записать свои личные соображения о произошедшем. Сделай краткие, но ёмкие заметки от первого лица в стиле личного дневника. Что ты думаешь о случившемся? Какие у тебя появились планы или опасения? Как ты оцениваешь действия других и свои собственные? Эти записи — только для тебя.'''

    # Собираем финальный промт
    final_prompt = f"""{instruction}

--- ХРОНИКА СОБЫТИЙ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧА ---
{task}"""
    
    return final_prompt
