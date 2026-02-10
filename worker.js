/*
  Cloudflare Worker: secure proxy for LLM feedback

  What this Worker does:
  1) Receives a learner response from a browser-based activity (Captivate, website, LMS embed)
  2) Uses a secret API key stored in Cloudflare (not in the browser, not in GitHub)
  3) Calls the LLM provider (OpenAI here)
  4) Returns structured JSON feedback to the browser

  What students MUST customize in this file:
  - systemPrompt (evaluation instructions)
  - userPrompt (how you present the learning objective, criteria, and response)
  - isAllowedOrigin() (add your GitHub Pages base domain)

  What students should NOT customize if you don't have JavaScript knowledge:
  - CORS/preflight handling
  - request parsing
  - OpenAI API call plumbing
  - JSON extraction and parsing
*/

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // Preflight (browser permission check).
    // Do not edit this section.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    // Only allow POST requests.
    // Do not edit this section.
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Block disallowed origins.
    // Do not edit this section.
    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Parse JSON body from the browser.
    // Do not edit this section.
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    // These values come from the frontend (Captivate, website, etc.).
    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];

    // Simple guardrails.
    // Do not edit this section.
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

    // The API key must be stored as a Cloudflare Secret named OPENAI_API_KEY.
    // Do not edit this section.
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    /*
      ============================
      SECTION STUDENTS MUST EDIT
      ============================
    */

    const systemPrompt =
      "You are an instructional coach evaluating a short open-ended response about task sequencing and dependencies. " +
      "Be concise, neutral, and explanatory. Do not praise or judge the learner. " +
      "Evaluate only against the provided learning objective and criteria. " +
      "If the response is vague or incomplete, note what is missing. " +
      "Return ONLY valid JSON matching the required schema. No markdown, no extra text.";

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      "Task:\n" +
      "Evaluate whether the learner response meets each criterion. The response should explain task dependencies and how sequencing reduces project risk or rework.\n\n" +
      "Rules for verdict:\n" +
      '- "Correct": all criteria are met clearly.\n' +
      '- "Not quite right": some criteria are met, but at least one is missing or unclear.\n' +
      '- "Incorrect": most criteria are not met or the response is off-topic.\n\n' +
      "Write feedback as concise, explanatory coaching:\n" +
      "- summary: 1–2 sentences explaining how the response aligns or does not align with the learning objective and criteria.\n" +
      "- criteria_feedback: for each criterion, set met=true/false and add a short comment (max 1 sentence each).\n" +
      "- next_step: one concrete suggestion to strengthen the response (e.g., name a dependency, clarify the risk, or give a more specific example).\n\n" +
      "Output MUST be ONLY JSON with exactly these keys:\n" +
      "- verdict\n" +
      "- summary\n" +
      "- criteria_feedback\n" +
      "- next_step\n";

    // Call OpenAI Responses API (server-side).
    // Do not edit this section.
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

    // Extract JSON text from OpenAI Responses API.
    // Do not edit this section.
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
          openai_response_preview: JSON

