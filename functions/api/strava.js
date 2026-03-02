// File: functions/api/strava.js
export async function onRequestGet(context) {
  const clientId = context.env.STRAVA_CLIENT_ID;
  const clientSecret = context.env.STRAVA_CLIENT_SECRET;
  const refreshToken = context.env.STRAVA_REFRESH_TOKEN;

  try {
    const tokenResponse = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });

    const tokenData = await tokenResponse.json();

    // 🚨 DIAGNOSTIC CHECK: Did the token exchange fail?
    if (!tokenResponse.ok || !tokenData.access_token) {
        // Send the exact reason back to your frontend console!
        return new Response(JSON.stringify({ 
            message: "Backend Token Exchange Failed!", 
            strava_complaint: tokenData,
            // This tells us if Cloudflare is actually seeing your variables
            debug_variables_exist: {
                has_clientId: !!clientId,
                has_clientSecret: !!clientSecret,
                has_refreshToken: !!refreshToken
            }
        }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    const freshAccessToken = tokenData.access_token;

    const activitiesResponse = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
      headers: { "Authorization": `Bearer ${freshAccessToken}` }
    });

    const activities = await activitiesResponse.json();

    return new Response(JSON.stringify(activities), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Server Crashed", details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
