import asyncio
import json
import multiprocessing
import os
import shutil
import shutil as _shutil
import socket
import sys
import threading
import time
import webbrowser

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_user_from_ws_token
from database import Base, SessionLocal, engine
from models import Note, User
from routes.auth_routes import router as auth_router
from routes.user_routes import get_user_output_root, router as user_router

# ------------------------------------------------------------
# WINDOWS ENCODING FIX
# ------------------------------------------------------------
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if sys.stdout:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if sys.stderr:
        try:
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass


def safe_print(msg):
    try:
        print(msg)
    except Exception:
        pass


def add_miktex_to_path():
    if sys.platform != "win32":
        return

    local_app_data = os.getenv("LOCALAPPDATA", "")
    program_files = os.getenv("ProgramFiles", "")
    program_files_x86 = os.getenv("ProgramFiles(x86)", "")
    candidate_dirs = [
        os.path.join(local_app_data, "Programs", "MiKTeX", "miktex", "bin", "x64"),
        os.path.join(program_files, "MiKTeX", "miktex", "bin", "x64"),
        os.path.join(program_files_x86, "MiKTeX", "miktex", "bin", "x64"),
    ]

    for candidate_dir in candidate_dirs:
        if not candidate_dir or not os.path.exists(candidate_dir):
            continue

        current_path = os.environ.get("PATH", "")
        path_parts = current_path.split(os.pathsep) if current_path else []
        if candidate_dir not in path_parts:
            os.environ["PATH"] = candidate_dir + os.pathsep + current_path if current_path else candidate_dir
        break


# ------------------------------------------------------------
# FASTAPI SETUP
# ------------------------------------------------------------
def get_base_dir():
    if getattr(sys, "frozen", False):
        path = os.path.dirname(sys.executable)
        if ".app/Contents/MacOS" in path:
            return os.path.abspath(os.path.join(path, "../../../"))
        return path
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = get_base_dir()
OUTPUT_ROOT = os.path.join(BASE_DIR, "output")
TEMP_UPLOADS = os.path.join(BASE_DIR, "temp_uploads")
ENV_PATH = os.path.join(BASE_DIR, ".env")

load_dotenv(ENV_PATH, override=True)
add_miktex_to_path()
app = FastAPI()


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = BASE_DIR
    return os.path.join(base_path, relative_path)


web_folder = resource_path("web")
os.makedirs(OUTPUT_ROOT, exist_ok=True)

# Reset temp folder on startup.
if os.path.exists(TEMP_UPLOADS):
    try:
        shutil.rmtree(TEMP_UPLOADS)
    except Exception as exc:
        safe_print(f"Warning: Could not clear temp folder at startup: {exc}")
os.makedirs(TEMP_UPLOADS, exist_ok=True)

app.mount("/static", StaticFiles(directory=web_folder), name="static")
app.include_router(auth_router)
app.include_router(user_router)

# Ensure SQLite schema exists.
Base.metadata.create_all(bind=engine)


def get_user_temp_upload_root(user_id: int) -> str:
    path = os.path.join(TEMP_UPLOADS, str(user_id))
    os.makedirs(path, exist_ok=True)
    return path


def safe_user_output_path(user_id: int, folder: str, filename: str) -> str:
    safe_folder = os.path.basename(folder)
    safe_filename = os.path.basename(filename)
    return os.path.join(get_user_output_root(user_id), safe_folder, safe_filename)


def get_user_from_http_context(
    db: Session,
    authorization: str | None,
    token: str | None,
) -> User:
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization.split(" ", 1)[1].strip()
        return get_current_user_from_ws_token(bearer_token, db)

    if token:
        return get_current_user_from_ws_token(token, db)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authentication token")


def save_user_note_record(db: Session, user_id: int, result: dict):
    if not result.get("succeeded"):
        return

    folder = result.get("folder")
    pdf_name = result.get("pdf")
    if not folder or not pdf_name:
        return

    db_note = Note(
        user_id=user_id,
        folder=folder,
        pdf_filename=pdf_name,
        notes_filename=result.get("notes", ""),
        transcript_filename=result.get("transcript", ""),
    )
    db.add(db_note)
    db.commit()


def get_request_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------------------------------------
# ROUTES
# ------------------------------------------------------------
@app.get("/")
async def index():
    return FileResponse(os.path.join(web_folder, "index.html"))


@app.post("/logout")
async def logout(_: User = Depends(get_current_user)):
    # JWT is stateless: frontend removes token locally.
    return {"message": "Logged out"}


