import subprocess
import webbrowser
import time
import sys
import os

# --- Конфигурация ---
VENV_DIR = ".venv"
ORCHESTRATOR_HOST = "127.0.0.1"
ORCHESTRATOR_PORT = 8000

# URL-адреса для открытия
GM_CONSOLE_URL = f"http://{ORCHESTRATOR_HOST}:{ORCHESTRATOR_PORT}"
SPECTATOR_URL = f"http://{ORCHESTRATOR_HOST}:{ORCHESTRATOR_PORT}/spectator"

def get_python_executable():
    """
    Определяет или создает виртуальное окружение и возвращает путь к Python.
    """
    # Путь к исполняемому файлу Python в зависимости от ОС
    if sys.platform == "win32":
        python_path = os.path.join(VENV_DIR, "Scripts", "python.exe")
    else:  # linux, darwin
        python_path = os.path.join(VENV_DIR, "bin", "python")

    # Если venv есть, просто возвращаем путь
    if os.path.exists(python_path):
        print(f"Используется существующее виртуальное окружение: {python_path}")
        return python_path

    # Если venv нет, создаем его
    print(f"Виртуальное окружение в '{VENV_DIR}' не найдено. Создаем новое...")
    try:
        # Используем системный python для создания venv
        subprocess.check_call([sys.executable, "-m", "venv", VENV_DIR])
        print("Виртуальное окружение успешно создано.")
        return python_path
    except subprocess.CalledProcessError as e:
        print(f"ОШИБКА: Не удалось создать виртуальное окружение. {e}")
        print("Пожалуйста, создайте его вручную: python -m venv .venv")
        print("Продолжение с системным Python...")
        return sys.executable


def main():
    """
    Автоматически настраивает и запускает среду разработки.
    1. Находит или создает виртуальное окружение.
    2. Устанавливает зависимости из requirements.txt.
    3. Запускает сервер FastAPI.
    4. Открывает фронтенд-панели в браузере.
    """
    print("--- Запуск и настройка среды разработки ---")

    python_executable = get_python_executable()

    # --- Установка зависимостей ---
    pip_install_command = [
        python_executable, "-m", "pip", "install", "-r", "requirements.txt"
    ]
    print("\n--- Проверка и установка зависимостей ---")
    try:
        # Запускаем pip с выводом, чтобы пользователь видел процесс
        subprocess.check_call(pip_install_command)
        print("--- Зависимости успешно установлены ---")
    except subprocess.CalledProcessError:
        print("\nОШИБКА: Не удалось установить зависимости из requirements.txt.")
        print("Попробуйте запустить команду вручную:")
        print(f"'{' '.join(pip_install_command)}'")
        sys.exit(1) # Выходим, так как без зависимостей сервер не запустится


    # --- Запуск сервера ---
    print(f"\nЗапускаем основной сервер на {GM_CONSOLE_URL} с 4 воркерами...")
    
    server_command = [
        python_executable, "-m", "uvicorn",
        "orchestrator:app",
        "--host", ORCHESTRATOR_HOST,
        "--port", str(ORCHESTRATOR_PORT),
        "--workers", "4"
    ]
    
    orchestrator_process = subprocess.Popen(server_command)

    # --- Открытие браузера ---
    print("\nЖдем запуск сервера (5 секунд)...")
    time.sleep(5)

    print("Открываем GM-консоль и Зрительский экран в браузере...")
    try:
        webbrowser.open(GM_CONSOLE_URL)
        webbrowser.open(SPECTATOR_URL, new=2)  # Открыть в новой вкладке
    except Exception as e:
        print(f"Не удалось автоматически открыть браузер: {e}")
        print("Пожалуйста, откройте вручную:")
        print(f"  - GM Console: {GM_CONSOLE_URL}")
        print(f"  - Spectator View: {SPECTATOR_URL}")

    # --- Завершение ---
    print("\n--- Среда разработки запущена ---")
    print("Сервер работает в фоновом режиме.")
    print("Для остановки сервера нажмите Ctrl+C в этом терминале.")

    try:
        orchestrator_process.wait()
    except KeyboardInterrupt:
        print("\n\n--- Остановка сервера ---")
        orchestrator_process.terminate()
        orchestrator_process.wait()
        print("Сервер остановлен.")


if __name__ == "__main__":
    main()