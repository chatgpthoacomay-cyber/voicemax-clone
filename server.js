const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack?.substring(0, 300));
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err.message, err.stack?.substring(0, 300));
});

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =============== EDGE TTS (Python edge-tts via child_process - ổn định) ===============
const { spawn } = require('child_process');
const os = require('os');

const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

function synthesize(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    const clean = String(text || '').trim();
    const safeVoice = String(voice || 'en-US-AriaNeural').replace(/[^\w-]/g, '');
    const safeRate = String(rate || '+0%').replace(/[^\w%+\-.]/g, '');
    const safePitch = String(pitch || '+0Hz').replace(/[^\wHz+\-.]/g, '');

    const pyScript = `
import sys, asyncio, json
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
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            out_buf.extend(chunk["data"])
    sys.stdout.buffer.write(bytes(out_buf))
    sys.stdout.buffer.flush()

asyncio.run(main())
`;
    const args = ['-c', pyScript];
    let child;
    const TIMEOUT_MS = 45000;
    const timer = setTimeout(() => {
      try { if (child) child.kill('SIGKILL'); } catch(e){}
      reject(new Error('TTS timeout (45s) - text quá dài, hãy chia chunk nhỏ hơn'));
    }, TIMEOUT_MS);
    const chunks = [];
    const errOut = [];
    try {
      child = spawn(PYTHON_CMD, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 100 * 1024 * 1024,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
      });
      const payloadJson = JSON.stringify({ text: clean, voice: safeVoice, rate: safeRate, pitch: safePitch });
      child.stdin.write(Buffer.from(payloadJson, 'utf-8'));
      child.stdin.end();
    } catch (e) { clearTimeout(timer); return reject(e); }
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => errOut.push(d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('spawn err: ' + e.message)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const err = (Buffer.concat(errOut.map(s => Buffer.from(s))).toString()).trim() || `exit code ${code} signal ${signal}`;
        reject(new Error('EdgeTTS Python error: ' + err.substring(0, 3000)));
      }
    });
  });
}

// Static voices list
const VOICES = require('./api/voices.js').VOICES || null;
const DEFAULT_VOICES = [
  { Name: 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)', ShortName: 'en-US-AriaNeural', Gender: 'Female', Locale: 'en-US', FriendlyName: 'Microsoft AriaNeural (Female) en-US' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)', ShortName: 'en-US-GuyNeural', Gender: 'Male', Locale: 'en-US', FriendlyName: 'Microsoft GuyNeural (Male) en-US' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)', ShortName: 'en-US-JennyNeural', Gender: 'Female', Locale: 'en-US', FriendlyName: 'Microsoft JennyNeural (Female) en-US' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (en-US, DavisNeural)', ShortName: 'en-US-DavisNeural', Gender: 'Male', Locale: 'en-US', FriendlyName: 'Microsoft DavisNeural (Male) en-US' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (vi-VN, HoaiMyNeural)', ShortName: 'vi-VN-HoaiMyNeural', Gender: 'Female', Locale: 'vi-VN', FriendlyName: 'Microsoft HoaiMyNeural (Female) vi-VN' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (vi-VN, NamMinhNeural)', ShortName: 'vi-VN-NamMinhNeural', Gender: 'Male', Locale: 'vi-VN', FriendlyName: 'Microsoft NamMinhNeural (Male) vi-VN' },
];

