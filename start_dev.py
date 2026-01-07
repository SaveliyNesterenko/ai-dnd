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
    
    # --- НОВЫЙ, ПРАВИЛЬНЫЙ СПОСОБ ЗАПУСКА ---
    # Мы запускаем Uvicorn напрямую как процесс.
    # Ключевые аргументы:
    # "orchestrator:app" - указывает на объект app в файле orchestrator.py
    # --host, --port - задают адрес и порт
    # --workers 4 - возвращаем к стандартной конфигурации
    print(f"Запускаем основной сервер на {GM_CONSOLE_URL} с 4 воркерами...")
    
    command = [
        sys.executable, "-m", "uvicorn", 
        "orchestrator:app", 
        "--host", ORCHESTRATOR_HOST, 
        "--port", str(ORCHESTRATOR_PORT),
        "--workers", "4"  # <-- ВОЗВРАЩАЕМ ЗНАЧЕНИЕ
    ]
    
    orchestrator_process = subprocess.Popen(command)

    print("Ждем запуск сервера...")
    time.sleep(5) 
    
    print("Открываем GM-консоль и Зрительский экран в браузере...")
    webbrowser.open(GM_CONSOLE_URL, new=1)
    webbrowser.open(SPECTATOR_URL, new=2)

    print("\n--- Среда разработки готова! ---")
    print(f"GM-консоль доступна по адресу: {GM_CONSOLE_URL}")
    print(f"Зрительский экран доступен по адресу: {SPECTATOR_URL}")
    print("Для остановки серверов нажмите Ctrl+C в этом окне.")

    # Ожидаем завершения дочернего процесса
    try:
        orchestrator_process.wait()
    except KeyboardInterrupt:
        print("\n--- Получен сигнал на остановку (Ctrl+C). Завершаем работу. ---")
        orchestrator_process.terminate()
        orchestrator_process.wait()
        print("--- Сервер остановлен. ---")

if __name__ == "__main__":
    main()
