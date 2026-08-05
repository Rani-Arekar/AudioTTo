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
# ReportLab is used for native PDF generation (preferred over LaTeX)
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
except Exception:
    colors = None
    A4 = None
    getSampleStyleSheet = None
    Paragraph = None
    SimpleDocTemplate = None
    Table = None
    TableStyle = None
    Preformatted = None
    pdfmetrics = None
    TTFont = None

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

# Support both older GenAI SDKs (which expose `configure`) and newer usage
# where we create a `genai.Client(api_key=...)` or rely on `GEMINI_API_KEY` env var.
# --- PATH CONFIGURATION ---
def get_base_dir():
    if getattr(sys, 'frozen', False):
        path = os.path.dirname(sys.executable)
        if ".app/Contents/MacOS" in path:
            return os.path.abspath(os.path.join(path, "../../../"))
        return path
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()

# Load .env FIRST
load_dotenv(os.path.join(BASE_DIR, ".env"))

_api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

if _api_key and not os.getenv("GEMINI_API_KEY"):
    os.environ["GEMINI_API_KEY"] = _api_key

try:
    if hasattr(genai, "configure"):
        genai.configure(api_key=_api_key)
except Exception:
    pass

model_name = "gemini-3.1-flash-lite-preview"
whisper_model = None


# Logger Setup
logger_callback = None

def set_logger(callback):
    global logger_callback
    logger_callback = callback

