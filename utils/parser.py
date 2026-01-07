import re
from typing import Dict, Optional

def parse_ai_response(text: str) -> Dict[str, Optional[str]]:
    """
    Парсит сырой ответ от AI-модели, извлекая 'thought' и 'action'.

    Args:
        text: Строка ответа от модели, содержащая теги [THOUGHTS] и [ACTION].

    Returns:
        Словарь с ключами "thought" и "action". 
        Если какой-то из блоков не найден, его значение будет None.
    """
    thought = None
    action = None

    # ИСПРАВЛЕНО: Регулярное выражение теперь ищет [THOUGHTS]
    thought_match = re.search(r"\[THOUGHTS\](.*?)\[ACTION\]", text, re.DOTALL)
    if thought_match:
        thought = thought_match.group(1).strip()

    action_match = re.search(r"\[ACTION\](.*)", text, re.DOTALL)
    if action_match:
        action = action_match.group(1).strip()
    # Если [ACTION] не найден, но есть текст, считаем весь текст действием
    elif not thought_match and text:
        action = text.strip()


    return {"thought": thought, "action": action}
