export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { provider, apiKey, model, prompt, systemPrompt, messages: rawMessages } = req.body || {};
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
      messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });
    }

    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `OpenAI API error (${response.status}): ${err}` });
      }

      const data = await response.json();
      return res.status(200).json({ content: data.choices[0].message.content });

    } else if (provider === 'gemini') {
      const geminiModel = model || 'gemini-1.5-flash-latest';

      const systemParts = [];
      const contents = [];
      let pendingUser = null;

      for (const m of messages) {
        if (m.role === 'system') {
          systemParts.push({ text: m.content });
        } else if (m.role === 'user') {
          if (pendingUser) {
            pendingUser.parts.push({ text: '\n\n' + m.content });
          } else {
            pendingUser = { role: 'user', parts: [{ text: m.content }] };
          }
        } else if (m.role === 'assistant') {
          if (pendingUser) {
            contents.push(pendingUser);
            pendingUser = null;
          }
          contents.push({ role: 'model', parts: [{ text: m.content }] });
        }
      }
      if (pendingUser) contents.push(pendingUser);

      const body = {
        contents,
        generationConfig: { temperature: 0.7 },
      };
      if (systemParts.length > 0) {
        body.system_instruction = { parts: systemParts };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Gemini API error (${response.status}): ${err}` });
      }

      const data = await response.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map?.(p => p.text || '').join('') ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        '';

      return res.status(200).json({ content: text });

    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

  } catch (err) {
    console.error('[AUTOCHAT ERROR]', err.message);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
}
