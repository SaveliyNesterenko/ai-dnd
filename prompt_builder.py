import json
from utils.logger import save_prompt_to_log

def build_prompt(char, history, active_characters_data):
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

    # --- Формирование блока "УЧАСТНИКИ СЦЕНЫ" ---
    char_name = identity.get('name', 'Unknown')
    my_team = []
    npcs = []
    enemies = []

    for active_char in active_characters_data:
        active_char_name = active_char.get("identity", {}).get("name")
        if not active_char_name or active_char_name == char_name:
            continue
        
        role = active_char.get("meta", {}).get("role", "npc").lower()

        if role == "player":
            my_team.append(active_char_name)
        elif role == "npc":
            npcs.append(active_char_name)
        elif role == "enemy":
            enemies.append(active_char_name)

    scene_participants_lines = []
    if my_team:
        scene_participants_lines.append(f"Моя команда: {', '.join(my_team)}")
    if npcs:
        scene_participants_lines.append(f"NPC: {', '.join(npcs)}")
    if enemies:
        scene_participants_lines.append(f"Противники: {', '.join(enemies)}")
    
    scene_participants_block = ""
    if scene_participants_lines:
        scene_participants_block = "--- УЧАСТНИКИ СЦЕНЫ ---\n" + "\n".join(scene_participants_lines)
    # --- Конец блока ---

    # Формируем КОНТЕКСТ ИГРЫ с учетом мыслей персонажа
    context_lines = []
    for e in history:
        actor = e.get('name', 'N/A')
        action = e.get('action', '')
        step = e.get('step', 'N/A')
        
        event_line = f"[Ход {step}] {actor}: {action}"
        
        if actor == char_name and "thoughts" in e:
            thoughts = e.get("thoughts", "")
            if thoughts:
                event_line += f'\nМои мысли в тот момент: {thoughts}'
                
        context_lines.append(event_line)

    context_block = "История событий (Лог):\n" + "\n".join(context_lines)

    goal_block = "Твоя задача — отыгрывать роль своего персонажа в рамках кампании ДНД, опираясь на его характер, состояние и историю событий. Результат твоих действий (попадание, урон, смерть врага) определит GM и кубики после твоего хода."
    format_block = """Твой ответ должен состоять строго из двух блоков в указанном порядке:
[THOUGHTS] Здесь твои внутренние рассуждения, оценка ситуации и формирование плана действий. 
[ACTION] Здесь твои действия описанные от первого лица: прямая речь, движения, применение заклинаний или предметов. Это то, что видят и слышат другие."""

    # Собираем финальный промт, вставляя новый блок
    final_prompt = f"""--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---
{bio_block}

--- СОСТОЯНИЕ ---
{state_block}

--- ПАМЯТЬ ---
{memory_block}
"""

    if scene_participants_block:
        final_prompt += f"\n{scene_participants_block}\n"

    final_prompt += f"""
--- КОНТЕКСТ ИГРЫ ---
{context_block}

--- ЦЕЛЬ ---
{goal_block}

--- ФОРМАТ ОТВЕТА ---
{format_block}"""

    return final_prompt.strip()


def build_observer_prompt(action, dice_roll, characters):
    """
    Формирует промт для "Наблюдателя".
    """
    instruction_block = """Ты — Процессор Игровой Логики (Game Logic Engine) и эксперт по механикам D&D 5e. Твоя основная задача — технический анализ игровых событий, расчет изменений характеристик персонажей и подготовка данных для обновления системы. Каждый твой ответ должен строго следовать структуре из двух блоков:
[GM BRIEF]
Краткая сводка для ГМ-а: что произошло технически, какие ресурсы потрачены, какие изменения внесены.
[JSON PATCH]
Фрагмент кода в формате JSON, содержащий только обновленные поля персонажей."""

    event_block = f"Событие: {action}"
    if dice_roll:
        event_block += f"\nБросок кубика d20: {dice_roll}"

    characters_json = json.dumps(characters, indent=2, ensure_ascii=False)
    characters_block = f"Текущие данные персонажей:\n{characters_json}"

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
    
    previous_notes_str = "\n".join(previous_notes) if previous_notes else "Пока что у тебя нет никаких личных заметок."
    previous_notes_block = f"--- ПРЕДЫДУЩИЕ ЗАМЕТКИ ---\n{previous_notes_str}"

    event_summary = ""
    for event in event_history:
        actor = event.get("name", "N/A")
        action = event.get("action", "")
        event_step = event.get("step", "N/A")
        
        event_line = f'Ход {event_step}: [{actor}]\n{action}\n'
        
        if actor == char_name and "thoughts" in event:
            thoughts = event.get("thoughts", "")
            if thoughts:
                event_line += f'Мои мысли в тот момент: {thoughts}\n'

        event_summary += event_line + "\n"

    instruction = f'Ты — {char_name}, {char_bio}. Проанализируй события, которые только что произошли. Вспомни не только действия других, но и свои собственные мысли в ключевые моменты.'
    task = 'Твоя задача — обновить и дополнить свои личные заметки в свете новых событий. Перепиши их полностью от первого лица в стиле личного дневника, сохранив важные старые мысли и добавив новые. Твой ответ должен содержать только итоговый, полный текст заметок. Не используй никаких тегов или специального форматирования.'

    final_prompt = f"""{instruction}

{previous_notes_block}

--- ХРОНИКА СОБЫТИЙ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧА ---
{task}"""
    
    return final_prompt
