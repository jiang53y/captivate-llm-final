export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json();

      const prompt = `
You are a strict but helpful instructor.
Return ONLY valid JSON with keys: verdict, summary, feedback.
No extra text.

Student response:
${body.response_text}

Learning objective:
${body.learning_objective}

Criteria:
${(body.criteria || []).join(" | ")}
`;

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an educational assessment assistant." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
        }),
      });

      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content || "";

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Model returned non-JSON", raw }, { status: 500 });
      }

      return Response.json(parsed);

    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  },
};
