import json
from utils.logger import save_prompt_to_log


def build_prompt(char, history, active_characters_data):
    meta = char.get("meta", {})
    identity = char.get("identity", {})
    stats = char.get("stats", {})
    inventory = char.get("inventory", [])
    memory = char.get("memory", {})

    bio_block = f"Роль: {meta.get('role', 'Unknown')}\nИмя: {identity.get('name', 'Unknown')}\nБиография: {identity.get('bio', '')}"
    hp_curr, hp_max = stats.get('hp', {}).get(
        'current', '?'), stats.get('hp', {}).get('max', '?')
    mp_curr, mp_max = stats.get('mp', {}).get(
        'current', '?'), stats.get('mp', {}).get('max', '?')
    attributes_str = ", ".join(
        [f"{k}: {v}" for k, v in stats.get('attributes', {}).items()])
    effects_str = ", ".join(stats.get('status_effects', [])) or "Нет"
    stats_str = f"Здоровье (HP): {hp_curr}/{hp_max} | Мана (MP): {mp_curr}/{mp_max}\nАтрибуты: {attributes_str}\nЭффекты: {effects_str}"

    inv_str = "Инвентарь:\n" + \
        ("\n".join([f"- {item.get('name')} ({item.get('quantity')} шт): {item.get('description')}" for item in inventory])
         if inventory else "Пусто.")
    state_block = f"{stats_str}\n{inv_str}"

    global_mem = "\n".join(memory.get("global_chronicle", []))
    private_mem = "\n".join(memory.get("private_notes", []))
    memory_block = f"Глобальные знания:\n{global_mem}\n\nЛичные заметки:\n{private_mem}"

    # --- Формирование блока "УЧАСТНИКИ СЦЕНЫ" ---
    char_name = identity.get('name', 'Unknown')
    heroes = []
    enemies = []
    neutrals = []

    for active_char in active_characters_data:
        active_char_name = active_char.get("identity", {}).get("name")
        if not active_char_name:
            continue

        display_name = active_char_name
        if active_char_name == char_name:
            display_name += " (Вы)"

        role = active_char.get("meta", {}).get("role", "npc").lower()

        if role == "player":
            heroes.append(display_name)
        elif role == "enemy":
            enemies.append(display_name)
        else:  # npc и другие
            neutrals.append(display_name)

    scene_participants_lines = []
    if heroes:
        scene_participants_lines.append(f"Команда героев: {', '.join(heroes)}")
    if enemies:
        scene_participants_lines.append(
            f"Команда противников: {', '.join(enemies)}")
    if neutrals:
        scene_participants_lines.append(
            f"Нейтральные персонажи: {', '.join(neutrals)}")

    scene_participants_block = ""
    if scene_participants_lines:
        scene_participants_block = "--- УЧАСТНИКИ СЦЕНЫ ---\n" + \
            "\n".join(scene_participants_lines)
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
    Формирует промт для "Наблюдателя" с подробными инструкциями и примером.
    """
    instruction_block = """Ты — Процессор Игровой Логики и эксперт по механикам D&D 5e. Твоя основная задача — технический анализ игровых событий, расчет изменений характеристик персонажей и подготовка данных для обновления системы.

Каждый твой ответ должен строго следовать структуре из двух блоков:

1.  **[GM BRIEF]**
    Краткая, но емкая сводка для ГМ-а: что произошло технически, какие ресурсы потрачены, какие проверки пройдены, каковы эффекты.

2.  **[JSON PATCH]**
    JSON-объект, описывающий изменения в данных персонажей. **Это самый важный блок, соблюдай формат строго.**

    **Правила для [JSON PATCH]:**
    *   Ты можешь изменять **только** поля внутри объектов `stats` и `inventory`.
    *   Ключами верхнего уровня в JSON-объекте должны быть ID персонажей (например, `kael_roan`), которые были затронуты событием.
    *   Для каждого `char_id` в значении должен быть объект, содержащий **только те поля, которые изменились** (`stats` или `inventory`).
    *   Для `stats`: можно изменять `hp`, `mp`, `attributes`, `status_effects`. При изменении `hp` или `mp`, передавай весь объект `{"current": ..., "max": ...}`.
    *   Для `inventory`: это **массив**. Чтобы изменить его, ты должен передать **весь массив целиком** с добавленными, удаленными или измененными предметами.
    *   **ЗАПРЕЩЕНО** изменять другие поля, такие как `meta`, `identity` или `memory`.

    **[ПРИМЕР]**
    Событие: "Силия использует `Аптечку-регенератор` на себе, восстанавливая 4 HP. Затем она передает `Рунический ключ` персонажу `kael_roan`."
    Текущие данные (фрагмент):
    {
        "silia": {
            "stats": { "hp": { "current": 65, "max": 90 } },
            "inventory": [
                { "name": "Рунический ключ", "quantity": 1, ... },
                { "name": "Аптечка-регенератор", "quantity": 1, ... }
            ]
        },
        "kael_roan": {
            "inventory": [
                { "name": "Длинный меч ордена", "quantity": 1, ... }
            ]
        }
    }

    Результат в твоем ответе должен выглядеть так:
    [JSON PATCH]
    {
        "silia": {
            "stats": {
                "hp": { "current": 69, "max": 90 }
            },
            "inventory": [
                { "name": "Аптечка-регенератор", "quantity": 1, ... }
            ]
        },
        "kael_roan": {
            "inventory": [
                { "name": "Длинный меч ордена", "quantity": 1, ... },
                { "name": "Рунический ключ", "quantity": 1, ... }
            ]
        }
    }
    **[/ПРИМЕР]**"""

    event_block = f"Событие для анализа: {action}"
    if dice_roll:
        event_block += f"\nРезультат броска d20: {dice_roll}"

    # Оставляем только нужные для Наблюдателя поля
    observer_chars = {}
    for char_id, char_data in characters.items():
        observer_chars[char_id] = {
            "stats": char_data.get("stats", {}),
            "inventory": char_data.get("inventory", [])
        }

    characters_json = json.dumps(observer_chars, indent=2, ensure_ascii=False)
    characters_block = f"Текущие данные персонажей (только `stats` и `inventory`):\n{characters_json}"

    final_prompt = f"""{instruction_block}

