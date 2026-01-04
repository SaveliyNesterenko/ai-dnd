
import os
import datetime

LOG_DIR = "./logs"

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

def save_prompt_to_log(char_key, prompt_text):
    print(f"🗂️  Logging prompt for char_key: {char_key}")
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"{LOG_DIR}/{now}_{char_key}.txt"
    try:
        with open(filename, "w", encoding="utf-8") as f:
            f.write(prompt_text)
        print(f"📝 Промт успешно сохранен в файл: {filename}")
    except Exception as e:
        print(f"⚠️ Ошибка при сохранении лога: {e}")
