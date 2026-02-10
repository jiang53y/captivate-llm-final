/*
  Cloudflare Worker: secure proxy for LLM feedback
*/

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];

    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(JSON.stringify({ error: "Response length out of range" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!learningObjective) {
      return new Response(JSON.stringify({ error: "Missing learning_objective" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const systemPrompt =
      "You are an instructional coach evaluating a short open-ended response about task sequencing and dependencies. " +
      "Be concise, neutral, and explanatory. Do not praise or judge the learner. " +
      "Evaluate only against the provided learning objective and criteria. " +
      "Return ONLY valid JSON with the required schema. No markdown, no extra text.";

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      "Evaluate whether the response:\n" +
      "- Identifies at least one dependency\n" +
      "- Explains how sequencing affects project flow\n" +
      "- Mentions a realistic risk (e.g., rework, delays, coordination)\n\n" +
      "Rules for verdict:\n" +
      '- "Correct": all criteria are met clearly.\n' +
      '- "Not quite right": some criteria are met, but at least one is missing or unclear.\n' +
      '- "Incorrect": most criteria are not met or the response is off-topic.\n\n' +
      "Output MUST be ONLY JSON with exactly these keys:\n" +
      "- verdict\n" +
      "- summary\n" +
      "- criteria_feedback (array of { criterion, met, comment })\n" +
      "- next_step\n";

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        text: { format: { type: "json_object" } }
      })
    });

    if (!openaiResp.ok) {
      const err = await openaiResp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const data = await openaiResp.json();

    const jsonText =
      (typeof data.output_text === "string" && data.output_text.trim()) ||
      extractTextFromResponsesOutput(data) ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Model returned non-JSON",
          raw: jsonText.slice(0, 400),
          openai_response_preview: JSON.stringify(data).slice(0, 800)
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
        }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
    });

    function extractTextFromResponsesOutput(d) {
      try {
        const out = Array.isArray(d.output) ? d.output : [];
        for (const item of out) {
          const content = Array.isArray(item.content) ? item.content : [];
          for (const c of content) {
            if (c && typeof c.text === "string" && c.text.trim()) return c.text.trim();
          }
        }
        return "";
      } catch {
        return "";
      }
    }
  }
};

function isAllowedOrigin(origin) {
  if (!origin) return null;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
  if (origin === "https://jiang53y.github.io") return origin;
  return null;
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
