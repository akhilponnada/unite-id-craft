import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const THEME_PROMPTS: Record<string, string> = {
  "Dark Premium":
    "ultra-premium dark cinematic composition, deep charcoal and obsidian background, warm gold accents, faint architectural lines of a luxury gated community at dusk, abstract solar panel grid silhouette, subtle volumetric light, magazine cover quality",
  "Corporate Blue":
    "clean corporate composition, deep navy blue background with bright cyan accents, structured geometric grid, modern apartment community skyline silhouette, minimal solar panel array, professional trust-building mood, soft daylight",
  "Green":
    "vibrant sustainability composition, lush emerald green and soft teal palette with white accents, leaves growing into solar panel patterns, eco-friendly residential community at golden hour, fresh and optimistic",
  "Luxury Gold":
    "opulent luxury composition, rich champagne gold and warm cream tones over deep brown, premium gated community villas at sunrise, refined solar panels integrated as architectural feature, aspirational wealth feel, soft glow",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { theme, communityName, location, capacityKw } = await req.json();

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const styleLine = THEME_PROMPTS[theme] || THEME_PROMPTS["Dark Premium"];

    const prompt = `Premium A4 landscape cover artwork for a Unite Solar gated-community proposal.
Theme: ${theme}. Style: ${styleLine}.
Composition: cinematic wide landscape, generous negative space on the LEFT and BOTTOM for title and stats overlay (no text in the image).
Mood inspired by community "${communityName || "Premium Community"}" in "${location || ""}", ${capacityKw || ""}kW solar installation.
Strict rules: NO text, NO logos, NO watermarks, NO people faces. Ultra-detailed, photoreal, magazine cover quality.`;

    const response = await fetch(AZURE_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AZURE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        size: "1792x1024",
        quality: "high",
        n: 1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Azure image error:", response.status, t);
      throw new Error(`Image generation error: ${response.status}`);
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image was generated. Try a different theme.");

    const imageUrl = `data:image/png;base64,${b64}`;
    return new Response(JSON.stringify({ image: imageUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-community-cover error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
