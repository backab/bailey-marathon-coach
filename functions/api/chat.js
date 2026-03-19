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

  // 4. Send the prompt to your Company's Internal Bedrock Gateway
    const claudeResponse = await fetch('https://ai-gateway.zende.sk/bedrock/model/us.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke', {
      method: 'POST',
      headers: {
        // Internal gateways typically use standard Bearer authorization
        'Authorization': `Bearer ${context.env.CLAUDE_API_KEY}`, 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31', // Bedrock requires this here, not in the headers
        max_tokens: 500,
        system: `You are Bailey's elite Sub-3 marathon coach. Be direct, analytical, and highly encouraging. Use this JSON database of Bailey's recent runs to answer questions: ${JSON.stringify(recentRuns)}`,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });
    
    // 5. Safely return Claude's answer back to your website
    const aiReply = claudeData.content.text;

    return new Response(JSON.stringify({ reply: aiReply }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    // This will print Claude's exact complaint to your browser console
    return new Response(JSON.stringify({ error: error.message || error.toString() }), { status: 500 });
  }
}
