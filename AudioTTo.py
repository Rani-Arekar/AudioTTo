import os
import sys
import subprocess
import argparse
import json
import re
import shutil
import textwrap
from faster_whisper import WhisperModel
import google.genai as genai
from google.genai import types
import multiprocessing
import warnings
import time
from datetime import datetime
from typing import List
from dotenv import load_dotenv
import threading
from tqdm import tqdm
import fitz 

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------------- CONFIG ----------------
MODEL_SIZE = "tiny"
COMPUTE_TYPE = "int8"
LANGUAGE = None  
N_THREADS = 4
load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
model_name = "gemini-3.1-flash-lite-preview"
whisper_model = None


# --- FIX WINDOWS ENCODING ---
def safe_print(text):
    try:
        print(text)
    except UnicodeEncodeError:
        try:
            sys.stdout.buffer.write((str(text) + "\n").encode("utf-8", errors="replace"))
            sys.stdout.flush()
        except Exception:
            pass
    except Exception:
        pass

# --- PATH CONFIGURATION ---
def get_base_dir():
    """Restituisce la cartella dell'eseguibile o dello script, gestendo i bundle .app di macOS."""
    if getattr(sys, 'frozen', False):
        path = os.path.dirname(sys.executable)
        if ".app/Contents/MacOS" in path:
            return os.path.abspath(os.path.join(path, "../../../"))
        return path
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()

def resource_path(relative_path):
    """ Get the absolute path of the resource, working both in Dev and EXE (PyInstaller) """
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(BASE_DIR, relative_path)

# Carica .env usando il percorso assoluto
load_dotenv(os.path.join(BASE_DIR, ".env"))


# Logger Setup
logger_callback = None

def set_logger(callback):
    global logger_callback
    logger_callback = callback

def log(*args, **kwargs):
    """ Log a message to the console or to the logger callback, usefull for user interactions """
    msg = " ".join(map(str, args))
    if logger_callback:
        logger_callback(msg)
    else:
        safe_print(msg)

class ProgressLogger:
    """ Custom logger for progress output """
    def write(self, buf):
        if buf.strip():
            if logger_callback:
                logger_callback(buf)
            else:
                sys.stderr.write(buf)
                sys.stderr.flush()
    def flush(self):
        if not logger_callback:
            sys.stderr.flush()

warnings.filterwarnings("ignore", category=UserWarning, module='ctranslate2')


def build_safety_settings():
    return [
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
    ]


def sanitize_error_text(message: str) -> str:
    if not message:
        return ""

    # Mask explicit API key patterns.
    masked = re.sub(r"AIza[0-9A-Za-z\-_]{20,}", "AIza***REDACTED***", message)

    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        masked = masked.replace(api_key, "***REDACTED***")

    return masked


def get_gemini_model_name() -> str:
    # Allow overriding the default model via .env without requiring code changes.
    return os.getenv("GEMINI_MODEL") or model_name


def is_transient_gemini_error(err_text: str) -> bool:
    if not err_text:
        return False

    lowered = err_text.lower()
    return any(
        token in lowered
        for token in (
            "503",
            "unavailable",
            "429",
            "resource_exhausted",
            "rate",
            "timeout",
            "temporar",
            "deadline exceeded",
            "connection reset",
        )
    )


def gemini_generate_with_retries(
    client: genai.Client,
    *,
    contents,
    config,
    attempts: int = 4,
    base_delay_seconds: float = 1.0,
):
    last_exc: Exception | None = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return client.models.generate_content(
                model=get_gemini_model_name(),
                contents=contents,
                config=config,
            )
        except Exception as exc:
            last_exc = exc
            err_text = sanitize_error_text(str(exc))

            if (attempt >= attempts) or (not is_transient_gemini_error(err_text)):
                raise

            delay = min(8.0, base_delay_seconds * (2 ** (attempt - 1)))
            log(f"⚠️ Gemini busy/unavailable. Retrying in {int(delay)}s ({attempt}/{attempts})...")
            time.sleep(delay)

    if last_exc:
        raise last_exc
    raise RuntimeError("Gemini request failed")


