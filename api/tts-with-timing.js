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
        timeout: 30000,
      });
      await tts.ttsPromise(text, tmpFile);
      const audioBuffer = fs.readFileSync(tmpFile);
      if (!audioBuffer || audioBuffer.length < 100) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return res.status(500).json({ error: 'Không tạo được âm thanh (buffer quá nhỏ).' });
      }
      let words = [];
      try {
        const subData = fs.readFileSync(subFile, 'utf-8');
        words = JSON.parse(subData);
      } catch { /* subtitles file may not exist */ }

      const b64 = audioBuffer.toString('base64');
      return res.status(200).json({ audio: b64, words });
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res.status(500).json({
        error: err.message || 'Internal server error',
        trace: (err.stack || '').slice(0, 2000),
      });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      try { fs.unlinkSync(subFile); } catch { /* ignore */ }
    }
  }
}