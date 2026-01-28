import json

def handle_response(response_text, event_log_data, character_id, character_name, character_role, new_step_number):
    """
    Анализирует ответ модели, обновляет журнал событий и возвращает обновлённый журнал.

    Аргументы:
        response_text: необработанный текстовый ответ модели.
        event_log_data: текущие данные журнала событий (в виде словаря Python).
        character_id: ID персонажа.
        character_name: имя персонажа, выполняющего действие.
        character_role: роль персонажа.
        new_step_number: номер нового шага.

    Возвращает:
        обновлённые данные журнала событий.
    """
    thoughts = ""
    action = ""

    if "[THOUGHTS]" in response_text and "[ACTION]" in response_text:
        thoughts_start = response_text.find("[THOUGHTS]") + len("[THOUGHTS]")
        action_start = response_text.find("[ACTION]")
        thoughts = response_text[thoughts_start:action_start].strip()
        action = response_text[action_start + len("[ACTION]"):].strip()
    elif "[ACTION]" in response_text:
        action_start = response_text.find("[ACTION]") + len("[ACTION]")
        action = response_text[action_start:].strip()
    else:
        action = response_text.strip()

    if "history" not in event_log_data:
        event_log_data["history"] = []

    new_step = {
        "step": new_step_number,
        "id": character_id, 
        "name": character_name,
        "role": character_role,
        "thoughts": thoughts,
        "action": action
    }

    event_log_data["history"].append(new_step)
    return event_log_data
