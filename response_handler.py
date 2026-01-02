import json

def handle_response(response_text, event_log_data, character_name):
    """
    Parses the model's response, updates the event log, and returns the updated log.

    Args:
        response_text: The raw text response from the model.
        event_log_data: The current event log data (as a Python dictionary).
        character_name: The name of the character performing the action.

    Returns:
        The updated event log data.
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

    new_step_number = len(event_log_data["history"]) + 1

    new_step = {
        "step": new_step_number,
        "name": character_name,
        "thoughts": thoughts,
        "action": action
    }

    event_log_data["history"].append(new_step)
    return event_log_data
