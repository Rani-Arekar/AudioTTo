#!/usr/bin/env python3
"""
Quick sanity-check for the installed Google GenAI client.
Run this after activating your virtualenv to confirm the SDK and API key.
"""
import os
import sys

try:
    import google.genai as genai
    from google.genai import types
except Exception as e:
    print("ERROR: failed to import google.genai:", e)
    sys.exit(2)

print("genai module loaded. Has configure():", hasattr(genai, "configure"))

api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
print("GEMINI_API_KEY present:", bool(api_key))

try:
    if api_key:
        client = genai.Client(api_key=api_key)
    else:
        client = genai.Client()

    print("Client constructed successfully.")
    print("Client has 'files' attribute:", hasattr(client, "files"))
    print("Client has 'models' attribute:", hasattr(client, "models"))

    if hasattr(client, "files"):
        print("files attributes:", [a for a in dir(client.files) if not a.startswith("__")][:20])
    if hasattr(client, "models"):
        print("models attributes:", [a for a in dir(client.models) if not a.startswith("__")][:20])

    print("Sanity check OK. You can now run the app and retry uploads.")
    sys.exit(0)
except Exception as e:
    print("ERROR while constructing or introspecting client:", e)
    sys.exit(3)
