import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLIDE_TITLES = [
  "Cover",
  "Executive Summary",
  "Current Consumption Analysis",
  "Solar Potential & Feasibility",
  "Proposed System Capacity",
  "Solution Design",
  "Business Model Options",
  "Financial Analysis",
  "ROI / Savings Summary",
  "Technical Architecture",
  "Brands & Technology",
  "Service & Maintenance",
  "PPA / Business Flow",
  "Benefits — Community & Investors",
  "Implementation Plan",
  "Conclusion & Thank You",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { inputs, computed, recommendation } = await req.json();

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT");

    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const themeTone: Record<string, string> = {
      "Dark Premium": "Use a gold + white tone, high-end corporate, confident and aspirational.",
      "Corporate Blue": "Use a structured, formal, trust-building tone focused on clarity.",
      "Green": "Emphasize sustainability, environmental impact, clean future.",
      "Luxury Gold": "Premium, aspirational tone highlighting wealth and returns.",
    };

    const systemPrompt = `You are an expert solar business consultant for Unite Solar generating an investor-ready proposal for a gated community.
Tone: ${themeTone[inputs.theme] || themeTone["Dark Premium"]}
Be persuasive, professional, financially precise, free of fluff. Use the supplied numbers — never invent figures that conflict with them.
Output MUST be a structured deck of exactly 16 slides matching this order:
${SLIDE_TITLES.map((t, i) => `${i + 1}. ${t}`).join("\n")}

For each slide return:
- title (string, short)
- subtitle (string, optional, max 80 chars)
- bullets (array of 3-6 short bullet strings, each ≤ 110 chars)
- highlight (optional single big-number callout: { label, value })

Keep bullets punchy (slide-style). Recommend the model "${recommendation}" with a brief 2-line rationale on the Business Model and Conclusion slides.

Return a JSON object with: slides (array), executive_summary (string), recommendation_rationale (string).
Return ONLY valid JSON, no markdown.`;

    const userPrompt = `INPUTS:
${JSON.stringify(inputs, null, 2)}

COMPUTED FINANCIALS (use these exact numbers in the deck):
${JSON.stringify(computed, null, 2)}

Recommended Model: ${recommendation}

IMPORTANT — when discussing the three business models, use these per-model numbers exactly:
• BOOT: ${computed.bootPeriodYears}-year boot period, tariff ₹${computed.bootTariff}/unit (community pays the same as today; investor receives ~₹${(computed.bootTotalRevenue || 0).toLocaleString("en-IN")} over the boot period).
• PPA: ${computed.ppaDiscountPct}% discount on current tariff (effective ₹${computed.ppaEffectiveTariff}/unit), ${computed.ppaTermYears}-year term, monthly savings ₹${(computed.ppaMonthlySavings || 0).toLocaleString("en-IN")}.
• Community Self-Invest (SPV): ${computed.selfInvestorCount} investors × ₹${(computed.selfTicketSize || 0).toLocaleString("en-IN")} ticket = ₹${(computed.selfTotalCapital || 0).toLocaleString("en-IN")} capital, target IRR ${computed.selfTargetIrr}%, full monthly saving ₹${(computed.selfMonthlySavings || 0).toLocaleString("en-IN")}.
State / CMD rule applied: ${(inputs.state || "Other")} cap ${computed.cmdCapPct}% of sanctioned load (${computed.cmdCapKw} kW).`;

    const response = await fetch(AZURE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AZURE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Azure Claude error:", response.status, t);
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return structured slides.");

    const args = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(args), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-community-proposal error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
