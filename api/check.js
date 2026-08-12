// api/check.js — Vercel Serverless Function
// Prüft, ob der geratene Begriff als Treffer für das gesuchte Wort durchgeht.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST." });
  }

  const { guess, word } = req.body || {};
  if (!guess || !word) {
    return res.status(400).json({ error: "guess und word werden benötigt." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt." });
  }

  const prompt = `In einem Ratespiel war das gesuchte Wort: "${word}"
Ein Spieler hat geraten: "${guess}"

Zählt der Tipp als Treffer?
Akzeptiere: identische Wörter, Tippfehler, Singular/Plural, Groß-/Kleinschreibung,
echte Synonyme, gängige Umgangssprache für dieselbe Sache, Artikel davor.
Akzeptiere NICHT: nur thematisch verwandte Wörter, Oberbegriffe, Unterbegriffe,
Wörter aus demselben Umfeld, die aber etwas anderes bezeichnen.

Antworte ausschließlich mit JSON, ohne Markdown:
{"ok": true oder false, "reason": "ein kurzer deutscher Satz"}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "Anthropic API: " + r.status, detail });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: parsed.ok === true,
      reason: String(parsed.reason || "")
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
