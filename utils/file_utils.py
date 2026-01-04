
import os
import json

def load_json(filepath):
    """
    Безопасная загрузка JSON-файлов.
    """
    abs_path = os.path.abspath(filepath)
    if not os.path.exists(filepath):
        print(f"❌ ОШИБКА: Файл физически не найден по пути: {filepath}")
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ ОШИБКА JSON: Неверный формат файла {filepath}. Детали: {e}")
        return None
    except Exception as e:
        print(f"❌ ОШИБКА: Не удалось открыть файл. Детали: {e}")
        return None

def save_json(filepath, data):
    """
    Безопасное сохранение JSON-файлов.
    """
    abs_path = os.path.abspath(filepath)
    print(f"💾 Сохранение файла: {abs_path}")
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"✅ Файл успешно сохранен.")
        return True
    except Exception as e:
        print(f"❌ ОШИБКА: Не удалось сохранить файл. Детали: {e}")
        return False
