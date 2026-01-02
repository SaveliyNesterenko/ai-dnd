
import subprocess
import webbrowser
import time
import os
import sys

# --- Configuration ---
BACKEND_COMMAND = ["uvicorn", "orchestrator:app", "--host", "127.0.0.1", "--port", "8000"]
FRONTEND_COMMAND = ["python", "-m", "http.server", "8080"]
FRONTEND_DIR = os.path.join("frontend", "gm-console")
BROWSER_URL = "http://localhost:8080/console-gm.html"

# --- Main Execution ---
backend_process = None
frontend_process = None

try:
    print("🚀 Starting backend server...")
    # Use CREATE_NO_WINDOW flag on Windows to avoid opening new console windows
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW

    backend_process = subprocess.Popen(BACKEND_COMMAND, creationflags=creationflags)
    print(f"✅ Backend server started with PID: {backend_process.pid}")

    print("\n🚀 Starting frontend server...")
    # Change the current working directory for the frontend server
    frontend_process = subprocess.Popen(
        FRONTEND_COMMAND,
        cwd=FRONTEND_DIR,
        creationflags=creationflags
    )
    print(f"✅ Frontend server started in '{FRONTEND_DIR}' with PID: {frontend_process.pid}")

    # Give servers a moment to initialize
    print("\n⏳ Waiting for servers to be ready...")
    time.sleep(3)

    print(f"\n🌐 Opening browser at: {BROWSER_URL}")
    webbrowser.open(BROWSER_URL)

    print("\n✨ All systems go! Press Ctrl+C to shut down all services.")

    # Keep the main script alive, waiting for user interruption
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    print("\n🛑 Shutting down services...")

finally:
    if frontend_process and frontend_process.poll() is None:
        print("   - Terminating frontend server...")
        frontend_process.terminate()
        frontend_process.wait()
    if backend_process and backend_process.poll() is None:
        print("   - Terminating backend server...")
        backend_process.terminate()
        backend_process.wait()
    print("✅ All services stopped. Goodbye!")

