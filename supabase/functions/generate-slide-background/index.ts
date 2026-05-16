import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const THEME_STYLE: Record<string, string> = {
  "Dark Premium": "deep charcoal with warm gold and amber accents, cinematic premium mood",
  "Corporate Blue": "navy and cyan corporate palette, clean modern, structured, trustworthy",
  "Green": "lush emerald green and soft teal, sustainable optimistic eco palette",
  "Luxury Gold": "rich champagne gold, warm cream over deep brown, opulent magazine luxury feel",
};

function promptForSlide(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("cover")) return "panoramic aerial view of an Indian gated community at golden hour with rooftop solar arrays";
  if (t.includes("executive")) return "abstract upward financial growth lines with subtle solar glow and architectural geometry";
  if (t.includes("consumption")) return "stylised electricity meter and glowing power lines crossing a residential skyline at dusk";
  if (t.includes("solar potential") || t.includes("feasibility")) return "satellite-style top-down view of community rooftops bathed in sunlight, faint solar overlay";
  if (t.includes("capacity")) return "rows of crystalline solar panels glistening, futuristic clean energy installation";
  if (t.includes("solution") || t.includes("design")) return "isometric architectural rendering of a residential block with integrated solar roof, blueprint elements";
  if (t.includes("business model") || t.includes("model option")) return "abstract handshake silhouette with glowing infrastructure nodes connecting community and investor";
  if (t.includes("financial")) return "elegant financial infographic abstract: rising bar chart blended with rupee symbol and solar rays";
  if (t.includes("roi") || t.includes("savings")) return "stack of glowing rupee coins transforming into solar panels, warm light";
  if (t.includes("technical") || t.includes("architecture")) return "high-tech schematic of solar panels connecting to inverters and grid, holographic blueprint feel";
  if (t.includes("brand") || t.includes("technology")) return "tier-1 solar panels and modern inverters arranged like a premium product showcase";
  if (t.includes("service") || t.includes("maintenance")) return "engineer silhouette inspecting solar panels at sunrise, professional service mood";
  if (t.includes("ppa") || t.includes("flow")) return "elegant flow diagram abstraction: investor → unite solar → community, glowing interconnections";
  if (t.includes("benefit") || t.includes("ecosystem") || t.includes("win")) return "warm communal scene: families and apartment towers with sun rising behind solar rooftops";
  if (t.includes("implementation") || t.includes("plan")) return "calendar timeline abstract with construction & solar installation milestones, soft modern look";
  if (t.includes("conclusion") || t.includes("thank")) return "wide cinematic sunset over a solar-powered residential city, hopeful sustainable future";
  return "abstract premium solar energy and luxury residential community composition";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { theme, slideTitle } = await req.json();

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const style = THEME_STYLE[theme] || THEME_STYLE["Dark Premium"];
    const subject = promptForSlide(slideTitle || "");

    const prompt = `Premium A4 landscape background artwork for a solar proposal slide titled "${slideTitle}".
Subject: ${subject}.
Color & mood: ${style}.
Composition: cinematic, photoreal, generous dark/low-detail negative space across left half and bottom for text overlays. Soft vignette toward the edges so white text remains readable.
Strict rules: NO text, NO watermarks, NO logos, NO faces, NO charts/graphs as actual readable content. Treat text-area as smooth gradient. Magazine-cover quality.`;

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
    if (!b64) throw new Error("No image was generated.");

    const imageUrl = `data:image/png;base64,${b64}`;
    return new Response(JSON.stringify({ image: imageUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-slide-background error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
