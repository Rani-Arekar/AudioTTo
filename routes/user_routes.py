import json
import os
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from auth import get_current_user
from models import User

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_ROOT = os.path.join(BASE_DIR, "output")

router = APIRouter(tags=["users"])


def get_user_output_root(user_id: int) -> str:
    return os.path.join(OUTPUT_ROOT, str(user_id))


def get_user_history_path(user_id: int) -> str:
    return os.path.join(get_user_output_root(user_id), "history.json")


def read_user_history_entries(user_id: int) -> list[dict[str, Any]]:
    history_path = get_user_history_path(user_id)
    if not os.path.exists(history_path):
        return []

    try:
        with open(history_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except Exception:
        pass

    return []


@router.get("/outputs")
def list_outputs(current_user: User = Depends(get_current_user)):
    output_root = get_user_output_root(current_user.id)
    history = read_user_history_entries(current_user.id)
    history_by_folder = {item.get("folder"): item for item in history if item.get("folder")}

    files = []
    if os.path.exists(output_root):
        for root, _, filenames in os.walk(output_root):
            folder = os.path.basename(root)
            if folder == str(current_user.id):
                continue

            pdfs = [f for f in filenames if f.endswith(".pdf")]
            if not pdfs:
                continue

            notes = next((f for f in filenames if f.endswith("_notes.txt")), "")
            transcript = next((f for f in filenames if f.endswith("_trascrizione.txt")), "")
            meta = history_by_folder.get(folder, {})

            for pdf in pdfs:
                files.append(
                    {
                        "filename": pdf,
                        "folder": folder,
                        "notes_filename": notes,
                        "transcript_filename": transcript,
                        "created_at": meta.get("created_at", ""),
                    }
                )

    files.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return JSONResponse(content=files)


@router.get("/history")
def get_history(current_user: User = Depends(get_current_user)):
    history = read_user_history_entries(current_user.id)
    history.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return JSONResponse(content=history)


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username}
