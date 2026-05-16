// Recommends 3 Google Font pairings (heading + body) that match the visual
// style of an uploaded business-card template image using Azure Claude Opus.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED = [
  "Inter", "Roboto", "Poppins", "Montserrat", "Playfair Display",
  "Lato", "Open Sans", "Oswald", "Raleway", "Merriweather",
  "Bebas Neue", "Nunito", "Source Sans 3", "Work Sans", "DM Sans",
  "Cormorant Garamond",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) throw new Error("imageUrl required");

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT") || "https://ai-akhilponnada2047ai102855017871.services.ai.azure.com/anthropic/v1/messages";
    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY not configured");

    // Fetch image and convert to base64
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) throw new Error("Failed to fetch image");
    const imgBuffer = await imgResponse.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
    const contentType = imgResponse.headers.get("content-type") || "image/png";

    const sys = `You are a typography expert. Given a business-card design, recommend 3 font pairings (heading + body) from this Google Fonts allowlist only: ${ALLOWED.join(", ")}. Match the design's mood (modern, classic, bold, elegant, technical, friendly, etc.).

Return a JSON object with a "pairings" array. Each pairing should have:
- heading: string (from allowlist)
- body: string (from allowlist)
- mood: string
- rationale: string

Return ONLY valid JSON, no markdown.`;

    const r = await fetch(AZURE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AZURE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: contentType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: "Recommend 3 font pairings for this card. Return as JSON.",
              },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Azure Claude error:", r.status, t);
      if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`Azure Claude ${r.status}`);
    }

    const data = await r.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON returned");

    const args = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ pairings: args.pairings || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recommend-fonts", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