def init_whisper_model(cpu_threads=N_THREADS):
    """ Initialize the Whisper model natively """
    global whisper_model
    log(f"🧠 Loading Faster-Whisper model ({MODEL_SIZE}) with {cpu_threads} threads...")
    whisper_model = WhisperModel(
        MODEL_SIZE, 
        device="cpu", 
        compute_type=COMPUTE_TYPE,
        cpu_threads=cpu_threads,
        num_workers=1 # Single stream
    )


# ---------------- SLIDES PROCESSING ----------------
def process_slides(slides_path: str, pages_range: str = None) -> any:
    """
    Checks if PDF exists and handles page slicing if a range is provided.
    Returns the path to the file to uplad (original or temporary sliced).
    """
    if not slides_path or not os.path.exists(slides_path):
        log("⚠️  Slides path not provided or does not exist.")
        return None

    log(f"📄 Slides detected: {slides_path}")
    
    if not pages_range:
        return slides_path

    # Handle page slicing
    try:
        log(f"✂️  Extracting page range: {pages_range}")
        doc = fitz.open(slides_path)
        
        # Parse range (e.g., "1-5")
        start_page, end_page = 0, len(doc) - 1
        parts = pages_range.split('-')
        if len(parts) >= 1 and parts[0].strip():
            start_page = int(parts[0]) - 1
        if len(parts) >= 2 and parts[1].strip():
            end_page = int(parts[1]) - 1
        
        # Validate bounds
        start_page = max(0, start_page)
        end_page = min(len(doc) - 1, end_page)

        if start_page > end_page:
            log(f"⚠️ Invalid range {start_page+1}-{end_page+1}. Using full PDF.")
            doc.close()
            return slides_path

        # Create new PDF with selected pages
        output_dir = os.path.dirname(slides_path) or "."
        base_name = os.path.splitext(os.path.basename(slides_path))[0]
        sliced_path = os.path.join(output_dir, f"{base_name}_pages_{start_page+1}-{end_page+1}.pdf")
        
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start_page, to_page=end_page)
        new_doc.save(sliced_path)
        new_doc.close()
        doc.close()
        
        log(f"   - Created temporary sliced PDF: {sliced_path}")
        return sliced_path

    except Exception as e:
        log(f"❌ Error during PDF slicing: {e}. Using original file.")
        return slides_path


def extract_text_from_pdf(pdf_path: str) -> str:
    if not pdf_path or not os.path.exists(pdf_path):
        return ""

    try:
        doc = fitz.open(pdf_path)
        parts = []
        for page in doc:
            page_text = page.get_text("text")
            if page_text:
                parts.append(page_text.strip())
        doc.close()
        return "\n\n".join([p for p in parts if p]).strip()
    except Exception as e:
        log(f"⚠️ Failed to extract PDF text: {e}")
        return ""


# ---------------- AUDIO FUNCTIONS ----------------
def create_output_folder(source_path: str, output_root: str = None) -> str:
    base_name = os.path.splitext(os.path.basename(source_path))[0]
    root = output_root or os.path.join(BASE_DIR, "output")
    output_dir = os.path.join(root, base_name)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def transcribe_audio_native(audio_path: str):
    """ Transcribe audio using the native Faster-Whisper stream with segment-by-segment progress """
    log(f"🚀 Starting transcription...")

    def run_transcribe(*, use_vad: bool):
        segments, info = whisper_model.transcribe(
            audio_path,
            language=LANGUAGE,
            beam_size=5,
            vad_filter=use_vad,
            vad_parameters=dict(min_silence_duration_ms=500) if use_vad else None,
        )

        log(f"🌍 Detected language: {info.language} (probability: {info.language_probability:.2f})")
        log(f"⏱️ Audio duration: {info.duration:.2f}s")

        pbar = tqdm(
            total=info.duration,
            file=ProgressLogger(),
            desc="Transcribing",
            unit="s",
            bar_format="{l_bar}{bar}| {n:.1f}/{total_fmt} [{elapsed}<{remaining}]",
            ascii=" █",
        )

        full_text: list[str] = []
        last_pos = 0
        for segment in segments:
            full_text.append(segment.text)
            pbar.update(segment.end - last_pos)
            last_pos = segment.end

        if pbar.n < info.duration:
            pbar.update(info.duration - pbar.n)

        pbar.close()
        return " ".join(full_text).strip(), info.language

    transcript, detected_lang = run_transcribe(use_vad=True)
    if transcript:
        return transcript, detected_lang

    # Fallback: some inputs can be over-filtered by VAD.
    log("⚠️ Transcription is empty with VAD enabled. Retrying without VAD...")
    return run_transcribe(use_vad=False)


