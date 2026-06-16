module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' });
    return;
  }

  const { image, mediaType } = req.body || {};
  if (!image || !mediaType) {
    res.status(400).json({ error: 'Missing image or mediaType' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const prompt = `This is a screenshot of an Instagram post about a nightlife event in Skopje, Macedonia. Today's date is ${today}.

Read all text visible in the image and extract event data. Always return the venue/place name in Latin script (not Cyrillic). Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "event name",
  "place": "venue name",
  "kategorija": "klub|koncert|bar|kafana",
  "datum": "YYYY-MM-DD",
  "vreme": "HH:MM",
  "badge": "entry price or free entry info, or empty string",
  "desc": "short description in Macedonian, max 100 chars",
  "instagramUrl": "instagram URL if visible, else empty string",
  "caption": "generated Instagram caption in Macedonian with emojis, hook line with no ending punctuation, then venue + date + time with emojis, then reservation contact if found, then hashtags: #skopje #скопје #SkopjeVibes #skopjevibes #ноќенживот"
}

If a field is not found, use empty string. For kategorija, guess from context. For datum, if only day/month visible, use next upcoming date.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
