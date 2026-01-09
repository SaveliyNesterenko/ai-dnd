
import subprocess
import webbrowser
import sys
import os

def check_and_install_packages(requirements_file):
    with open(requirements_file, 'r') as f:
        packages = [line.strip() for line in f if line.strip()]
    
    missing_packages = []
    for package in packages:
        try:
            # For packages like "TTS", the import name can be different.
            # This is a simplified check.
            if '==' in package:
                package_name = package.split('==')[0]
            elif '>=' in package:
                package_name = package.split('>=')[0]
            else:
                package_name = package
            __import__(package_name)
        except ImportError:
            # TTS has a different import name
            if package_name.lower() == 'tts':
                try:
                    __import__('TTS')
                except ImportError:
                     missing_packages.append(package)
            else:
                missing_packages.append(package)


    if missing_packages:
        print(f"Missing packages: {', '.join(missing_packages)}")
        print("Installing missing packages...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing_packages])
    else:
        print("All packages are already installed.")

def main():
    # Create venv
    if not os.path.exists('venv'):
        print('Creating virtual environment...')
        subprocess.check_call([sys.executable, '-m', 'venv', 'venv'])

    # Activate venv and install packages
    if sys.platform == 'win32':
        venv_activator = os.path.join('venv', 'Scripts', 'activate')
        # On Windows, pip install is slightly different
        pip_executable = os.path.join('venv', 'Scripts', 'pip')
        subprocess.check_call(f'{venv_activator} && {pip_executable} install -r requirements.txt', shell=True)

    else:
        venv_activator = os.path.join('venv', 'bin', 'activate')
        pip_executable = os.path.join('venv', 'bin', 'pip')
        subprocess.check_call(f'source {venv_activator} && {pip_executable} install -r requirements.txt', shell=True, executable='/bin/bash')


    # Run server
    if sys.platform == 'win32':
        uvicorn_executable = os.path.join('venv', 'Scripts', 'uvicorn')
        server_process = subprocess.Popen([uvicorn_executable, "orchestrator:app", "--reload"])
    else:
        uvicorn_executable = os.path.join('venv', 'bin', 'uvicorn')
        server_process = subprocess.Popen([uvicorn_executable, "orchestrator:app", "--reload"])


    # Open browser tabs
    webbrowser.open_new_tab("http://127.0.0.1:8000/gm/console-gm.html")
    webbrowser.open_new_tab("http://127.0.0.1:8000/spectator")

    try:
        server_process.wait()
    except KeyboardInterrupt:
        server_process.terminate()
        server_process.wait()

if __name__ == "__main__":
    main()