# ---------------- DOCUMENT GENERATION ----------------
def generate_latex_document(text: str, title: str, slides_path: str, audio_lang: str):
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        log("❌ Gemini API Key not found.")
        return "", "API key missing. Please configure Gemini API key in Settings."

    log("🧠 Generating LaTeX document with Gemini...")
    
    try:
        client = genai.Client(api_key=api_key)
        
        prompt_parts = []
        
        # 1. Base System Instructions
        input_type = "transcription"
        if slides_path and (not text or not text.strip()):
            input_type = "pdf_slides"

        base_prompt = f"""
    You are an expert assistant that creates structured, student-friendly LaTeX notes.

    IMPORTANT RULES:
    - Output must start with \\documentclass and end with \\end{{document}}
    - Use clear structure and formatting

    CONTENT REQUIREMENTS:
    1. Add a Title Page
    2. Add Table of Contents
    3. Create proper Sections and Subsections
    4. Add a section: Key Points Summary (bullet points)
    5. Add a section: Important Concepts
    6. Add a section: Short Notes / Revision Notes
    7. Add a section: Mind Map (Text-based) using itemize or tikz (simple structure)
    8. Add a Final Summary

    FORMAT:
    - Use bullet points
    - Use bold headings
    - Keep it clean and readable

    Language: {audio_lang}

    INPUT TYPE: {input_type}
    - If input is transcription: summarize and structure it as lecture notes.
    - If input is pdf_slides: create high-quality summarized notes directly from the PDF content and slide structure.

    Title:
    Lecture Notes: {title}

    SOURCE CONTENT:
    {text}
    """
        prompt_parts.append(base_prompt)

        # 2. Add PDF file if available
        if slides_path:
            log(f"   - Uploading PDF to Gemini: {os.path.basename(slides_path)}")
            # Upload file to Gemini
            with open(slides_path, "rb") as f:
                uploaded_file = client.files.upload(
                    file=f,
                    config=types.UploadFileConfig(mimeType="application/pdf")
                )
            
            log(f"   - PDF Uploaded (URI: {uploaded_file.uri})")
            prompt_parts.append("Refer to the attached PDF slides for context, diagrams, and structure.")
            prompt_parts.append(uploaded_file)
        else:
            log("   - Sending transcription only.")

        # 3. Generate Content
        response = gemini_generate_with_retries(
            client,
            contents=prompt_parts,
            config=types.GenerateContentConfig(safetySettings=build_safety_settings()),
        )
        
        # Check for safety blocks or empty response
        if not response.text:
             log(f"⚠️ Gemini response was empty. Feedback: {response.prompt_feedback if hasattr(response, 'prompt_feedback') else 'Unknown'}")
             if response.candidates:
                 log(f"⚠️ Candidates found: {len(response.candidates)}. Finish reason: {response.candidates[0].finish_reason}")
             return "", "Gemini returned an empty response."

        latex = response.text.strip()

        if "\\documentclass" in latex:
            latex = latex[latex.find("\\documentclass"):]
        if "\\end{document}" in latex:
            latex = latex[:latex.rfind("\\end{document}") + len("\\end{document}")]

        return latex, ""

    except Exception as e:
        err_text = sanitize_error_text(str(e))
        if "CONSUMER_SUSPENDED" in err_text or "has been suspended" in err_text:
            friendly = "Gemini API key is suspended. Please update to an active key in Settings."
            log(f"❌ {friendly}")
            return "", friendly

        log(f"❌ Error during Gemini request: {err_text}")
        return "", f"Gemini request failed: {err_text}"


