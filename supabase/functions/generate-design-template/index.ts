import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KIND_HINTS: Record<string, string> = {
  flyer:
    "A4 portrait single-page promotional flyer (aspect 1:1.414). Bold hero area at top, supporting visual mid-page, contact / CTA strip near bottom.",
  brochure:
    "A4 landscape brochure page (aspect 1.414:1) suitable as one panel of a tri-fold. Clear section blocks, generous margins.",
  presentation:
    "16:9 widescreen presentation slide (aspect 1920:1080). Large headline area top-left, supporting visual right, footer band at bottom.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, kind } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const k = (kind || "flyer") as keyof typeof KIND_HINTS;
    const hint = KIND_HINTS[k] || KIND_HINTS.flyer;

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const fullPrompt = `Design a professional ${k} background template. ${hint}
User brief: ${prompt.trim()}.
Leave clear empty zones for headline text, body text, and a logo area so text can be overlaid later.
Print-ready, clean typography hints, modern, on-brand for a solar / clean-energy company.`;

    const r = await fetch(AZURE_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AZURE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        size: k === "presentation" ? "1792x1024" : "1024x1792",
        quality: "high",
        n: 1,
      }),
    });

    if (!r.ok) {
      if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await r.text();
      console.error("Azure image error:", r.status, t);
      throw new Error(`Image generation error: ${r.status}`);
    }

    const data = await r.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image generated");

    const imageUrl = `data:image/png;base64,${b64}`;
    return new Response(JSON.stringify({ image: imageUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
