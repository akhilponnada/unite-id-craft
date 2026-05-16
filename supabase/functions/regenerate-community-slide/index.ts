import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { inputs, computed, recommendation, slideTitle, currentSlide, instruction } = await req.json();

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT") || "https://ai-akhilponnada2047ai102855017871.services.ai.azure.com/anthropic/v1/messages";

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const themeTone: Record<string, string> = {
      "Dark Premium": "high-end, gold + white, confident.",
      "Corporate Blue": "structured, formal, trust-building.",
      "Green": "sustainable, environmental, optimistic.",
      "Luxury Gold": "premium, aspirational, wealth-focused.",
    };

    const systemPrompt = `You are an expert solar consultant for Unite Solar regenerating ONE slide of a community proposal deck.
Theme tone: ${themeTone[inputs.theme] || themeTone["Dark Premium"]}
Be punchy, slide-style, financially precise. Use the supplied numbers. Recommended model: ${recommendation}.

Return a JSON object with: title, subtitle, bullets (array of 3-6 strings), highlight (optional: {label, value}).
Return ONLY valid JSON, no markdown.`;

    const userPrompt = `INPUTS:
${JSON.stringify(inputs, null, 2)}

COMPUTED FINANCIALS:
${JSON.stringify(computed, null, 2)}

SLIDE TO REGENERATE: "${slideTitle}"

CURRENT SLIDE CONTENT (for context — produce a fresh, improved version):
${JSON.stringify(currentSlide, null, 2)}

${instruction ? `EXTRA INSTRUCTION FROM USER: ${instruction}` : "Make it sharper, more specific, more persuasive."}`;

    const response = await fetch(AZURE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AZURE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await response.text();
      console.error("Azure Claude error:", response.status, t);
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return a slide.");

    const slide = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ slide }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("regenerate-community-slide error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