def review_latex_content(latex_code: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        return latex_code

    log("🧠 Reviewing content and code with Gemini (Expert Mode)...")
    
    try:
        client = genai.Client(api_key=api_key)
        
        prompt = f"""
You are an expert academic professor and technical reviewer.
Your goal is to refine the following LaTeX document.

1. **Conceptual & Scientific Accuracy**: 
   - Read the content critically. 
   - Identify any scientific, medical, or mathematical errors (e.g., incorrect formulas, misspelled drug names, wrong definitions). 
   - **CORRECT ONLY THE ERRORS** based on your expert knowledge. Do not ask for clarification, just fix it to the scientifically correct version.

2. **LaTeX Validity**: 
   - Ensure all code is valid and compiles without errors. 
   - Fix any broken environments, unclosed brackets, or invalid math syntax.

LaTeX to Review:
{latex_code}

Output ONLY the corrected LaTeX document, starting with \\documentclass...
"""

        response = gemini_generate_with_retries(
            client,
            contents=prompt,
            config=types.GenerateContentConfig(safetySettings=build_safety_settings()),
            attempts=3,
        )

        if not response.text:
            log("⚠️ Review response empty. Using original draft.")
            return latex_code
            
        reviewed_latex = response.text.strip()
        
        # Cleanup markdown formatting if present
        if "\\documentclass" in reviewed_latex:
            reviewed_latex = reviewed_latex[reviewed_latex.find("\\documentclass"):]
        if "\\end{document}" in reviewed_latex:
            reviewed_latex = reviewed_latex[:reviewed_latex.rfind("\\end{document}") + len("\\end{document}")]
            
        return reviewed_latex

    except Exception as e:
        log(f"⚠️ Error during review: {e}. Using original draft.")
        return latex_code


def ensure_mind_map_section(latex_code: str, title: str, transcript: str) -> str:
    if re.search(r"\\section\*?\{\s*Mind\s*Map", latex_code, flags=re.IGNORECASE):
        return latex_code

    sentences = [s.strip() for s in re.split(r"[.!?]\s+", transcript) if s.strip()]
    key_points = sentences[:6] if sentences else ["Main ideas from the lecture."]

    mind_map_lines = [
        "\\section{Mind Map}",
        "\\begin{itemize}",
        f"  \\item \\textbf{{Central Topic}}: {title.replace('_', ' ')}",
        "  \\item \\textbf{Primary Branches}",
        "  \\begin{itemize}",
    ]

    for point in key_points:
        clean_point = point.replace("\\", " ").replace("{", "(").replace("}", ")")
        mind_map_lines.append(f"    \\item {clean_point[:200]}")

    mind_map_lines.extend([
        "  \\end{itemize}",
        "\\end{itemize}",
    ])

    mind_map_block = "\n\n" + "\n".join(mind_map_lines) + "\n\n"

    if "\\end{document}" in latex_code:
        return latex_code.replace("\\end{document}", mind_map_block + "\\end{document}")

    return latex_code + mind_map_block


def latex_to_plain_text(latex_code: str) -> str:
    text = re.sub(r"(?m)^\s*%.*$", "", latex_code)
    text = re.sub(r"\\(documentclass|usepackage|begin|end|tableofcontents|maketitle)(\[[^\]]*\])?(\{[^\}]*\})?", "", text)
    text = re.sub(r"\\section\*?\{([^}]*)\}", r"\n\n\1\n", text)
    text = re.sub(r"\\subsection\*?\{([^}]*)\}", r"\n\1\n", text)
    text = re.sub(r"\\textbf\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\item", "- ", text)
    text = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^\}]*\})?", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def save_history_entry(entry: dict, history_path: str):
    os.makedirs(os.path.dirname(history_path), exist_ok=True)

    history = []
    if os.path.exists(history_path):
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                history = json.load(f)
                if not isinstance(history, list):
                    history = []
        except Exception:
            history = []

    history.append(entry)
    history = history[-200:]

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def write_plain_text_pdf(text: str, pdf_path: str, title: str) -> bool:
    try:
        doc = fitz.open()
        page_width, page_height = 595, 842
        margin = 48
        line_height = 16
        content_width = page_width - (margin * 2)
        usable_height = page_height - (margin * 2)

        lines = []
        for paragraph in (text or "").splitlines():
            stripped = paragraph.strip()
            if not stripped:
                lines.append("")
                continue
            wrapped = textwrap.wrap(stripped, width=max(40, int(content_width / 6.5)))
            if wrapped:
                lines.extend(wrapped)
            else:
                lines.append("")

        if not lines:
            lines = ["No content available."]

        page = doc.new_page(width=page_width, height=page_height)
        y = margin
        page.insert_text((margin, y), title or "AudioTTo Notes", fontsize=18, fontname="helv")
        y += 28

        for line in lines:
            if y > page_height - margin - line_height:
                page = doc.new_page(width=page_width, height=page_height)
                y = margin

            if not line:
                y += line_height
                continue

            page.insert_text((margin, y), line, fontsize=11, fontname="helv")
            y += line_height

        doc.save(pdf_path)
        doc.close()
        return True
    except Exception as exc:
        log(f"❌ Fallback PDF generation failed: {exc}")
        return False


