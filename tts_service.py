
import os
from TTS.api import TTS
import torch

class TTSService:
    def __init__(self):
        # Настройка устройства (GPU, если доступно)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.speaker_wav_path = None
        self.language = "ru"

        try:
            # Инициализация модели XTTS v2
            self.model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(self.device)
            print("TTS model loaded successfully.")
        except Exception as e:
            print(f"Error loading TTS model: {e}")

    def synthesize(self, text, output_filename="output.wav"):
        if not self.model:
            print("TTS model is not loaded. Cannot synthesize.")
            return

        try:
            # Путь для сохранения сгенерированного аудио
            output_path = os.path.join("assets/audio/generated", output_filename)

            # Синтез речи
            self.model.tts_to_file(
                text=text,
                speaker_wav=self.speaker_wav_path,
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
    # Укажите путь к аудиофайлу-образцу голоса
    # Этот файл должен существовать
    speaker_sample_path = "assets/voices/sample.wav" # ЗАМЕНИТЕ НА ВАШ ФАЙЛ

    if not os.path.exists(speaker_sample_path):
        print(f"Error: Speaker sample file not found at {speaker_sample_path}")
        print("Please create a sample.wav file in assets/voices/ folder.")
    else:
        # Создаем экземпляр сервиса
        tts_service = TTSService()
        tts_service.speaker_wav_path = speaker_sample_path
        
        # Текст для синтеза
        text_to_synthesize = "Привет, мир! Это тест синтеза речи с помощью XTTS v2."
        
        # Синтезируем речь
        tts_service.synthesize(text_to_synthesize, "test_output.wav")
