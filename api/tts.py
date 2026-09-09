"""
Vercel Python Serverless Function: POST /api/tts
Body (JSON): { text, voice, rate="+0%", pitch="+0Hz" }
Response: audio/mpeg (binary MP3) - base64 encoded for binary transport
"""
import json
import asyncio
import base64
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
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            audio_bytes.extend(chunk["data"])
    return bytes(audio_bytes)


def handler(event, context):
    method = event.get("httpMethod") or event.get("method", "GET")
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}
    if method != "POST":
        headers["Content-Type"] = "application/json"
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
        headers["Content-Type"] = "application/json"
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": f"Invalid JSON body: {e}"})}

    text = str(payload.get("text", "")).strip()
    voice = str(payload.get("voice", "")).strip()
    rate = str(payload.get("rate", "+0%")).strip() or "+0%"
    pitch = str(payload.get("pitch", "+0Hz")).strip() or "+0Hz"

    if not text:
        headers["Content-Type"] = "application/json"
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Text is required"})}
    if not voice:
        headers["Content-Type"] = "application/json"
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Voice is required"})}
    if len(text) > 2500:
        headers["Content-Type"] = "application/json"
        return {"statusCode": 413, "headers": headers, "body": json.dumps({"error": "Text quá dài (>2500 ký tự). Hãy chia thành các đoạn nhỏ hơn."})}

    try:
        audio_bytes = asyncio.run(_synthesize(text, voice, rate, pitch))
        if not audio_bytes or len(audio_bytes) < 100:
            headers["Content-Type"] = "application/json"
            return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": "Không tạo được âm thanh (buffer quá nhỏ). Thử lại với giọng khác."})}
        headers["Content-Type"] = "audio/mpeg"
        headers["Cache-Control"] = "public, max-age=3600"
        return {
            "statusCode": 200,
            "headers": headers,
            "body": base64.b64encode(audio_bytes).decode("ascii"),
            "encoding": "base64",
        }
    except Exception as e:
        headers["Content-Type"] = "application/json"
        tb = traceback.format_exc()
        return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": f"{e}", "trace": tb[:500]})}
