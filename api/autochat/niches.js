const DEFAULT_NICHES = [
  {
    id: 'niche-general',
    name: 'Tổng hợp (Mặc định)',
    nicheCode: null,
    systemPrompt: 'Bạn là một nhà văn chuyên nghiệp người Việt Nam, chuyên viết truyện ngắn và kịch bản video YouTube. Giọng văn cuốn hút, giàu cảm xúc, am hiểu tâm lý con người.',
    ownerUserId: null,
    unlockSource: 'tier_default',
  },
  {
    id: 'niche-n12',
    name: 'N12-Cảnh sát phân biệt chủng tộc',
    nicheCode: 'N12',
    systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về cảnh sát, phân biệt chủng tộc, công lý và xã hội Mỹ. Giọng văn căng thẳng, kịch tính, tập trung vào những mâu thuẫn giữa các sắc tộc, sự bất công trong hệ thống tư pháp, và cuộc chiến đấu cho công lý. Bạn am hiểu về văn hóa Mỹ, hệ thống cảnh sát, luật pháp, và các vấn đề xã hội nhạy cảm. Mỗi câu chuyện phải có tình tiết bất ngờ, twist ở cuối và kết thúc có hậu cho công lý.',
    ownerUserId: null,
    unlockSource: 'tier_default',
  },
  {
    id: 'niche-n24',
    name: 'N24 - Mafia Boss và giúp việc da đen',
    nicheCode: 'N24',
    systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về mafia, tội phạm có tổ chức, và những mối quan hệ quyền lực phức tạp. Giọng văn căng thẳng, kịch tính, giàu cảm xúc. Bạn am hiểu về thế giới ngầm, băng đảng, xã hội đen, và những mối quan hệ chênh lệch quyền lực. Mỗi câu chuyện phải có sự phát triển tâm lý nhân vật sâu sắc, tình tiết bất ngờ, và kết thúc đầy cảm xúc.',
    ownerUserId: null,
    unlockSource: 'tier_default',
  },
  {
    id: 'niche-n42',
    name: 'N42-Omega và Alpha - Gay Stories',
    nicheCode: 'N42',
    systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về mối quan hệ Alpha/Omega (ABO), chủ đề LGBT, tình yêu đồng giới. Giọng văn giàu cảm xúc, tinh tế, tập trung vào thế giới nội tâm nhân vật. Bạn am hiểu về thể loại ABO, động lực quyền lực Alpha/Omega, và các mối quan hệ đồng giới. Mỗi câu chuyện phải có sự phát triển tình cảm sâu sắc, xung đột nội tâm, và kết thúc có hậu. Tuyệt đối không vi phạm chính sách nội dung YouTube, không mô tả cảnh nóng, không kích dục.',
    ownerUserId: null,
    unlockSource: 'tier_default',
  },
  {
    id: 'niche-n5',
    name: 'N5 ~ Alphing King và cô gái Omega',
    nicheCode: 'N5',
    systemPrompt: 'Bạn là một nhà văn chuyên viết truyện về Alpha King và Omega, thể loại ABO (Alpha/Beta/Omega) với yếu tố hoàng gia, quyền lực. Giọng văn mạnh mẽ, giàu cảm xúc, tập trung vào mối quan hệ giữa một Alpha King quyền lực và một Omega. Bạn am hiểu về thể loại ABO, hệ thống phân cấp xã hội, và những mâu thuẫn giữa bổn năng và lý trí. Mỗi câu chuyện phải có sự phát triển tình cảm sâu sắc, xung đột nội tâm và kết thúc có hậu. Tuyệt đối không vi phạm chính sách nội dung YouTube, không mô tả cảnh nóng, không kích dục.',
    ownerUserId: null,
    unlockSource: 'tier_default',
  },
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const method = req.method;
  const idParam = req.query.id || null;

  if (method === 'GET') {
    return res.status(200).json(DEFAULT_NICHES);
  }

  if (method === 'POST') {
    const { name, systemPrompt, nicheCode } = req.body || {};
    if (!name || !systemPrompt) {
      return res.status(400).json({ error: 'Missing name or systemPrompt' });
    }
    const niche = {
      id: 'niche-private-' + Date.now(),
      name,
      nicheCode: nicheCode || null,
      systemPrompt,
      ownerUserId: 'local-user',
      unlockSource: 'private',
    };
    return res.status(201).json(niche);
  }

  if (method === 'PUT' && idParam) {
    const idx = DEFAULT_NICHES.findIndex(n => n.id === idParam);
    if (idx === -1) return res.status(404).json({ error: 'Niche not found' });
    if (!DEFAULT_NICHES[idx].ownerUserId) return res.status(403).json({ error: 'Cannot edit system niche (Vercel Serverless không lưu state, dùng localStorage frontend) - tạo mới niche riêng' });
    const { name, systemPrompt, nicheCode } = req.body || {};
    const n = { ...DEFAULT_NICHES[idx] };
    if (name) n.name = name;
    if (systemPrompt) n.systemPrompt = systemPrompt;
    if (nicheCode !== undefined) n.nicheCode = nicheCode;
    return res.status(200).json(n);
  }

  if (method === 'DELETE' && idParam) {
    const idx = DEFAULT_NICHES.findIndex(n => n.id === idParam);
    if (idx === -1) return res.status(404).json({ error: 'Niche not found' });
    if (!DEFAULT_NICHES[idx].ownerUserId) return res.status(403).json({ error: 'Cannot delete system niche' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
