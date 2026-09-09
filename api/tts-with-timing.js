/**
 * Vercel Node.js Serverless Function: POST /api/tts-with-timing
 * Spawns Python edge-tts with word boundary timestamps (same pattern as server.js)
 * Returns: JSON { audio: "base64...", timing: [{word, start_ms, end_ms}, ...] }
 */
import { spawn } from 'child_process';

const PYTHON_SCRIPT = `
import sys, asyncio, json, time
import edge_tts
async def main():
    raw = sys.stdin.buffer.read().decode("utf-8")
    payload = json.loads(raw)
    t = payload["text"]
    v = payload["voice"]
    r = payload["rate"]
    p = payload["pitch"]
    comm = edge_tts.Communicate(t, v, rate=r, pitch=p)
    out_buf = bytearray()
    words = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            out_buf.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({
                "word": chunk.get("text", ""),
                "offset_ms": chunk.get("offset", 0) / 10000,
                "duration_ms": chunk.get("duration", 0) / 10000,
            })
    import base64
    result = {
        "audio_b64": base64.b64encode(bytes(out_buf)).decode("ascii"),
        "timing": words,
    }
    sys.stdout.buffer.write(json.dumps(result).encode("utf-8"))
    sys.stdout.buffer.flush()
asyncio.run(main())
`;

function getSafeParam(val, fallback, safePattern) {
  const s = String(val || fallback).trim();
  if (!s) return fallback;
  return s.replace(safePattern, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { text, voice, rate, pitch } = req.body || {};
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return res.status(400).json({ error: 'Text is required' });
  }
  if (cleanText.length > 2500) {
    return res.status(413).json({ error: 'Text quá dài (>2500 ký tự). Hãy chia thành các đoạn nhỏ hơn.' });
  }

  const safeVoice = getSafeParam(voice, 'en-US-AriaNeural', /[^\w-]/g);
  const safeRate = getSafeParam(rate, '+0%', /[^\w%+\-.]/g);
  const safePitch = getSafeParam(pitch, '+0Hz', /[^\wHz+\-.]/g);

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', PYTHON_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 100 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });

      const chunks = [];
      const errOut = [];

      child.stdout.on('data', (d) => chunks.push(d));
      child.stderr.on('data', (d) => errOut.push(d));

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Timeout: Python TTS mất quá nhiều thời gian (>45s)'));
      }, 45000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const errMsg = errOut.join('').slice(-3000);
          reject(new Error(`Python exited code ${code}: ${errMsg}`));
        } else if (chunks.length === 0) {
          reject(new Error('Không nhận được dữ liệu từ Python'));
        } else {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        }
      });

      child.on('error', (e) => {
        clearTimeout(timeout);
        reject(new Error(`Spawn error: ${e.message}`));
      });

      const payloadJson = JSON.stringify({
        text: cleanText,
        voice: safeVoice,
        rate: safeRate,
        pitch: safePitch,
      });
      child.stdin.write(Buffer.from(payloadJson, 'utf-8'));
      child.stdin.end();
    });

    if (!result.audio_b64 || result.audio_b64.length < 100) {
      return res.status(500).json({ error: 'Không tạo được âm thanh (buffer quá nhỏ). Thử lại với giọng khác.' });
    }

    return res.status(200).json({
      audio: result.audio_b64,
      timing: result.timing || [],
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      trace: err.stack ? err.stack.slice(0, 500) : '',
    });
  }
}