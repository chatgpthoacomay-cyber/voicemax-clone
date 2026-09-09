"""
Vercel Python Serverless Function: POST /api/tts-with-timing
Body (JSON): { text, voice, rate="+0%", pitch="+0Hz" }
Response: JSON { audio: number[], boundaries: [], duration: 0 }
"""
import json
import asyncio
import traceback

try:
    import edge_tts
except ImportError as e:
    def handler(event, context):
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST,OPTIONS",
            },
            "body": json.dumps({"error": f"edge-tts not installed ({e}). Add requirements.txt with edge-tts"}),
        }


async def _synthesize(text, voice, rate, pitch):
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio_bytes = bytearray()
    boundaries = []
    async for chunk in communicate.stream():
        t = chunk.get("type")
        if t == "audio":
            audio_bytes.extend(chunk["data"])
        elif t == "WordBoundary":
            boundaries.append({
                "offset": chunk.get("offset", 0),
                "duration": chunk.get("duration", 0),
                "text": chunk.get("text", ""),
            })
    return bytes(audio_bytes), boundaries


def handler(event, context):
    method = event.get("httpMethod") or event.get("method", "GET")
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}
    if method != "POST":
        return {"statusCode": 405, "headers": headers, "body": json.dumps({"error": "Method Not Allowed"})}
    try:
        body_raw = event.get("body", "{}")
        if isinstance(body_raw, (bytes, bytearray)):
            body_raw = body_raw.decode("utf-8")
        if event.get("isBase64Encoded") and body_raw:
            import base64 as _b64
            body_raw = _b64.b64decode(body_raw).decode("utf-8")
        payload = json.loads(body_raw or "{}")
    except Exception as e:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": f"Invalid JSON: {e}"})}

    text = str(payload.get("text", "")).strip()
    voice = str(payload.get("voice", "")).strip()
    rate = str(payload.get("rate", "+0%")).strip() or "+0%"
    pitch = str(payload.get("pitch", "+0Hz")).strip() or "+0Hz"

    if not text:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Text required"})}
    if not voice:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Voice required"})}
    if len(text) > 2500:
        return {"statusCode": 413, "headers": headers, "body": json.dumps({"error": "Text > 2500 chars"})}

    try:
        audio_bytes, boundaries = asyncio.run(_synthesize(text, voice, rate, pitch))
        if not audio_bytes or len(audio_bytes) < 100:
            return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": "Audio buffer quá nhỏ"})}
        duration = 0
        if boundaries:
            last = boundaries[-1]
            duration = (last.get("offset", 0) + last.get("duration", 0)) / 10_000_000.0
        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({
                "audio": list(audio_bytes),
                "boundaries": boundaries,
                "duration": duration,
            }),
        }
    except Exception as e:
        tb = traceback.format_exc()
        return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": f"{e}", "trace": tb[:500]})}