@app.get("/view/{folder}/{filename}")
async def view_pdf(
    folder: str,
    filename: str,
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_request_db),
):
    current_user = get_user_from_http_context(db, authorization, token)
    path = safe_user_output_path(current_user.id, folder, filename)
    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", content_disposition_type="inline")
    return JSONResponse(status_code=404, content={"message": "Not found"})


@app.get("/download/{folder}/{filename}")
async def download_file(
    folder: str,
    filename: str,
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_request_db),
):
    current_user = get_user_from_http_context(db, authorization, token)
    path = safe_user_output_path(current_user.id, folder, filename)
    if os.path.exists(path):
        return FileResponse(path, filename=os.path.basename(filename))
    return JSONResponse(status_code=404, content={"message": "Not found"})


@app.get("/notes/{folder}/{filename}")
async def view_notes(
    folder: str,
    filename: str,
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_request_db),
):
    current_user = get_user_from_http_context(db, authorization, token)
    path = safe_user_output_path(current_user.id, folder, filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"message": "Not found"})

    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return JSONResponse(content={"content": content})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"message": f"Failed to read notes: {exc}"})


# ------------------------------------------------------------
# SETTINGS API
# ------------------------------------------------------------
class ApiKeyRequest(BaseModel):
    api_key: str


@app.get("/api/key-status")
async def key_status(_: User = Depends(get_current_user)):
    load_dotenv(override=True)
    return {"is_set": bool(os.getenv("GEMINI_API_KEY"))}


@app.post("/api/key")
async def save_key(req: ApiKeyRequest, _: User = Depends(get_current_user)):
    key = req.api_key.strip()
    
    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

    new_lines = []
    if key == "RESET":
        # Remove the key from .env to fallback to default
        for line in lines:
            if not line.startswith("GEMINI_API_KEY="):
                new_lines.append(line)
        if "GEMINI_API_KEY" in os.environ:
            del os.environ["GEMINI_API_KEY"]
    else:
        if not key:
            raise HTTPException(status_code=400, detail="API key cannot be empty")
            
        found = False
        for line in lines:
            if line.startswith("GEMINI_API_KEY="):
                new_lines.append(f"GEMINI_API_KEY={key}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"GEMINI_API_KEY={key}\n")
        os.environ["GEMINI_API_KEY"] = key

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    return {"message": "API key updated"}


class ThreadConfig(BaseModel):
    threads: int


class SaveNoteRequest(BaseModel):
    folder: str
    pdf: str = ""
    notes: str = ""
    transcript: str = ""
    title: str = ""


class YoutubeUploadRequest(BaseModel):
    url: str


def get_ffmpeg_location() -> str | None:
    """Best-effort ffmpeg location hint for tools like yt-dlp.

    AudioTTo expects ffmpeg binaries to exist in BASE_DIR/bin for source runs.
    """

    bin_dir = os.path.join(BASE_DIR, "bin")
    if not os.path.isdir(bin_dir):
        return None

    ffmpeg_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    ffprobe_name = "ffprobe.exe" if sys.platform == "win32" else "ffprobe"
    if os.path.isfile(os.path.join(bin_dir, ffmpeg_name)) and os.path.isfile(os.path.join(bin_dir, ffprobe_name)):
        return bin_dir
    return None


def download_youtube_audio(url: str, out_dir: str) -> str:
    """Download a single YouTube video's audio and convert to mp3.

    Returns the absolute path to the resulting mp3.
    """

    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Missing dependency yt-dlp. Install it with: pip install yt-dlp ({exc})",
        )

    cleaned = (url or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="YouTube URL cannot be empty")

    # Light validation (still let yt-dlp do the heavy lifting).
    lower = cleaned.lower()
    if "youtube.com" not in lower and "youtu.be" not in lower:
        raise HTTPException(status_code=400, detail="Please provide a valid YouTube link")

    os.makedirs(out_dir, exist_ok=True)

    ffmpeg_location = get_ffmpeg_location()
    has_ffmpeg = bool(ffmpeg_location or _shutil.which("ffmpeg"))
    base_name = f"youtube_{int(time.time())}"
    outtmpl = os.path.join(out_dir, base_name + ".%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    # Only request audio conversion when ffmpeg is available.
    if has_ffmpeg:
        ydl_opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ]
    if ffmpeg_location:
        ydl_opts["ffmpeg_location"] = ffmpeg_location

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(cleaned, download=True)
            prepared = ydl.prepare_filename(info)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"YouTube download failed: {exc}")

    # FFmpegExtractAudio swaps extension to .mp3 with same base name.
    mp3_path = os.path.splitext(prepared)[0] + ".mp3" if has_ffmpeg else prepared
    if not os.path.exists(mp3_path):
        # Fallback: try to find the produced file by base name.
        candidates = [
            os.path.join(out_dir, f)
            for f in os.listdir(out_dir)
            if os.path.isfile(os.path.join(out_dir, f)) and f.startswith(base_name)
        ]
        candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        if candidates:
            mp3_path = candidates[0]

    if not os.path.exists(mp3_path):
        raise HTTPException(status_code=500, detail="YouTube download failed (no audio file produced)")

    try:
        if os.path.getsize(mp3_path) < 1024:
            raise HTTPException(status_code=500, detail="YouTube download produced an empty audio file")
    except HTTPException:
        raise
    except Exception:
        # If size cannot be checked, proceed.
        pass

    return mp3_path


