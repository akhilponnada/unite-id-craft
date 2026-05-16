// Detects variable text-field zones (name, title, phone, email, etc.) on an
// uploaded business-card template image using Azure Claude Opus vision.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) throw new Error("imageUrl is required");

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT");
    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY not configured");

    // Fetch image and convert to base64
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) throw new Error("Failed to fetch image");
    const imgBuffer = await imgResponse.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
    const contentType = imgResponse.headers.get("content-type") || "image/png";

    const systemPrompt = `You analyze business / visiting card template images and identify EMPTY zones where variable text (Name, Title, Phone, Email, Website, Company, Address, Tagline) should be placed. Return positions as percentages (0-100) of image width/height. The origin (0,0) is the top-left corner. If a zone already has placeholder text, still return its bounding box. Return 4-8 zones max, in reading order.

Return a JSON object with a "zones" array. Each zone should have:
- role: "name" | "title" | "company" | "phone" | "email" | "website" | "address" | "tagline" | "other"
- x: number (0-100)
- y: number (0-100)
- width: number (0-100)
- height: number (0-100)
- font_size_pct: number (height of font as % of image height)
- text_align: "left" | "center" | "right"
- color_hex: string (suggested text color)

Return ONLY valid JSON, no markdown or explanation.`;

    const userPrompt = `Analyze this business card template and detect variable text fields. Return the zones as JSON.`;

    const response = await fetch(AZURE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AZURE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 2000,
        system: systemPrompt,
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
                text: userPrompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Azure Claude error:", response.status, text);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Azure Claude ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON returned by AI");

    const args = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ zones: args.zones || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("detect-card-fields error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