--- ВХОДНЫЕ ДАННЫЕ ---
{event_block}
{characters_block}

--- ТВОЙ ОТВЕТ ---"""

    save_prompt_to_log("observer", final_prompt)
    return final_prompt.strip()


def create_archivist_prompt(event_summary, unique_chronicles):
    """
    Формирует промт для "Архивариуса" с учетом возможных расхождений в хрониках.
    """
    instruction = """Ты — Синтезатор Хроники в рамках кампании по ДНД. Твоя задача — поддерживать единую и актуальную летопись игровых событий."""

    if not unique_chronicles:
        previous_chronicle_block = "--- СУЩЕСТВУЮЩАЯ ХРОНИКА ---\nХроника пока пуста."
        task = "Проанализируй лог и напиши краткий конспект произошедшего, который станет началом глобальной хроники. Отрази только ключевые факты, решения и их последствия для формирования целостной общей картины. Конспект должен быть написан в прошедшем времени от третьего лица. Твой ответ должен содержать только итоговый текст хроники."
    elif len(unique_chronicles) == 1:
        previous_chronicle_block = f"--- СУЩЕСТВУЮЩАЯ ХРОНИКА ---\n{unique_chronicles[0]}"
        instruction += " Проанализируй новые события и обнови существующую хронику, создав единый, целостный текст."
        task = "Перепиши и дополни существующую хронику в свете новых событий. Сохрани стиль и целостность повествования. Отрази только ключевые факты, решения и их последствия для формирования целостной общей картины. Твой ответ должен содержать только итоговый, полный текст обновленной хроники. Не используй никаких тегов или специального форматирования."
    else:  # More than one unique chronicle
        instruction += " У разных участников оказались разные версии хроники. Проанализируй все версии и новые события, чтобы объединить их в единую, непротиворечивую летопись."
        chronicle_versions_str = ""
        for i, chronicle in enumerate(unique_chronicles, 1):
            chronicle_versions_str += f"--- ВЕРСИЯ {i} ---\n{chronicle}\n\n"
        previous_chronicle_block = f"--- СУЩЕСТВУЮЩИЕ ВЕРСИИ ХРОНИКИ ---\n{chronicle_versions_str.strip()}"
        task = "Внимательно изучи все представленные версии хроники и лог новых событий. Создай на их основе единую, общую и непротиворечивую хронику. Устрани расхождения, объединив информацию. Отрази только ключевые факты, решения и их последствия для формирования целостной общей картины. Твой ответ должен содержать только итоговый, полный текст объединенной хроники. Не используй никаких тегов или специального форматирования."

    final_prompt = f"""{instruction}

{previous_chronicle_block}

--- НОВЫЕ СОБЫТИЯ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧА ---
{task}"""
    return final_prompt


def create_player_recollection_prompt(character, event_history):
    """
    Формирует промт для персонажа-игрока, чтобы он сделал личные заметки.
    """
    char_name = character.get("identity", {}).get("name", "Неизвестный")
    char_bio = character.get("identity", {}).get("bio", "")
    previous_notes = character.get("memory", {}).get("private_notes", [])

    previous_notes_str = "\n".join(
        previous_notes) if previous_notes else "Пока что у тебя нет никаких личных заметок."
    previous_notes_block = f"--- ПРЕДЫДУЩИЕ ЗАМЕТКИ ---\n{previous_notes_str}"

    event_summary = ""
    for event in event_history:
        actor = event.get('name', 'N/A')
        action = event.get('action', '')
        event_step = event.get('step', 'N/A')

        event_line = f'Ход {event_step}: [{actor}]\n{action}\n'

        if actor == char_name and "thoughts" in event:
            thoughts = event.get("thoughts", "")
            if thoughts:
                event_line += f'\nМои мысли в тот момент: {thoughts}\n'

        event_summary += event_line + "\n"

    instruction = f'Ты — {char_name}, {char_bio}. Проанализируй события, которые только что произошли. Вспомни не только действия других, но и свои собственные мысли в ключевые моменты.'
    task = 'Твоя задача — обновить и дополнить свои личные заметки в свете новых событий. Перепиши их полностью от первого лица в стиле личного дневника, сохранив важные старые мысли и добавив новые. Личные заметки — это не конспект прошедших событий, а именно твои наблюдения, которые должны в будущем помочь ориентироваться в мире ДНД, взаимодействовать с компаньонами и продвигаться по сюжету. Поэтому важно записывать полезную информацию, которая может пригодиться в будущем. Твой ответ должен содержать только итоговый, полный текст заметок. Не используй никаких тегов или специального форматирования.'

    final_prompt = f"""{instruction}

{previous_notes_block}

--- ХРОНИКА СОБЫТИЙ ДЛЯ АНАЛИЗА ---
{event_summary}
--- ТВОЯ ЗАДАЧА ---
{task}"""

    return final_prompt