@app.get("/api/info")
async def app_info(_: User = Depends(get_current_user)):
    return {
        "cpu_count": multiprocessing.cpu_count(),
        "saved_threads": int(os.getenv("THREADS", "4")),
    }


@app.post("/api/save-threads")
async def save_threads(cfg: ThreadConfig, _: User = Depends(get_current_user)):
    if cfg.threads < 1:
        raise HTTPException(status_code=400, detail="Threads must be >= 1")

    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

    found = False
    out = []
    for line in lines:
        if line.startswith("THREADS="):
            out.append(f"THREADS={cfg.threads}\n")
            found = True
        else:
            out.append(line)

    if not found:
        out.append(f"THREADS={cfg.threads}\n")

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(out)

    os.environ["THREADS"] = str(cfg.threads)
    return {"message": "Threads saved"}


def get_saved_notes_path(user_id: int) -> str:
    user_root = os.path.join(OUTPUT_ROOT, str(user_id))
    os.makedirs(user_root, exist_ok=True)
    return os.path.join(user_root, "saved_notes.json")


def read_saved_notes(user_id: int) -> list:
    path = get_saved_notes_path(user_id)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


@app.get("/api/saved-notes")
async def list_saved_notes(current_user: User = Depends(get_current_user)):
    notes = read_saved_notes(current_user.id)
    return JSONResponse(content=notes)


