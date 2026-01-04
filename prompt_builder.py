
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

    context_lines = [f"[Шаг {e.get('step')}] {e.get('name')}: Действие/Речь: {e.get('action')}" for e in history]
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
