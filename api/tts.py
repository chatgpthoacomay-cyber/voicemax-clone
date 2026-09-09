"""
Vercel Python Serverless Function: POST /api/tts
Body (JSON): { text, voice, rate="+0%", pitch="+0Hz" }
Response: audio/mpeg (binary MP3) - base64 encoded
Uses WSGI app pattern for Vercel Python Runtime.
"""
import json
import asyncio
import base64
import traceback
import sys


def _synthesize_sync(text, voice, rate, pitch):
    """Synchronous wrapper for edge-tts synthesis."""
    async def _run():
        import edge_tts
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio_bytes = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                audio_bytes.extend(chunk["data"])
        return bytes(audio_bytes)

    # Vercel Python runtime may have a running event loop.
    # Always create a fresh loop to avoid asyncio.run() conflicts.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_run())
    finally:
        loop.close()


def app(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }

    if method == "OPTIONS":
        start_response("200 OK", [(k, v) for k, v in headers.items()])
        return [b""]

    if method != "POST":
        resp = json.dumps({"error": "Method Not Allowed"}).encode()
        headers["Content-Type"] = "application/json"
        start_response("405 Method Not Allowed", [(k, v) for k, v in headers.items()])
        return [resp]

    try:
        import edge_tts
    except ImportError as e:
        resp = json.dumps({"error": f"edge-tts not installed: {e}"}).encode()
        headers["Content-Type"] = "application/json"
        start_response("500 Internal Server Error", [(k, v) for k, v in headers.items()])
        return [resp]

    try:
        content_length = int(environ.get("CONTENT_LENGTH", 0) or 0)
        body_raw = environ["wsgi.input"].read(content_length) if content_length > 0 else b"{}"
        payload = json.loads(body_raw.decode("utf-8") if body_raw else "{}")
    except Exception as e:
        resp = json.dumps({"error": f"Invalid JSON body: {e}"}).encode()
        headers["Content-Type"] = "application/json"
        start_response("400 Bad Request", [(k, v) for k, v in headers.items()])
        return [resp]

    text = str(payload.get("text", "")).strip()
    voice = str(payload.get("voice", "")).strip()
    rate = str(payload.get("rate", "+0%")).strip() or "+0%"
    pitch = str(payload.get("pitch", "+0Hz")).strip() or "+0Hz"

    if not text:
        resp = json.dumps({"error": "Text is required"}).encode()
        headers["Content-Type"] = "application/json"
        start_response("400 Bad Request", [(k, v) for k, v in headers.items()])
        return [resp]
    if not voice:
        resp = json.dumps({"error": "Voice is required"}).encode()
        headers["Content-Type"] = "application/json"
        start_response("400 Bad Request", [(k, v) for k, v in headers.items()])
        return [resp]
    if len(text) > 2500:
        resp = json.dumps({"error": "Text quá dài (>2500 ký tự)."}).encode()
        headers["Content-Type"] = "application/json"
        start_response("413 Payload Too Large", [(k, v) for k, v in headers.items()])
        return [resp]

    try:
        audio_bytes = _synthesize_sync(text, voice, rate, pitch)
        if not audio_bytes or len(audio_bytes) < 100:
            resp = json.dumps({"error": "Không tạo được âm thanh (buffer quá nhỏ)."}).encode()
            headers["Content-Type"] = "application/json"
            start_response("500 Internal Server Error", [(k, v) for k, v in headers.items()])
            return [resp]
        b64audio = base64.b64encode(audio_bytes).decode("ascii")
        resp = json.dumps({"audio": b64audio}).encode()
        headers["Content-Type"] = "application/json"
        headers["Cache-Control"] = "public, max-age=3600"
        start_response("200 OK", [(k, v) for k, v in headers.items()])
        return [resp]
    except Exception as e:
        tb = traceback.format_exc()
        resp = json.dumps({"error": f"{e}", "trace": tb[:500]}).encode()
        headers["Content-Type"] = "application/json"
        start_response("500 Internal Server Error", [(k, v) for k, v in headers.items()])
        return [resp]