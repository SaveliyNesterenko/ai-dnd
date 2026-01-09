
import os
from TTS.api import TTS
import torch

class TTSService:
    def __init__(self):
        # Настройка устройства (GPU, если доступно)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        # Изначально не задаем speaker_wav_path и language
        # self.speaker_wav_path = None
        # self.language = None
        self.language = "ru"

        try:
            # Инициализация модели XTTS v2
            self.model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(self.device)
            print("TTS model loaded successfully.")
        except Exception as e:
            print(f"Error loading TTS model: {e}")

    def synthesize(self, text, speaker_wav_path, output_filename="output.wav"):
        if not self.model:
            print("TTS model is not loaded. Cannot synthesize.")
            return None

        if not os.path.exists(speaker_wav_path):
            print(f"Error: Speaker sample file not found at {speaker_wav_path}")
            return None

        try:
            # Директория для сохранения
            output_dir = "assets/audio/generated"
            
            # --- ВОТ ИЗМЕНЕНИЕ ---
            # Убедимся, что директория существует, перед сохранением
            os.makedirs(output_dir, exist_ok=True)
            
            # Полный путь к файлу
            output_path = os.path.join(output_dir, output_filename)

            # Синтез речи
            self.model.tts_to_file(
                text=text,
                speaker_wav=speaker_wav_path,
                language=self.language,
                file_path=output_path
            )
            print(f"Audio synthesized and saved to {output_path}")
            return output_path
        except Exception as e:
            print(f"Error during audio synthesis: {e}")
            return None

# Пример использования (для тестирования)
if __name__ == '__main__':
    # Путь к аудиофайлу-образцу голоса
    speaker_sample_path = "assets/voices/sample.wav"

    if not os.path.exists(speaker_sample_path):
        print(f"CRITICAL: Speaker sample file not found at '{speaker_sample_path}'")
        print("Please create a 'sample.wav' file in 'assets/voices/' folder to run the test.")
    else:
        # Создаем экземпляр сервиса
        tts_service = TTSService()
        
        # Текст для синтеза
        text_to_synthesize = "Привет, мир! Это тест синтеза речи с помощью XTTS v2."
        
        # Синтезируем речь, передавая все параметры в метод
        tts_service.synthesize(
            text=text_to_synthesize, 
            speaker_wav_path=speaker_sample_path, 
            output_filename="test_output.wav"
        )
