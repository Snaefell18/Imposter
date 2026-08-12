// api/words.js — Vercel Serverless Function
// Ruft die Anthropic API auf und liefert ein Wortpaar zurück.
// Der API-Key bleibt auf dem Server (Environment Variable ANTHROPIC_API_KEY).

const THEMEN = [
  "Tiere", "Essen und Trinken", "Berufe", "Reisen und Orte", "Sport",
  "Musik und Instrumente", "Wetter und Natur", "Werkzeug und Handwerk",
  "Kleidung", "Fahrzeuge", "Möbel und Wohnen", "Märchen und Fantasy",
  "Technik", "Körper und Gesundheit", "Schule und Büro", "Feste und Feiern",
  "Meer und Schifffahrt", "Weltraum", "Garten und Pflanzen", "Spiele und Spielzeug"
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt." });
  }

  const thema = THEMEN[Math.floor(Math.random() * THEMEN.length)];

  const prompt = `Denk dir zwei deutsche Substantive zum Thema "${thema}" aus.
Regeln:
- Beide Wörter sind eng verwandt, aber klar unterscheidbar (Beispiele: Kaffee/Tee, Löwe/Tiger, Geige/Cello).
- Alltagssprache, keine Fachbegriffe, keine Eigennamen, keine zusammengesetzten Monsterwörter.
- Nicht dasselbe Wort, keine Synonyme.
- Wähle etwas Unerwartetes, keine Standardbeispiele.

Antworte ausschließlich mit JSON, ohne Markdown, ohne Erklärung:
{"a":"Wort1","b":"Wort2"}`;

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
        max_tokens: 100,
        temperature: 1,
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

    const pair = JSON.parse(text);
    const a = String(pair.a || "").trim();
    const b = String(pair.b || "").trim();
    if (!a || !b) throw new Error("Unvollständige Antwort.");

    // 50 / 50: gleiches Wort oder das verwandte Wort.
    const same = Math.random() < 0.5;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ wordA: a, wordB: same ? a : b, same });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
