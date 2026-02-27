// File: functions/api/strava.js

export async function onRequestGet(context) {
  // 1. Grab your secret keys from Cloudflare's secure environment
  const clientId = context.env.STRAVA_CLIENT_ID;
  const clientSecret = context.env.STRAVA_CLIENT_SECRET;
  const refreshToken = context.env.STRAVA_REFRESH_TOKEN;

  try {
    // 2. Ask Strava for a brand new Access Token using your Refresh Token
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
    const freshAccessToken = tokenData.access_token;

    // 3. Use the fresh token to fetch your last 30 runs!
    const activitiesResponse = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
      headers: { "Authorization": `Bearer ${freshAccessToken}` }
    });

    const activities = await activitiesResponse.json();

    // 4. Send the runs back to your frontend dashboard
    return new Response(JSON.stringify(activities), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Strava Sync Failed" }), { status: 500 });
  }
}