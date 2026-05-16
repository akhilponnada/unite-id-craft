const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  project_name?: string;
  location?: string;
  project_type?: string;
  capacity_mw?: number;
  approx_budget?: string;
  custom_notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as Body;
    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT");
    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY not configured");

    const systemPrompt = `You are a senior solar investment advisor in India.
Given a project, recommend ONE best-fit investment model from:
- "PPA" (developer owns, client pays per unit; great when client wants no capex)
- "BOOT" (build-own-operate-transfer; mid-term ownership transfer)
- "Self Investment" (client funds capex; best ROI long-term, needs capital)
- "Community Investment" (crowdfund among residents; great for gated communities)

Return JSON with: model, reasoning (<60 words), confidence (low/medium/high).
Return ONLY valid JSON, no markdown.`;

    const userPrompt = `Project: ${body.project_name ?? ""}
Location: ${body.location ?? ""}
Type: ${body.project_type ?? ""}
Capacity: ${body.capacity_mw ?? ""} MW
Approx budget: ${body.approx_budget ?? "not provided"}
Notes: ${body.custom_notes ?? ""}`;

    const resp = await fetch(AZURE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AZURE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (resp.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("Azure Claude error:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: "No recommendation produced" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recommend-investment-model error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
