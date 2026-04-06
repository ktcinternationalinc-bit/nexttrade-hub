export async function GET() {
  return Response.json({ 
    status: 'working',
    has_key: !!process.env.ANTHROPIC_API_KEY,
    has_supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = body?.question;
    if (!question) return Response.json({ answer: 'No question received' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ answer: 'ANTHROPIC_API_KEY is not set in Vercel' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return Response.json({ answer: 'Anthropic error ' + response.status + ': ' + errText });
    }

    const data = await response.json();
    return Response.json({ answer: data.content?.[0]?.text || 'Empty response from AI' });
  } catch (err) {
    return Response.json({ answer: 'Server error: ' + err.message });
  }
}
