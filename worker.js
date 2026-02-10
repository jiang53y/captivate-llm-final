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

/*
  CUSTOMIZE THIS FUNCTION (students must do this):

  Add the website origin that is allowed to call your Worker from the browser.

  GitHub Pages origin is only the base domain:
  https://yourusername.github.io
  Do NOT include your repo name after it.
*/
function isAllowedOrigin(origin) {
  if (!origin) return null;

  // Optional: allow Captivate preview on localhost while testing
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;

  // Students MUST customize this line:
  if (origin === "https://YOUR_GITHUB_USERNAME.github.io") return origin;

  return null;
}

// Do not edit this function.
function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