def find_latex_engine() -> str | None:
    candidates = [
        shutil.which("pdflatex"),
        shutil.which("xelatex"),
        shutil.which("lualatex"),
    ]

    windows_dirs = []
    if sys.platform == "win32":
        local_app_data = os.getenv("LOCALAPPDATA", "")
        program_files = os.getenv("ProgramFiles", "")
        program_files_x86 = os.getenv("ProgramFiles(x86)", "")
        windows_dirs = [
            os.path.join(local_app_data, "Programs", "MiKTeX", "miktex", "bin", "x64"),
            os.path.join(program_files, "MiKTeX", "miktex", "bin", "x64"),
            os.path.join(program_files_x86, "MiKTeX", "miktex", "bin", "x64"),
        ]

    for candidate in candidates:
        if candidate:
            return candidate

    for bin_dir in windows_dirs:
        for engine_name in ("pdflatex.exe", "xelatex.exe", "lualatex.exe"):
            engine_path = os.path.join(bin_dir, engine_name)
            if os.path.exists(engine_path):
                return engine_path

    return None


# ---------------- COMPILATION ----------------
def compile_pdf(tex_path: str) -> bool:
    log("📄 Compiling PDF...")

    output_dir, file_name = os.path.split(tex_path)
    pdf_path = os.path.join(output_dir, f"{os.path.splitext(file_name)[0]}.pdf")

    latex_engine = find_latex_engine()
    if not latex_engine:
        log("⚠️ No LaTeX engine found. Creating a readable fallback PDF instead.")
        try:
            with open(tex_path, "r", encoding="utf-8") as f:
                latex_code = f.read()
            plain_text = latex_to_plain_text(latex_code)
            if write_plain_text_pdf(plain_text, pdf_path, os.path.splitext(file_name)[0]):
                log("✅ Fallback PDF successfully generated.")
                return True
        except Exception as exc:
            log(f"❌ Fallback PDF preparation failed: {exc}")
        return False

    for _ in range(2):  # run twice
        try:
            result = subprocess.run(
                [latex_engine, "-interaction=nonstopmode", file_name],
                check=True, cwd=output_dir, capture_output=True, text=True
            )
            if result.stdout:
                log(result.stdout.strip())
            if result.stderr:
                log(result.stderr.strip())
        except FileNotFoundError:
            log(f"❌ PDF compilation failed: {latex_engine} was not found on PATH.")
            break
        except Exception as e:
            log(f"❌ PDF compilation failed: {e}")

    if os.path.exists(pdf_path):
        log("✅ PDF successfully generated.")
        return True

    log("⚠️ LaTeX compilation failed. Creating a readable fallback PDF instead.")
    try:
        with open(tex_path, "r", encoding="utf-8") as f:
            latex_code = f.read()
        plain_text = latex_to_plain_text(latex_code)
        if write_plain_text_pdf(plain_text, pdf_path, os.path.splitext(file_name)[0]):
            log("✅ Fallback PDF successfully generated.")
            return True
    except Exception as exc:
        log(f"❌ Fallback PDF preparation failed: {exc}")

    return False


