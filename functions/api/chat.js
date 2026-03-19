export async function onRequestPost(context) {
  try {
    // 1. Read the user's message from the frontend
    const { message } = await context.request.json();
    
    // 2. Fetch Bailey's running data from Cloudflare KV
    const rawData = await context.env.COACH_DB.get('baileyCoachData_v2');
    const workouts = rawData ? JSON.parse(rawData) : [];
    
    // 3. Optimize the data payload (Latest 30 completed runs)
    let completedRuns = workouts.filter(w => w.actualMiles);
    completedRuns.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentRuns = completedRuns.slice(0, 30);

    // 4. Send the prompt, the data, and the question directly to Claude
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': context.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Haiku is incredibly fast, or use sonnet-20240229
        max_tokens: 500,
        system: `You are Bailey's elite Sub-3 marathon coach. Be direct, analytical, and highly encouraging. Use this JSON database of Bailey's recent runs to answer questions: ${JSON.stringify(recentRuns)}`,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    // 5. Return Claude's answer back to your website
    const claudeData = await claudeResponse.json();
    const aiReply = claudeData.content.text;

    return new Response(JSON.stringify({ reply: aiReply }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Coach is currently offline." }), { status: 500 });
  }
}
