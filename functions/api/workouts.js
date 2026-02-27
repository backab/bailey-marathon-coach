// File: functions/api/workouts.js

export async function onRequestGet(context) {
  // Read the saved workouts from Cloudflare KV
  const data = await context.env.COACH_DB.get("workouts");
  return new Response(data || "null", { 
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  // Save new workout updates to Cloudflare KV
  const newData = await context.request.text();
  await context.env.COACH_DB.put("workouts", newData);
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
}