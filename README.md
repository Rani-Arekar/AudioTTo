# AudioTTo

AudioTTo is a web-based lecture processing app that uploads audio/video/slides, transcribes speech, generates notes, and exports PDF-ready outputs. It includes a FastAPI backend, a browser UI, and support for saving generated notes and history.

## Features

- Upload lecture audio, video, or YouTube links
- Process slides/PDF inputs
- Transcribe speech with Faster-Whisper
- Generate summaries, notes, and related content with Gemini
- View generated notes in the browser
- Download generated PDF and note files
- Save notes and browse history

## Project structure

- `gui_app.py` – FastAPI web app entry point
- `AudioTTo.py` – processing pipeline for transcription and note generation
- `auth.py` – authentication helpers
- `database.py` – database configuration
- `models.py` – database models
- `routes/` – API routers for auth and user-related endpoints
- `web/` – frontend HTML/CSS/JavaScript files
- `output/` – generated output files per user
- `temp_uploads/` – temporary upload storage

## Requirements

Python 3.10+ is recommended.

Install dependencies:

```powershell
cd "C:\Users\DELL\Downloads\AudioTTo-main-main\AudioTTo-main-main"
python -m pip install -r requirements.txt
```

## Environment setup

Create a `.env` file in the project root with at least:

```env
GEMINI_API_KEY=your_google_gemini_api_key
JWT_SECRET_KEY=change-me-in-production
THREADS=4
```

If you want to use the browser UI for settings, the app can also save `GEMINI_API_KEY` and `THREADS` from the Settings page.

## Run the app

From PowerShell:

```powershell
cd "C:\Users\DELL\Downloads\AudioTTo-main-main\AudioTTo-main-main"
python -m uvicorn gui_app:app --host 127.0.0.1 --port 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## Usage

1. Open the web app in your browser.
2. Sign up or log in.
3. Upload your lecture audio/video or enter a YouTube URL.
4. Optionally add slides/PDF input.
5. Start processing.
6. View generated notes and download the produced files.

## Notes

- The app expects a working Gemini API key for note generation.
- On Windows, MiKTeX and ffmpeg may be needed for some export or media workflows.
- Generated outputs are stored under the `output/` directory.
