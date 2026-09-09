import WebSocket from 'ws';
import crypto from 'crypto';

function uuidv4() {
  // Fallback cho crypto.randomUUID() trên Node.js 18
  try {
    return crypto.randomUUID();
  } catch (_) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

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

  const timeout = setTimeout(() => {
    if (!res.writableEnded) {
      res.status(504).json({ error: 'Request timeout (>9s). Vui lòng thử lại.', trace: '' });
    }
  }, 9000);

  try {
    const audioBuffer = await _synthesize(text, voice, rate, pitch);
    clearTimeout(timeout);
    if (!res.writableEnded) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      return res.status(200).send(audioBuffer);
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

function buildSsml(text, voice, rate, pitch) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="${voice}">
      <prosody rate="${rate}" pitch="${pitch}" volume="+0%">${escaped}</prosody>
    </voice>
  </speak>`;
}

function _synthesize(text, voice, rate, pitch) {
  const connectionId = uuidv4();
  const wsUrl = `wss://speech.platform.bing.com/connect?TrustedClientToken=&ConnectionId=${connectionId}`;

  return new Promise((resolve, reject) => {
    let audioChunks = [];
    let settled = false;
    let ws;

    const done = (err, buf) => {
      if (settled) return;
      settled = true;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch (_) {}
      }
      if (err) reject(err);
      else resolve(buf);
    };

    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'https://azure.microsoft.com',
        },
      });
    } catch (err) {
      return done(new Error('Không thể tạo WebSocket: ' + (err.message || err)));
    }

    const wsTimeout = setTimeout(() => {
      done(new Error('Microsoft TTS không phản hồi (timeout 8s)'));
    }, 8000);

    ws.on('open', () => {
      // Gửi speech.config
      const configMsg = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
            },
          },
        },
      });
      ws.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' + configMsg);

      // Gửi SSML
      const ssml = buildSsml(text, voice, rate, pitch);
      ws.send('Content-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n' + ssml);

      // Gửi turn.end
      ws.send('Content-Type:application/x-microsoft-speech-session-end\r\nPath:turn.end\r\n\r\n');
    });

    ws.on('message', (data) => {
      if (data instanceof Buffer || data instanceof Uint8Array) {
        if (data.length > 2) {
          const headerLen = data[1];
          const audioData = data.slice(2 + headerLen);
          if (audioData.length > 0) {
            audioChunks.push(audioData);
          }
        }
      } else {
        const msg = data.toString();
        if (msg.includes('turn.end')) {
          clearTimeout(wsTimeout);
          const final = audioChunks.length > 0 ? Buffer.concat(audioChunks) : Buffer.alloc(0);
          done(null, final);
        } else if (msg.includes('turn.start')) {
          // Bắt đầu nhận audio
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(wsTimeout);
      done(new Error('WebSocket lỗi: ' + (err.message || err)));
    });

    ws.on('close', (code, reason) => {
      clearTimeout(wsTimeout);
      if (!settled) {
        if (audioChunks.length > 0) {
          const final = Buffer.concat(audioChunks);
          done(null, final);
        } else {
          done(new Error('WebSocket đóng đột ngột (code=' + code + ', reason=' + (reason || '').toString() + ')'));
        }
      }
    });
  });
}