def cleanup_output(output_dir: str, base_name: str):
    log("\n🧹 Final cleanup...")

    keep_files = [
        f"{base_name}_appunti.tex",
        f"{base_name}_appunti.pdf",
        f"{base_name}_trascrizione.txt",
        f"{base_name}_notes.txt"
    ]

    for filename in os.listdir(output_dir):
        if filename not in keep_files:
            try:
                os.remove(os.path.join(output_dir, filename))
                log(f"   - Removed temporary file: {filename}")
            except Exception as e:
                log(f"   - Error deleting {filename}: {e}")

    log("✔️ Cleanup completed.")


# ---------------- MAIN ----------------
def main(args_list=None):
    log("🚀 Initializing AudioTTo...")
    start_time = time.time()

    parser = argparse.ArgumentParser(description="Generates LaTeX/PDF notes from audio/video transcription and/or PDF slides.")
    parser.add_argument("file_audio", nargs="?", help="Path to the audio/video file.")
    parser.add_argument("--slides", help="Path to PDF slides.")
    parser.add_argument("--pages", help="Page range (e.g., '5-12').")
    parser.add_argument("--threads", type=int, default=N_THREADS)
    parser.add_argument("--user-id", help="Optional user id used for user-scoped output folders.")
    
    # If args_list is provided, use it; otherwise, use sys.argv
    if args_list:
        args = parser.parse_args(args_list)
    else:
        args = parser.parse_args()

    if not args.file_audio and not args.slides:
        log("❌ No input provided. Add an audio/video file or a PDF file.")
        return {
            "succeeded": False,
            "folder": "",
            "output_dir": "",
            "pdf": "",
            "notes": "",
            "transcript": "",
            "error": "No input provided.",
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }

    should_transcribe = bool(args.file_audio)
    if should_transcribe:
        init_whisper_model(cpu_threads=args.threads)

    user_output_root = os.path.join(BASE_DIR, "output")
    if args.user_id:
        user_output_root = os.path.join(user_output_root, str(args.user_id))

    history_path = os.path.join(user_output_root, "history.json")

    # Folder creation and variable initialization
    source_for_output = args.file_audio if args.file_audio else args.slides
    output_dir = create_output_folder(source_for_output, user_output_root)
    base_name = os.path.splitext(os.path.basename(source_for_output))[0]
    succeeded = False
    pdf_path = ""
    notes_path = ""
    transcript_file = ""
    failure_reason = ""

    try:
        # 1. Slide processing
        slides_images = process_slides(args.slides, args.pages)

        transcript = ""
        audio_lang = "en"

        # 2. Transcription (if audio/video was provided)
        if should_transcribe:
            transcript, audio_lang = transcribe_audio_native(args.file_audio)

            if not transcript.strip():
                log("⚠️ Transcription is empty. Stopping.")
                failure_reason = "Transcription is empty."
            else:
                # 3. Saving transcription text file
                transcript_file = os.path.join(output_dir, f"{base_name}_trascrizione.txt")
                with open(transcript_file, "w", encoding="utf-8") as f:
                    f.write(transcript)
                log(f"💾 Transcription saved at: {transcript_file}")

        # 2b. PDF-only fallback: extract text from slides
        if (not should_transcribe) and slides_images:
            transcript = extract_text_from_pdf(slides_images)
            transcript_file = os.path.join(output_dir, f"{base_name}_trascrizione.txt")
            with open(transcript_file, "w", encoding="utf-8") as f:
                f.write(transcript or "")
            log(f"💾 PDF extracted text saved at: {transcript_file}")

        if not transcript.strip() and not slides_images:
            failure_reason = "No usable content found from input."

        # 4. LaTeX generation through LLM (Gemini)
        latex_doc, generation_error = ("", "")
        if not failure_reason:
            latex_doc, generation_error = generate_latex_document(transcript, base_name, slides_images, audio_lang)

        if latex_doc:
            # 5. Automatic review (Conceptual and Code Validation)
            latex_doc = review_latex_content(latex_doc)
            latex_doc = ensure_mind_map_section(latex_doc, base_name, transcript)

            notes_txt = latex_to_plain_text(latex_doc)
            notes_path = os.path.join(output_dir, f"{base_name}_notes.txt")
            with open(notes_path, "w", encoding="utf-8") as f:
                f.write(notes_txt)
            log(f"📝 Notes text file created: {notes_path}")
            
            tex_path = os.path.join(output_dir, f"{base_name}_appunti.tex")
            with open(tex_path, "w", encoding="utf-8") as f:
                f.write(latex_doc)

            log(f"📝 LaTeX file created: {tex_path}")

            # 6. PDF compilation (pdflatex)
            if compile_pdf(tex_path):
                succeeded = True
                pdf_path = os.path.join(output_dir, f"{base_name}_appunti.pdf")
            else:
                if not failure_reason:
                    failure_reason = "PDF compilation failed. A fallback PDF could not be created."
        else:
            if not failure_reason:
                failure_reason = generation_error or "Failed to generate LaTeX document."
            log("❌ Failed to generate LaTeX document (AI response was empty or error).")

    except Exception as e:
        # Generic error capture to avoid silent GUI crashes
        failure_reason = f"Critical Error: {sanitize_error_text(str(e))}"
        log(f"❌ Critical Error during execution: {sanitize_error_text(str(e))}")

    finally:
        # 7. Cleaning LaTeX compilation files
        log("🧹 Cleaning LaTeX compilation files...")
        for ext in ['.aux', '.log', '.out', '.fls', '.fdb_latexmk']:
            tmp = os.path.join(output_dir, f"{base_name}_appunti{ext}")
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
                    log(f"   - Removed: {os.path.basename(tmp)}")
            except Exception as e:
                log(f"   - Error deleting {tmp}: {e}")

        # 8. Final cleanup
        if succeeded:
            cleanup_output(output_dir, base_name)

    total_seconds = int(time.time() - start_time)
    log(f"\n⏱️ Total time: {total_seconds // 60} min {total_seconds % 60} sec")
    log(f"🎉 Process completed. Final files are in: {output_dir}")

    result = {
        "succeeded": succeeded,
        "folder": os.path.basename(output_dir),
        "output_dir": output_dir,
        "pdf": os.path.basename(pdf_path) if pdf_path else "",
        "notes": os.path.basename(notes_path) if notes_path else "",
        "transcript": os.path.basename(transcript_file) if transcript_file else "",
        "error": failure_reason,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }

    save_history_entry(result, history_path)

    return result


if __name__ == "__main__":

    # Fix for Multiprocessing on Windows when creating an EXE
    if sys.platform == "win32":
        os.environ["PYTHONIOENCODING"] = "utf-8"
        if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
            try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            except: pass
        if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
            try: sys.stderr.reconfigure(encoding='utf-8', errors='replace')
            except: pass
    
    # Still needed for other potential multiprocessing uses (though GUI app handles it mostly)
    if sys.platform in ["win32", "darwin"]:
        multiprocessing.freeze_support()
        multiprocessing.set_start_method('spawn', force=True)
    
    main()
