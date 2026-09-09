import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs';
import os from 'os';
import path from 'path';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text, voice, rate = '+0%', pitch = '+0Hz' } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Text is required' });
  if (!voice) return res.status(400).json({ error: 'Voice is required' });
  if (text.length > 2500) return res.status(413).json({ error: 'Text quá dài (>2500 ký tự).' });

  // Timeout: Vercel Hobby kills at 10s, respond before that
  const timeout = setTimeout(() => {
    if (!res.writableEnded) {
      res.status(504).json({ error: 'Request timeout (>9s). Vui lòng thử lại.', trace: '' });
    }
  }, 9000);

  try {
    const result = await _synthesize(text, voice, rate, pitch);
    clearTimeout(timeout);
    if (!res.writableEnded) {
      const b64 = result.audio.toString('base64');
      return res.status(200).json({ audio: b64, words: result.words });
    }
  } catch (err) {
    clearTimeout(timeout);
    if (!res.writableEnded) {
      return res.status(500).json({
        error: err.message || 'Internal server error',
        trace: (err.stack || '').slice(0, 2000),
      });
    }
  }
}

async function _synthesize(text, voice, rate, pitch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${attempt}.mp3`);
    const subFile = tmpFile + '.json';
    try {
      const tts = new EdgeTTS({
        voice,
        rate,
        pitch,
        volume: '+0%',
        lang: voice.startsWith('vi') ? 'vi-VN' : voice.slice(0, 5),
        saveSubtitles: true,
        timeout: 8000,
      });
      await tts.ttsPromise(text, tmpFile);
      const audioBuffer = fs.readFileSync(tmpFile);
      if (!audioBuffer || audioBuffer.length < 100) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error('Không tạo được âm thanh (buffer quá nhỏ).');
      }
      let words = [];
      try {
        const subData = fs.readFileSync(subFile, 'utf-8');
        words = JSON.parse(subData);
      } catch { /* subtitles file may not exist */ }
      return { audio: audioBuffer, words };
    } catch (err) {
      if (attempt < 2 && err.message?.includes('No audio')) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      try { fs.unlinkSync(subFile); } catch { /* ignore */ }
    }
  }
}