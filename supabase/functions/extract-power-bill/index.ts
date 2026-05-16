import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Accepts { fileBase64: string, mimeType: string } and uses Azure Claude Opus
 * to extract a structured power bill summary.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileBase64, mimeType } = await req.json();
    if (!fileBase64 || !mimeType) {
      return new Response(JSON.stringify({ error: "fileBase64 and mimeType are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT");
    if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not configured");

    const base64Data = fileBase64.startsWith("data:") ? fileBase64.split(",")[1] : fileBase64;

    const systemPrompt = `You are an expert at parsing Indian electricity bills (TSSPDCL, APSPDCL, BESCOM, MSEDCL, etc.). Extract every requested field precisely. If a field isn't visible, return 0 (numbers) or empty string. Convert all amounts to plain INR numbers (e.g. '₹3,036,352' → 3036352). For energy charge per unit, average the slab rates if multiple. For tax %, sum electricity duty + cess as % of energy charges.

Return a JSON object with these fields:
- consumer_name: string
- service_number: string (Service / consumer / meter number)
- utility_provider: string (Utility/DISCOM name)
- tariff_category: string (e.g. LT-II(A), HT-II, Domestic)
- consumer_segment: "residential" | "commercial" | "industrial" | "agricultural" | "unknown"
- location: string
- state: string (Indian state name)
- billing_month: string
- monthly_units: number (Total units consumed)
- monthly_bill: number (Total amount payable in INR)
- energy_charge_per_unit: number (Average energy charge in INR/unit)
- fixed_monthly_charges: number (Fixed + demand + meter rent in INR)
- demand_charges: number (Demand charges in INR)
- tax_pct: number (Electricity duty + taxes as % of energy charges)
- sanction_load_kw: number (Sanctioned / contract demand in kW)
- connected_load_kw: number (Connected load in kW)
- last_6_months_units: number[] (Recent monthly consumption, most recent first)
- confidence: "high" | "medium" | "low"

Return ONLY valid JSON, no markdown or explanation.`;

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
                  media_type: mimeType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: "Extract the structured fields from this power bill and return as JSON.",
              },
            ],
          },
        ],
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
      throw new Error(`Azure Claude error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON");
    const args = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(args), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-power-bill error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});