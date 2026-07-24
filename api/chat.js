const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;

function buildSystemPrompt(spots) {
  const lines = (spots || []).map(s =>
    `- ${s.name}: score ${s.score}/100, onda ${s.wave} m, período ${s.period} s, swell ${s.swellDir}, vento ${s.wind} km/h ${s.windDir} (${s.windKind}), lotação ${s.crowd}`
  ).join('\n');

  return `Você é a IA do app "Os Mano Surf Report", que dá previsão de surf para as praias do Guarujá, SP.
Responda de forma direta e útil, em português do Brasil (a menos que perguntem em inglês), com tom de surfista experiente e conciso — sem enrolação.
Use os dados de hoje abaixo como sua única fonte de verdade sobre as condições atuais; não invente números que contradigam eles:

${lines}

Se perguntarem algo fora do escopo de surf/condições do Guarujá, responda brevemente e redirecione para o tema do app.`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ text: null, error: 'method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      text: 'A IA ainda não está configurada. Adicione a variável ANTHROPIC_API_KEY nas configurações do projeto no Vercel.'
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { messages, spots } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ text: null, error: 'missing messages' });
    return;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(spots),
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : 'erro desconhecido';
      res.status(200).json({ text: `Não consegui falar com a IA agora (${msg}).` });
      return;
    }

    const text = Array.isArray(data.content)
      ? data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      : '';

    res.status(200).json({ text: text || 'A IA não retornou uma resposta.' });
  } catch (err) {
    res.status(200).json({ text: 'Não consegui conectar à IA agora. Tente novamente em instantes.' });
  }
};
