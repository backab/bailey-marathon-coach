export async function onRequestGet(context) {
  // 1. THE BOUNCER: Check for the Zendesk Secret Key
  const expectedAuth = 'Bearer zendesk-coach-secret-99';
  const requestAuth = context.request.headers.get('Authorization');
  
  if (requestAuth !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized AI Access" }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 2. FETCH THE DATA: Pull from your Cloudflare KV Database
    const rawData = await context.env.COACH_DB.get('baileyCoachData_v2');
    let workouts = rawData ? JSON.parse(rawData) : [];

    // 3. AI OPTIMIZATION: Only send the completed runs, and only the latest 30
    let completedRuns = workouts.filter(w => w.actualMiles);
    completedRuns.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentRuns = completedRuns.slice(0, 30);

    // 4. RETURN TO ZENDESK: Send the clean data payload
    return new Response(JSON.stringify(recentRuns), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to fetch database" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// --- NEW: Handle incoming data from the website and save it to the database ---
export async function onRequestPost(context) {
  try {
    // 1. Read the JSON data sent from your frontend website
    const data = await context.request.json();
    
    // 2. Save it directly into your Cloudflare KV Database
    await context.env.COACH_DB.put('baileyCoachData_v2', JSON.stringify(data));
    
    // 3. Send a thumbs up back to the website
    return new Response(JSON.stringify({ success: true, message: "Data securely saved to cloud" }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to save data to cloud" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