app.get('/api/voices', async (req, res) => {
  try {
    // Try to load from the api/voices.js static list if it exports via CommonJS fallback
    const fs = require('fs');
    const voicesFile = fs.readFileSync(path.join(__dirname, 'api', 'voices.js'), 'utf-8');
    const match = voicesFile.match(/const VOICES = (\[[\s\S]*?\]);/);
    if (match) {
      try {
        const list = eval(match[1]);
        if (Array.isArray(list) && list.length > 0) return res.json(list);
      } catch (e) {}
    }
    res.json(DEFAULT_VOICES);
  } catch (err) {
    console.error('Error fetching voices:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, rate = '+0%', pitch = '+0Hz' } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text is required' });
    if (!voice) return res.status(400).json({ error: 'Voice is required' });
    const cleanText = String(text).trim();
    if (cleanText.length > 2500) return res.status(413).json({ error: 'Text quá dài (>2500 ký tự). Hãy chia thành các đoạn nhỏ hơn.' });
    console.log(`TTS: ${cleanText.substring(0, 50)}... voice=${voice} rate=${rate} pitch=${pitch}`);
    const audioBuffer = await synthesize(cleanText, voice, rate, pitch);
    if (!audioBuffer || audioBuffer.length < 100) return res.status(500).json({ error: 'Không tạo được âm thanh (buffer quá nhỏ). Thử lại với giọng khác.' });
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
    res.send(audioBuffer);
  } catch (err) {
    console.error('TTS Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts-with-timing', async (req, res) => {
  try {
    const { text, voice, rate = '+0%', pitch = '+0Hz' } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text is required' });
    if (!voice) return res.status(400).json({ error: 'Voice is required' });
    const cleanText = String(text).trim();
    if (cleanText.length > 2500) return res.status(413).json({ error: 'Text quá dài (>2500)' });
    const audioBuffer = await synthesize(cleanText, voice, rate, pitch);
    res.json({ audio: Array.from(new Uint8Array(audioBuffer)), boundaries: [], duration: 0 });
  } catch (err) {
    console.error('TTS With Timing Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============== AUTOCHAT / AI GENERATE ===============
app.post('/api/autochat/generate', async (req, res) => {
  try {
    const { provider, apiKey, model, prompt, systemPrompt, messages: rawMessages } = req.body;
    const hasMultiTurn = Array.isArray(rawMessages) && rawMessages.length > 0;
    if (!provider || !apiKey || (!prompt && !hasMultiTurn)) {
      return res.status(400).json({ error: 'Missing required fields: provider, apiKey, and prompt (or messages array)' });
    }
    let messages;
    if (hasMultiTurn) {
      messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      for (const m of rawMessages) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          messages.push({ role: m.role, content: m.content });
        }
      }
    } else {
      console.log(`AutoChat: provider=${provider} model=${model || 'default'} hasSystemPrompt=${!!systemPrompt} prompt=${(prompt||'').substring(0, 60)}...`);
      messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });
    }
    if (hasMultiTurn) {
      const last = messages[messages.length - 1];
      const preview = last && typeof last.content === 'string' ? last.content.substring(0, 60) : '';
      console.log(`AutoChat (multi): provider=${provider} model=${model || 'default'} turns=${messages.length} last=${preview}...`);
    }
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'gpt-4o-mini', messages, temperature: 0.7 }),
      });
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `OpenAI API error (${response.status}): ${err}` });
      }
      const data = await response.json();
      return res.json({ content: data.choices[0].message.content });
    } else if (provider === 'gemini') {
      const geminiModel = model || 'gemini-1.5-flash-latest';
      const systemParts = [];
      const contents = [];
      let pendingUser = null;
      for (const m of messages) {
        if (m.role === 'system') {
          systemParts.push({ text: m.content });
        } else if (m.role === 'user') {
          if (pendingUser) pendingUser.parts.push({ text: '\n\n' + m.content });
          else pendingUser = { role: 'user', parts: [{ text: m.content }] };
        } else if (m.role === 'assistant') {
          if (pendingUser) { contents.push(pendingUser); pendingUser = null; }
          contents.push({ role: 'model', parts: [{ text: m.content }] });
        }
      }
      if (pendingUser) contents.push(pendingUser);
      const body = { contents, generationConfig: { temperature: 0.7 } };
      if (systemParts.length > 0) body.system_instruction = { parts: systemParts };
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Gemini API error (${response.status}): ${err}` });
      }
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map?.(p => p.text || '').join('')
        || data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({ content: text });
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
  } catch (err) {
    console.error('AutoChat Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============== NICHES (Default static list, CRUD stored client-side in localStorage) ===============
const DEFAULT_NICHES = [
  { id: 'niche-general', name: 'Tổng hợp (Mặc định)', nicheCode: null, systemPrompt: 'Bạn là một nhà văn chuyên nghiệp người Việt Nam, chuyên viết truyện ngắn và kịch bản video YouTube. Giọng văn cuốn hút, giàu cảm xúc, am hiểu tâm lý con người.', ownerUserId: null, unlockSource: 'tier_default' },
  { id: 'niche-n12', name: 'N12-Cảnh sát phân biệt chủng tộc', nicheCode: 'N12', systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về cảnh sát, phân biệt chủng tộc, công lý và xã hội Mỹ. Giọng văn căng thẳng, kịch tính, tập trung vào những mâu thuẫn giữa các sắc tộc, sự bất công trong hệ thống tư pháp, và cuộc chiến đấu cho công lý. Bạn am hiểu về văn hóa Mỹ, hệ thống cảnh sát, luật pháp, và các vấn đề xã hội nhạy cảm. Mỗi câu chuyện phải có tình tiết bất ngờ, twist ở cuối và kết thúc có hậu cho công lý.', ownerUserId: null, unlockSource: 'tier_default' },
  { id: 'niche-n24', name: 'N24 - Mafia Boss và giúp việc da đen', nicheCode: 'N24', systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về mafia, tội phạm có tổ chức, và những mối quan hệ quyền lực phức tạp. Giọng văn căng thẳng, kịch tính, giàu cảm xúc. Bạn am hiểu về thế giới ngầm, băng đảng, xã hội đen, và những mối quan hệ chênh lệch quyền lực. Mỗi câu chuyện phải có sự phát triển tâm lý nhân vật sâu sắc, tình tiết bất ngờ, và kết thúc đầy cảm xúc.', ownerUserId: null, unlockSource: 'tier_default' },
  { id: 'niche-n42', name: 'N42-Omega và Alpha - Gay Stories', nicheCode: 'N42', systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về mối quan hệ Alpha/Omega (ABO), chủ đề LGBT, tình yêu đồng giới. Giọng văn giàu cảm xúc, tinh tế, tập trung vào thế giới nội tâm nhân vật. Bạn am hiểu về thể loại ABO, động lực quyền lực Alpha/Omega, và các mối quan hệ đồng giới. Mỗi câu chuyện phải có sự phát triển tình cảm sâu sắc, xung đột nội tâm, và kết thúc có hậu. Tuyệt đối không vi phạm chính sách nội dung YouTube, không mô tả cảnh nóng, không kích dục.', ownerUserId: null, unlockSource: 'tier_default' },
  { id: 'niche-n5', name: 'N5 ~ Alphing King và cô gái Omega', nicheCode: 'N5', systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về Alpha King và Omega, thể loại ABO (Alpha/Beta/Omega) với yếu tố hoàng gia, quyền lực. Giọng văn mạnh mẽ, giàu cảm xúc, tập trung vào mối quan hệ giữa một Alpha King quyền lực và một Omega. Bạn am hiểu về thể loại ABO, hệ thống phân cấp xã hội, và những mâu thuẫn giữa bổn năng và lý trí. Mỗi câu chuyện phải có sự phát triển tình cảm sâu sắc, xung đột nội tâm và kết thúc có hậu. Tuyệt đối không vi phạm chính sách nội dung YouTube, không mô tả cảnh nóng, không kích dục.', ownerUserId: null, unlockSource: 'tier_default' },
];

app.get('/api/autochat/niches', (req, res) => res.json(DEFAULT_NICHES));

app.post('/api/autochat/niches', (req, res) => {
  const { name, systemPrompt, nicheCode } = req.body || {};
  if (!name || !systemPrompt) return res.status(400).json({ error: 'Missing name or systemPrompt' });
  const niche = { id: 'niche-private-' + Date.now(), name, nicheCode: nicheCode || null, systemPrompt, ownerUserId: 'local-user', unlockSource: 'private' };
  res.status(201).json(niche);
});

app.put('/api/autochat/niches/:id', (req, res) => {
  const idx = DEFAULT_NICHES.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Niche not found' });
  if (!DEFAULT_NICHES[idx].ownerUserId) return res.status(403).json({ error: 'Cannot edit system niche (lưu niche riêng ở localStorage frontend)' });
  const { name, systemPrompt, nicheCode } = req.body || {};
  const n = { ...DEFAULT_NICHES[idx] };
  if (name) n.name = name;
  if (systemPrompt) n.systemPrompt = systemPrompt;
  if (nicheCode !== undefined) n.nicheCode = nicheCode;
  res.json(n);
});

app.delete('/api/autochat/niches/:id', (req, res) => {
  const idx = DEFAULT_NICHES.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Niche not found' });
  if (!DEFAULT_NICHES[idx].ownerUserId) return res.status(403).json({ error: 'Cannot delete system niche' });
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🎤 VoiceMax Clone (Node.js + Python edge-tts) đã chạy tại:`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Dùng Ctrl+C để dừng`);
});
