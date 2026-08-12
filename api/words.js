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

const norm = s => String(s || "").toLowerCase().trim();

async function askForPair(key, thema, avoid) {
  const sperre = avoid.length
    ? `\n\nDiese Wörter sind verbraucht und dürfen NICHT vorkommen — auch keine Varianten davon:\n${avoid.join(", ")}`
    : "";

  const prompt = `Denk dir zwei deutsche Substantive zum Thema "${thema}" aus.
Regeln:
- Beide Wörter sind eng verwandt, aber klar unterscheidbar (Beispiele: Kaffee/Tee, Löwe/Tiger, Geige/Cello).
- Alltagssprache, keine Fachbegriffe, keine Eigennamen, keine zusammengesetzten Monsterwörter.
- Nicht dasselbe Wort, keine Synonyme.
- Wähle etwas Unerwartetes, keine Standardbeispiele.${sperre}

Antworte ausschließlich mit JSON, ohne Markdown, ohne Erklärung:
{"a":"Wort1","b":"Wort2"}`;

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
    const err = new Error("Anthropic API: " + r.status);
    err.detail = detail;
    err.status = r.status;
    throw err;
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
  return { a, b };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt." });
  }

  // Wörter, die diese beiden Spieler zuletzt schon hatten.
  const avoidRaw = Array.isArray(req.body?.avoid) ? req.body.avoid : [];
  const avoid = avoidRaw.map(String).filter(Boolean).slice(-80);
  const blocked = new Set(avoid.map(norm));

  // Themen, in denen schon viel verbraucht wurde, kommen seltener dran.
  const themenPool = THEMEN.slice();

  try {
    let pair = null;
    let letzterVersuch = null;

    // Bis zu drei Anläufe: kollidiert das Paar mit der Sperrliste, neu würfeln.
    for (let i = 0; i < 3; i++) {
      const thema = themenPool[Math.floor(Math.random() * themenPool.length)];
      const p = await askForPair(key, thema, avoid);
      letzterVersuch = p;
      if (!blocked.has(norm(p.a)) && !blocked.has(norm(p.b))) { pair = p; break; }
    }

    // Klappt es nach drei Versuchen nicht, wird der letzte Vorschlag genommen —
    // besser ein Wiederholer als eine abgebrochene Runde.
    pair = pair || letzterVersuch;
    if (!pair) throw new Error("Kein Wortpaar erhalten.");

    // 50 / 50: gleiches Wort oder das verwandte Wort.
    const same = Math.random() < 0.5;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ wordA: pair.a, wordB: same ? pair.a : pair.b, same });
  } catch (e) {
    if (e.status) return res.status(502).json({ error: e.message, detail: e.detail });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
