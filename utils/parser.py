import re
from typing import Dict, Optional

def parse_ai_response(text: str) -> Dict[str, Optional[str]]:
    """
    Парсит сырой ответ от AI-модели, извлекая 'thought' и 'action'.

    Args:
        text: Строка ответа от модели, содержащая теги [THOUGHT] и [ACTION].

    Returns:
        Словарь с ключами "thought" и "action". 
        Если какой-то из блоков не найден, его значение будет None.
    """
    thought = None
    action = None

    # Ищем мысль (thought) между [THOUGHT] и [ACTION]
    thought_match = re.search(r"\\[THOUGHT\\](.*?)\\[ACTION\\]", text, re.DOTALL)
    if thought_match:
        thought = thought_match.group(1).strip()

    # Ищем действие (action) после [ACTION]
    action_match = re.search(r"\\[ACTION\\](.*)", text, re.DOTALL)
    if action_match:
        action = action_match.group(1).strip()

    return {"thought": thought, "action": action}