def safe_print(*args, **kwargs):
    """Safely print text to the console."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(map(str, args))
        print(text.encode("utf-8", errors="replace").decode("utf-8"))
        
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

    # Detect presence of numeric content (numbers, equations, tables)
    numeric_present = False
    try:
        if text and re.search(r"\d|\\\(|\\\[|=|\\frac|\\sum|\\int|%", text):
            numeric_present = True
    except Exception:
        numeric_present = False
    
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

    NOTE ON NUMERICAL CONTENT:
    - If the source contains numeric values, equations, data tables or worked examples, include a dedicated "Numerical Examples" section.
    - For each numerical item: show step-by-step calculations, preserve original numbers, present results in a table when helpful, and provide a short runnable Python snippet that reproduces the calculation.
    - Keep theoretical explanations concise when numeric demonstrations are present; prioritize clarity and reproducibility.

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


def _find_system_font() -> tuple[str | None, str | None]:
    """Try to find a reasonable TTF font on the system for Unicode support.
    Returns (font_name, font_path) or (None, None).
    """
    fonts_dir = None
    if sys.platform == 'win32':
        fonts_dir = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts')
    else:
        fonts_dir = '/usr/share/fonts'

    if not fonts_dir or not os.path.isdir(fonts_dir):
        return None, None

    candidates = [
        'DejaVuSans.ttf',
        'DejaVuSans-Regular.ttf',
        'SegoeUI.ttf',
        'Arial.ttf',
        'Tahoma.ttf',
    ]

    for root, _, files in os.walk(fonts_dir):
        for f in files:
            if f in candidates:
                return os.path.splitext(f)[0], os.path.join(root, f)

    # Fallback: pick first TTF found
    for root, _, files in os.walk(fonts_dir):
        for f in files:
            if f.lower().endswith('.ttf'):
                return os.path.splitext(f)[0], os.path.join(root, f)

    return None, None


def generate_pdf_from_latex(latex_code: str, pdf_path: str, title: str = None) -> bool:
    """Render a LaTeX-like document into a professional PDF using ReportLab.
    Preserves sections, subsections, itemize/enumerate, simple tabular, and code blocks.
    Returns True on success.
    """
    if SimpleDocTemplate is None:
        log('❌ ReportLab not installed. Install with `pip install reportlab`.')
        return False

    # Prepare styles and fonts
    styles = getSampleStyleSheet()
    normal = styles['BodyText']
    h1 = ParagraphStyle('Heading1', parent=styles['Heading1'], spaceAfter=6)
    h2 = ParagraphStyle('Heading2', parent=styles['Heading2'], spaceAfter=4)
    code_style = ParagraphStyle('Code', fontName='Courier', fontSize=9, leading=11)

    font_name, font_path = _find_system_font()
    if font_name and pdfmetrics and TTFont:
        try:
            pdfmetrics.registerFont(TTFont(font_name, font_path))
            normal.fontName = font_name
            h1.fontName = font_name
            h2.fontName = font_name
            code_style.fontName = font_name
        except Exception:
            pass

    # Simple LaTeX-like parser
    lines = latex_code.splitlines()
    story = []
    i = 0
    in_itemize = False
    in_enumerate = False
    in_verbatim = False
    verbatim_lines = []
    table_mode = False
    table_lines = []

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        # Headings
        m = re.match(r"\\section\*?\{(.+?)\}", stripped)
        if m:
            story.append(Paragraph(m.group(1), h1))
            story.append(Spacer(1, 6))
            i += 1
            continue

        m = re.match(r"\\subsection\*?\{(.+?)\}", stripped)
        if m:
            story.append(Paragraph(m.group(1), h2))
            story.append(Spacer(1, 4))
            i += 1
            continue

        # itemize/enumerate
        if stripped.startswith('\\begin{itemize}'):
            in_itemize = True
            i += 1
            continue
        if stripped.startswith('\\end{itemize}'):
            in_itemize = False
            story.append(Spacer(1, 6))
            i += 1
            continue

        if stripped.startswith('\\begin{enumerate}'):
            in_enumerate = True
            enum_index = 1
            i += 1
            continue
        if stripped.startswith('\\end{enumerate}'):
            in_enumerate = False
            story.append(Spacer(1, 6))
            i += 1
            continue

        if in_itemize and stripped.startswith('\\item'):
            content = stripped[len('\\item'):].strip() or '•'
            story.append(Paragraph('• ' + content, normal))
            i += 1
            continue

        if in_enumerate and stripped.startswith('\\item'):
            content = stripped[len('\\item'):].strip() or ''
            story.append(Paragraph(f'{enum_index}. ' + content, normal))
            enum_index += 1
            i += 1
            continue

        # verbatim/code blocks
        if stripped.startswith('\\begin{verbatim}') or stripped.startswith('\\begin{lstlisting}'):
            in_verbatim = True
            verbatim_lines = []
            i += 1
            continue
        if stripped.startswith('\\end{verbatim}') or stripped.startswith('\\end{lstlisting}'):
            in_verbatim = False
            code_text = '\n'.join(verbatim_lines)
            story.append(Preformatted(code_text, code_style))
            story.append(Spacer(1, 6))
            i += 1
            continue
        if in_verbatim:
            verbatim_lines.append(lines[i])
            i += 1
            continue

        # tabular
        if stripped.startswith('\\begin{tabular}'):
            table_mode = True
            table_lines = []
            i += 1
            continue
        if stripped.startswith('\\end{tabular}'):
            table_mode = False
            rows = []
            for tl in table_lines:
                # remove trailing \\\\ if present
                row_text = tl.rstrip()
                if row_text.endswith('\\\\'):
                    row_text = row_text[:-2]
                cols = [c.strip() for c in row_text.split('&')]
                rows.append(cols)
            try:
                t = Table(rows)
                t.setStyle(TableStyle([
                    ('GRID', (0,0), (-1,-1), 0.5, colors.black),
                    ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ]))
                story.append(t)
                story.append(Spacer(1, 6))
            except Exception:
                for r in rows:
                    story.append(Paragraph(' | '.join(r), normal))
            i += 1
            continue
        if table_mode:
            table_lines.append(stripped)
            i += 1
            continue

        # Regular paragraph
        if stripped:
            txt = stripped
            txt = re.sub(r'\\textbf\{(.+?)\}', r'<b>\1</b>', txt)
            txt = re.sub(r'\\emph\{(.+?)\}', r'<i>\1</i>', txt)
            story.append(Paragraph(txt, normal))
            story.append(Spacer(1, 4))
        else:
            story.append(Spacer(1, 6))

        i += 1

    try:
        doc = SimpleDocTemplate(pdf_path, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
        doc.build(story)
        log(f"✅ PDF generated via ReportLab: {os.path.basename(pdf_path)}")
        return True
    except Exception as e:
        log(f"❌ ReportLab PDF generation failed: {e}")
        return False


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


def detect_tex_distribution() -> str | None:
    """Detect whether MiKTeX or TeX Live is available. Returns 'miktex', 'texlive', or None."""
    # Check common executables
    if shutil.which("tlmgr"):
        return "texlive"

    # MiKTeX package manager common names
    for cmd in ("mpm", "miktex-mpm", "miktexsetup", "mpm.exe", "miktex-mpm.exe"):
        if shutil.which(cmd):
            return "miktex"

    # Windows typical MiKTeX installation folders
    if sys.platform == "win32":
        local_app_data = os.getenv("LOCALAPPDATA", "")
        program_files = os.getenv("ProgramFiles", "")
        program_files_x86 = os.getenv("ProgramFiles(x86)", "")
        possible = [
            os.path.join(local_app_data, "Programs", "MiKTeX"),
            os.path.join(program_files, "MiKTeX"),
            os.path.join(program_files_x86, "MiKTeX"),
        ]
        for p in possible:
            if p and os.path.isdir(p):
                return "miktex"

    return None


def run_subprocess(cmd: list[str], cwd: str, timeout: int = 60) -> tuple[int, str, str]:
    """Run subprocess with timeout, capture stdout/stderr, and return (returncode, stdout, stderr)."""
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        out = proc.stdout or ""
        err = proc.stderr or ""
        return proc.returncode, out, err
    except subprocess.TimeoutExpired as e:
        return -1, getattr(e, 'stdout', '') or '', getattr(e, 'stderr', '') or f'Timeout after {timeout}s'
    except FileNotFoundError:
        return -2, '', f'Executable not found: {cmd[0]}'
    except Exception as e:
        return -3, '', str(e)


def parse_missing_packages(output: str) -> list[str]:
    """Try to parse missing .sty/package names from LaTeX output.
    Returns a list of candidate package names (without extension).
    """
    missing = set()
    # Patterns like: LaTeX Error: File `gettitlestring.sty' not found.
    for m in re.findall(r"File `([^`']+?)\.sty' not found", output, flags=re.IGNORECASE):
        missing.add(m)

    # Pattern: ! LaTeX Error: File `...sty' not found.
    for m in re.findall(r"File\s+`([^`']+?\.sty)'", output, flags=re.IGNORECASE):
        name = os.path.splitext(m)[0]
        missing.add(name)

    # Generic 'I can't find file `xyz.sty''
    for m in re.findall(r"I can't find file `([^`']+?\.sty)'", output, flags=re.IGNORECASE):
        missing.add(os.path.splitext(m)[0])

    # If no .sty found, search for messages like 'Package foo not found' (less common)
    for m in re.findall(r"Package\s+([^\s:]+)\s+not found", output, flags=re.IGNORECASE):
        missing.add(m)

    return list(missing)


def try_install_packages(packages: list[str], distro: str, cwd: str, timeout: int = 60) -> tuple[bool, str]:
    """Attempt to install packages using tlmgr (TeX Live) or mpm (MiKTeX). Returns (success, log)."""
    logs = []
    if not packages:
        return False, "No packages to install."

    if distro == "texlive":
        tlmgr = shutil.which("tlmgr")
        if not tlmgr:
            return False, "tlmgr not found on PATH."

        for pkg in packages:
            cmd = [tlmgr, "install", pkg]
            rc, out, err = run_subprocess(cmd, cwd=cwd, timeout=timeout)
            logs.append(f"tlmgr {' '.join(cmd[1:])} -> rc={rc}\n{out}\n{err}")
            if rc != 0:
                return False, "\n".join(logs)

        return True, "\n".join(logs)

    if distro == "miktex":
        # Try common MiKTeX package manager commands
        mpm = shutil.which("mpm") or shutil.which("miktex-mpm") or shutil.which("mpm.exe") or shutil.which("miktex-mpm.exe")
        if not mpm:
            return False, "MiKTeX package manager not found on PATH."

        for pkg in packages:
            # Best-effort: use mpm --install <pkg>
            cmd = [mpm, "--install", pkg]
            rc, out, err = run_subprocess(cmd, cwd=cwd, timeout=timeout)
            logs.append(f"mpm install {pkg} -> rc={rc}\n{out}\n{err}")
            if rc != 0:
                # try without -- (some mpm variants expect different args)
                cmd2 = [mpm, "install", pkg]
                rc2, out2, err2 = run_subprocess(cmd2, cwd=cwd, timeout=timeout)
                logs.append(f"mpm install (alt) {pkg} -> rc={rc2}\n{out2}\n{err2}")
                if rc2 != 0:
                    return False, "\n".join(logs)

        return True, "\n".join(logs)

    return False, "Unknown TeX distribution or installer not available."


# ---------------- COMPILATION ----------------
def compile_pdf(tex_path: str) -> bool:
    log("📄 Compiling PDF...")

    output_dir, file_name = os.path.split(tex_path)
    pdf_path = os.path.join(output_dir, f"{os.path.splitext(file_name)[0]}.pdf")
    latex_engine = find_latex_engine()
    distro = detect_tex_distribution()

    base_name = os.path.splitext(file_name)[0]
    compile_log_path = os.path.join(output_dir, f"{base_name}_compile.log")
    accumulated_log: list[str] = []

    if not latex_engine:
        msg = "No LaTeX engine found on the system (pdflatex/xelatex/lualatex)."
        log(f"⚠️ {msg} Creating a readable fallback PDF instead.")
        accumulated_log.append(msg)
        try:
            with open(tex_path, "r", encoding="utf-8") as f:
                latex_code = f.read()
            plain_text = latex_to_plain_text(latex_code)
            if write_plain_text_pdf(plain_text, pdf_path, base_name):
                log("✅ Fallback PDF successfully generated.")
                accumulated_log.append("Fallback PDF generated.")
                with open(compile_log_path, "w", encoding="utf-8") as lf:
                    lf.write("\n".join(accumulated_log))
                return True
        except Exception as exc:
            log(f"❌ Fallback PDF preparation failed: {exc}")
            accumulated_log.append(f"Fallback generation failed: {exc}")
        with open(compile_log_path, "w", encoding="utf-8") as lf:
            lf.write("\n".join(accumulated_log))
        return False

    def attempt_once() -> tuple[int, str, str]:
        cmd = [latex_engine, "-interaction=nonstopmode", file_name]
        log(f"🔁 Running: {' '.join(cmd)} (cwd={output_dir})")
        rc, out, err = run_subprocess(cmd, cwd=output_dir, timeout=120)
        if out:
            log(out.strip())
            accumulated_log.append("STDOUT:\n" + out)
        if err:
            log(err.strip())
            accumulated_log.append("STDERR:\n" + err)
        return rc, out, err

    # First attempt
    rc, out, err = attempt_once()

    # If successful and PDF created, return
    if rc == 0 and os.path.exists(pdf_path):
        log("✅ PDF successfully generated.")
        with open(compile_log_path, "w", encoding="utf-8") as lf:
            lf.write("\n".join(accumulated_log))
        return True

    combined = (out or "") + "\n" + (err or "")
    missing = parse_missing_packages(combined)

    if missing:
        log(f"⚠️ Detected missing LaTeX packages: {', '.join(missing)}")
        accumulated_log.append(f"Missing packages detected: {', '.join(missing)}")

        if distro:
            log(f"🔧 Attempting to install missing packages using {distro} package manager...")
            success, install_log = try_install_packages(missing, distro, cwd=output_dir, timeout=120)
            accumulated_log.append("INSTALL LOG:\n" + install_log)

            if success:
                log("✅ Packages installed. Retrying compilation once...")
                rc2, out2, err2 = attempt_once()
                if rc2 == 0 and os.path.exists(pdf_path):
                    log("✅ PDF successfully generated after installing packages.")
                    with open(compile_log_path, "w", encoding="utf-8") as lf:
                        lf.write("\n".join(accumulated_log))
                    return True
                else:
                    log("❌ Compilation still failed after package installation.")
                    accumulated_log.append("Retry after install failed.")
            else:
                log("❌ Failed to install missing packages automatically.")
                accumulated_log.append("Automatic install failed: " + install_log)
        else:
            log("⚠️ No TeX distribution package manager detected to auto-install missing packages.")
            accumulated_log.append("No package manager available for automatic install.")

    else:
        accumulated_log.append("No explicit missing-package messages found in LaTeX output.")

    # If reached here, compilation failed. Provide clear instructions and write compile log.
    user_msg_lines = [
        "LaTeX compilation failed.",
        "Check the compilation log for details and install missing LaTeX packages.",
        "If you are on Windows and MiKTeX prompted for package installation, ensure MiKTeX is configured for unattended installs or install the packages manually.",
        "You can download the generated .tex and notes from the output folder.",
    ]
    for m in user_msg_lines:
        log(m)
        accumulated_log.append(m)

    try:
        with open(compile_log_path, "w", encoding="utf-8") as lf:
            lf.write("\n\n".join(accumulated_log))
    except Exception:
        pass

    # Leave .tex and notes for user to download; return False to indicate no PDF
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

            # 6. PDF generation (ReportLab) — LaTeX compilation is optional
            pdf_path = os.path.join(output_dir, f"{base_name}_appunti.pdf")
            # Use ReportLab-based generator to avoid external TeX dependencies
            try:
                if generate_pdf_from_latex(latex_doc, pdf_path, base_name):
                    succeeded = True
                else:
                    if not failure_reason:
                        failure_reason = "PDF generation (ReportLab) failed. The .tex and notes files are available for manual export."
            except Exception as e:
                log(f"❌ PDF generation error: {e}")
                if not failure_reason:
                    failure_reason = f"PDF generation error: {sanitize_error_text(str(e))}. The .tex and notes files are available for manual export."
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
