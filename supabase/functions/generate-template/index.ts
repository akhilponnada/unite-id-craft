import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
    const AZURE_IMAGE_ENDPOINT = Deno.env.get("AZURE_IMAGE_ENDPOINT") ||
      "https://ai-akhilponnada2047ai102855017871.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01";

    if (!AZURE_API_KEY) {
      throw new Error("AZURE_API_KEY is not configured");
    }

    const fullPrompt = `Generate a professional employee ID card template design with the following specifications: ${prompt.trim()}.
The card should be portrait orientation (ratio approximately 54:86, like a standard ID card).
Include placeholder areas for: company logo at top, employee photo in center, employee name, designation/title, employee ID number, and a barcode area at bottom.
Make it look professional, modern, and print-ready. Use clean typography and clear visual hierarchy.
The design should be a complete card template on a solid white background.`;

    const response = await fetch(AZURE_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AZURE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        size: "1024x1024",
        quality: "high",
        n: 1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("Azure image generation error:", response.status, errText);
      throw new Error(`Image generation error: ${response.status}`);
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;

    if (!b64) {
      throw new Error("No image was generated. Please try a different prompt.");
    }

    const imageUrl = `data:image/png;base64,${b64}`;

    return new Response(
      JSON.stringify({ image: imageUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-template error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
