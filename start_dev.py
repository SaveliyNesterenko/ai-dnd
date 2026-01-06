import subprocess
import webbrowser
import time
import sys

# --- Конфигурация ---
ORCHESTRATOR_HOST = "127.0.0.1"
ORCHESTRATOR_PORT = 8000

# URL-адреса для открытия
GM_CONSOLE_URL = f"http://{ORCHESTRATOR_HOST}:{ORCHESTRATOR_PORT}"
SPECTATOR_URL = f"http://{ORCHESTRATOR_HOST}:{ORCHESTRATOR_PORT}/spectator"

def main():
    """
    Запускает сервер FastAPI и открывает фронтенд-панели в браузере.
    """
    print("--- Запуск среды разработки ---")

    # Запуск основного сервера (orchestrator.py)
    print(f"Запускаем основной сервер на {GM_CONSOLE_URL}...")
    # Используем sys.executable для гарантии запуска с тем же Python, что и у start_dev.py
    orchestrator_process = subprocess.Popen([sys.executable, "orchestrator.py"])

    # Небольшая задержка, чтобы сервер успел запуститься
    print("Ждем запуск сервера...")
    time.sleep(3)

    # Открытие панелей в браузере
    print("Открываем GM-консоль и Зрительский экран в браузере...")
    webbrowser.open(GM_CONSOLE_URL, new=1)       # new=1: новая вкладка
    webbrowser.open(SPECTATOR_URL, new=2)      # new=2: новое окно (или вкладка)

    print("--- Среда разработки готова! ---")
    print("GM-консоль доступна по адресу:", GM_CONSOLE_URL)
    print("Зрительский экран доступен по адресу:", SPECTATOR_URL)
    print("Для остановки серверов нажмите Ctrl+C в этом окне.")

    try:
        # Ожидаем завершения дочернего процесса
        orchestrator_process.wait()
    except KeyboardInterrupt:
        # Обработка Ctrl+C для корректного завершения
        print("\n--- Завершение работы ---")
        orchestrator_process.terminate() # или .kill()
        print("Сервер остановлен.")

if __name__ == "__main__":
    main()
