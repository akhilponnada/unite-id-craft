import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientName, location, capacity, projectType, prompt } = await req.json();

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const fullPrompt =
      prompt?.trim() ||
      `Premium A4 vertical cover page artwork for a solar energy proposal by Unite Solar.
Theme: futuristic, corporate, clean. Colors: deep navy blue, vibrant green, white accents.
Visual: a modern solar panel array under a glowing sun with subtle circuit/grid patterns,
abstract energy lines flowing across the composition. Leave generous empty space at the
top-center for a logo and at the bottom for a title overlay (no text in the image).
Project context to inspire mood only (do not render as text):
client "${clientName || "Client"}", location "${location || ""}", capacity ${capacity || ""}kW, ${projectType || ""} system.
Style: cinematic, ultra-detailed, vector-meets-photoreal, soft volumetric light, magazine cover quality.`;

    const response = await fetch(AZURE_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AZURE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        size: "1024x1792",
        quality: "high",
        n: 1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await response.text();
      console.error("Azure image error:", response.status, errText);
      throw new Error(`Image generation error: ${response.status}`);
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image was generated. Try a different prompt.");

    const imageUrl = `data:image/png;base64,${b64}`;
    return new Response(JSON.stringify({ image: imageUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-proposal-cover error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