@app.post("/api/save-note")
async def save_note(req: SaveNoteRequest, current_user: User = Depends(get_current_user)):
    if not req.folder:
        raise HTTPException(status_code=400, detail="folder is required")

    from datetime import datetime, timezone
    notes = read_saved_notes(current_user.id)

    # Avoid duplicate saves for same folder
    for existing in notes:
        if existing.get("folder") == req.folder:
            return {"message": "Already saved"}

    entry = {
        "folder": req.folder,
        "pdf": req.pdf,
        "notes": req.notes,
        "transcript": req.transcript,
        "title": req.title or req.folder,
        "saved_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
    }
    notes.insert(0, entry)

    path = get_saved_notes_path(current_user.id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

    return {"message": "Note saved"}


@app.delete("/api/saved-notes/{folder}")
async def delete_saved_note(folder: str, current_user: User = Depends(get_current_user)):
    notes = read_saved_notes(current_user.id)
    notes = [n for n in notes if n.get("folder") != folder]
    path = get_saved_notes_path(current_user.id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
    return {"message": "Deleted"}


# ------------------------------------------------------------
# FILE UPLOAD
# ------------------------------------------------------------
@app.post("/upload")
async def upload(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    filename = os.path.basename(file.filename)
    path = os.path.join(get_user_temp_upload_root(current_user.id), filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": filename}


@app.post("/upload/youtube")
async def upload_youtube(req: YoutubeUploadRequest, current_user: User = Depends(get_current_user)):
    user_temp_root = get_user_temp_upload_root(current_user.id)
    mp3_path = download_youtube_audio(req.url, user_temp_root)
    return {"filename": os.path.basename(mp3_path)}


# ------------------------------------------------------------
# WEBSOCKET PROCESS
# ------------------------------------------------------------
@app.websocket("/ws/process")
async def process_ws(ws: WebSocket):
    await ws.accept()

    async def safe_ws_send(message: str):
        try:
            await ws.send_text(message)
        except Exception:
            # Client may have disconnected or socket may already be closing.
            pass

    db = SessionLocal()
    current_user = None
    try:
        token = ws.query_params.get("token")
        try:
            current_user = get_current_user_from_ws_token(token, db)
        except HTTPException:
            await safe_ws_send("PROCESS_FAILED::Unauthorized websocket access")
            await ws.close(code=1008)
            return

        files_to_delete = []
        data = await ws.receive_json()
        audio = data.get("audio_filename")
        video = data.get("video_filename")
        slides = data.get("slides_filename")
        pages = data.get("pages")
        threads = data.get("threads")

        if not audio and not video and not slides:
            await safe_ws_send("❌ No input provided. Upload audio, video, or PDF.")
            return

        if not os.getenv("GEMINI_API_KEY"):
            await safe_ws_send("❌ API key missing")
            return

        user_temp_root = get_user_temp_upload_root(current_user.id)

        source_path = None
        if video:
            source_path = os.path.join(user_temp_root, os.path.basename(video))
        elif audio:
            source_path = os.path.join(user_temp_root, os.path.basename(audio))

        if source_path:
            files_to_delete.append(source_path)

        args = []
        if source_path:
            args.append(source_path)

        if slides:
            slides_path = os.path.join(user_temp_root, os.path.basename(slides))
            args += ["--slides", slides_path]
            files_to_delete.append(slides_path)

        if pages:
            args += ["--pages", pages]
        if threads:
            args += ["--threads", str(threads)]

        args += ["--user-id", str(current_user.id)]

        await safe_ws_send(f"🚀 Processing (threads={threads})")

        loop = asyncio.get_running_loop()
        result = await asyncio.to_thread(run_audiotto, args, loop, ws)

        if result and result.get("succeeded"):
            save_user_note_record(db, current_user.id, result)
            await safe_ws_send("✅ Done")
        else:
            err_msg = "Processing failed. Check terminal logs."
            if result and result.get("error"):
                err_msg = result.get("error")
            await safe_ws_send(f"PROCESS_FAILED::{err_msg}")

        await safe_ws_send("REFRESH_OUTPUTS")

    except WebSocketDisconnect:
        safe_print("[WebSocket] Client disconnected.")
    except Exception as exc:
        await safe_ws_send(f"❌ Error: {exc}")
        safe_print(f"[WebSocket] Exception: {exc}")
    finally:
        if current_user:
            user_temp_root = get_user_temp_upload_root(current_user.id)
            # Remove uploaded files left in this user temp folder.
            for fname in os.listdir(user_temp_root):
                fpath = os.path.join(user_temp_root, fname)
                if os.path.isfile(fpath):
                    try:
                        os.remove(fpath)
                    except Exception:
                        pass
        db.close()
        try:
            await ws.close()
        except Exception:
            pass


def run_audiotto(args, loop, ws):
    import AudioTTo

    def logger(msg):
        async def send():
            try:
                await ws.send_text(msg)
            except Exception:
                pass

        asyncio.run_coroutine_threadsafe(send(), loop)

    AudioTTo.set_logger(logger)
    try:
        return AudioTTo.main(args)
    except Exception as exc:
        logger(f"❌ {exc}")
        return {
            "succeeded": False,
            "error": str(exc),
            "folder": os.path.basename(os.path.splitext(args[0])[0]) if args else "",
            "pdf": "",
            "notes": "",
            "transcript": "",
        }
    finally:
        AudioTTo.set_logger(None)


# ------------------------------------------------------------
# SERVER START
# ------------------------------------------------------------
def start_server():
    global SERVER_PORT

    host = "127.0.0.1"
    preferred_port = int(os.getenv("PORT", "8000"))
    port = preferred_port

    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex((host, port)) != 0:
                break
        port += 1

    if port != preferred_port:
        safe_print(f"Port {preferred_port} is busy, using http://{host}:{port} instead")
    else:
        safe_print(f"AudioTTo server is starting on http://{host}:{port}")

    SERVER_PORT = port

    if not os.getenv("GEMINI_API_KEY"):
        safe_print("Warning: GEMINI_API_KEY is not set yet. Open Settings in the browser UI before processing.")
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        loop="asyncio",
    )


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------
if __name__ == "__main__":
    multiprocessing.freeze_support()
    SERVER_PORT = int(os.getenv("PORT", "8000"))

    if sys.platform == "win32" and getattr(sys, "frozen", False):
        base = sys._MEIPASS
        for file_name in os.listdir(base):
            lower = file_name.lower()
            if lower.startswith("python") and lower.endswith(".dll"):
                os.environ["PYTHONNET_PYDLL"] = os.path.join(base, file_name)
                break

    def open_browser():
        time.sleep(1.5)
        try:
            opened = webbrowser.open(f"http://127.0.0.1:{SERVER_PORT}")
            safe_print("Browser open request sent." if opened else "Browser open request could not be confirmed.")
        except Exception as exc:
            safe_print(f"Warning: Could not open browser automatically: {exc}")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        start_server()
    except KeyboardInterrupt:
        pass
    finally:
        if os.path.exists(TEMP_UPLOADS):
            try:
                shutil.rmtree(TEMP_UPLOADS)
            except Exception:
                pass
