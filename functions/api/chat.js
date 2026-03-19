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

   // ... (Keep Steps 1, 2, and 3 exactly the same) ...

// 4. Send the prompt, the data, and the question directly to Claude
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': context.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', 
        max_tokens: 500,
        system: `You are Bailey's elite Sub-3 marathon coach. Be direct, analytical, and highly encouraging. Use this JSON database of Bailey's recent runs to answer questions: ${JSON.stringify(recentRuns)}`,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    const claudeData = await claudeResponse.json();

    // 🛑 INDESTRUCTIBLE DEBUGGER: Catch any weird API rejections
    if (claudeData.type === 'error' || claudeData.error) {
       throw new Error(`Claude API blocked it: ${JSON.stringify(claudeData.error || claudeData)}`);
    }
    if (!claudeData.content || !claudeData.content) {
       throw new Error(`CLAUDE DEBUG (Unexpected Format): ${JSON.stringify(claudeData)}`);
    }

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

    const claudeData = await claudeResponse.json();

    // NEW CATCH: If Claude sends an error instead of a response, print it!
    if (claudeData.error) {
       throw new Error(`Claude API blocked it: ${claudeData.error.message}`);
    }

   // 5. Return Claude's answer back to your website
const aiReply = claudeData.content.text;

    return new Response(JSON.stringify({ reply: aiReply }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    // This will now print Claude's exact complaint to your browser console
    return new Response(JSON.stringify({ error: error.message || error.toString() }), { status: 500 });
  }
}
