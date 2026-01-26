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

def create_archivist_prompt(event_summary, unique_chronicles):
    """
    Формирует промт для "Архивариуса" с учетом возможных расхождений в хрониках.
    """
    instruction = """Ты — Синтезатор Хроники. Твоя задача — поддерживать единую и актуальную летопись игровых событий."""

    if not unique_chronicles:
        previous_chronicle_block = "--- СУЩЕСТВУЮЩАЯ ХРОНИКА ---\nХроника пока пуста."
        task = "Проанализируй лог и напиши краткий конспект произошедшего, который станет началом глобальной хроники. Отрази только ключевые факты, решения и их последствия. Конспект должен быть написан в прошедшем времени от третьего лица. Твой ответ должен содержать только итоговый текст хроники."
    elif len(unique_chronicles) == 1:
        previous_chronicle_block = f"--- СУЩЕСТВУЮЩАЯ ХРОНИКА ---\n{unique_chronicles[0]}"
        instruction += " Проанализируй новые события и обнови существующую хронику, создав единый, целостный текст."
        task = "Твоя задача — переписать и дополнить существующую хронику в свете новых событий. Сохрани стиль и целостность повествования. Твой ответ должен содержать только итоговый, полный текст обновленной хроники. Не используй никаких тегов или специального форматирования."
    else: # More than one unique chronicle
        instruction += " У разных участников оказались разные версии хроники. Проанализируй все версии и новые события, чтобы объединить их в единую, непротиворечивую летопись."
        chronicle_versions_str = ""
        for i, chronicle in enumerate(unique_chronicles, 1):
            chronicle_versions_str += f"--- ВЕРСИЯ {i} ---\n{chronicle}\n\n"
        previous_chronicle_block = f"--- СУЩЕСТВУЮЩИЕ ВЕРСИИ ХРОНИКИ ---\n{chronicle_versions_str.strip()}"
        task = "Твоя задача — внимательно изучить все представленные версии хроники и лог новых событий. Создай на их основе единую, общую и непротиворечивую хронику. Устрани расхождения, объединив информацию. Твой ответ должен содержать только итоговый, полный текст объединенной хроники. Не используй никаких тегов или специального форматирования."

    final_prompt = f"""{instruction}

{previous_chronicle_block}

--- НОВЫЕ СОБЫТИЯ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧA ---
{task}"""
    return final_prompt

def create_player_recollection_prompt(character, event_history):
    """
    Формирует промт для персонажа-игрока, чтобы он сделал личные заметки.
    """
    char_name = character.get("identity", {}).get("name", "Неизвестный")
    char_bio = character.get("identity", {}).get("bio", "")
    previous_notes = character.get("memory", {}).get("private_notes", [])
    
    # Форматируем предыдущие заметки
    previous_notes_str = "\n".join(previous_notes) if previous_notes else "Пока что у тебя нет никаких личных заметок."
    previous_notes_block = f"--- ПРЕДЫДУЩИЕ ЗАМЕТКИ ---\n{previous_notes_str}"

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
    instruction = f'Ты — {char_name}, {char_bio}. Проанализируй события, которые только что произошли. Вспомни не только действия других, но и свои собственные мысли в ключевые моменты.'
    
    task = 'Твоя задача — обновить и дополнить свои личные заметки в свете новых событий. Перепиши их полностью от первого лица в стиле личного дневника, сохранив важные старые мысли и добавив новые. Твой ответ должен содержать только итоговый, полный текст заметок. Не используй никаких тегов или специального форматирования.'

    # Собираем финальный промт
    final_prompt = f"""{instruction}

{previous_notes_block}

--- ХРОНИКА СОБЫТИЙ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧА ---
{task}"""
    
    return final_prompt
