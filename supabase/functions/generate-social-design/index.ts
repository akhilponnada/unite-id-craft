import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Format =
  | "instagram_post"
  | "instagram_story"
  | "facebook_post"
  | "linkedin_post"
  | "x_post"
  | "youtube_thumb";

const FORMAT_SPECS: Record<Format, { size: string; w: number; h: number; label: string }> = {
  instagram_post:  { size: "1024x1024", w: 1080, h: 1080, label: "Instagram Post (1:1)" },
  instagram_story: { size: "1024x1792", w: 1080, h: 1920, label: "Instagram Story (9:16)" },
  facebook_post:   { size: "1792x1024", w: 1200, h: 630,  label: "Facebook Post (1.91:1)" },
  linkedin_post:   { size: "1792x1024", w: 1200, h: 627,  label: "LinkedIn Post (1.91:1)" },
  x_post:          { size: "1792x1024", w: 1600, h: 900,  label: "X / Twitter Post (16:9)" },
  youtube_thumb:   { size: "1792x1024", w: 1280, h: 720,  label: "YouTube Thumbnail (16:9)" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, format } = await req.json() as { prompt: string; format: Format };

    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const spec = FORMAT_SPECS[format];
    if (!spec) {
      return new Response(JSON.stringify({ error: "Invalid format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY not configured");
    if (!AZURE_IMAGE_ENDPOINT) throw new Error("AZURE_IMAGE_ENDPOINT not configured");

    const fullPrompt = `${prompt.trim()}

Design a social media graphic for ${spec.label}. Modern, eye-catching, print-quality. Leave room for headline text. Solid clean composition.`;

    const r = await fetch(AZURE_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": AZURE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        size: spec.size,
        n: 1,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Azure image error:", r.status, t);
      if (r.status === 429) throw new Error("Rate limit hit. Try again in a moment.");
      throw new Error(`Image generation error (${r.status})`);
    }

    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned. Try a different prompt.");

    const imageDataUrl = `data:image/png;base64,${b64}`;

    return new Response(JSON.stringify({ image: imageDataUrl, format }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-social-design error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
