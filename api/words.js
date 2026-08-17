// api/words.js — Vercel Serverless Function
// Ruft die Anthropic API auf und liefert ein Wortpaar zurück.
// Der API-Key bleibt auf dem Server (Environment Variable ANTHROPIC_API_KEY).

const THEMEN = [
  "Tiere", "Essen & Trinken", "Getränke", "Berufe", "Länder & Städte", "Sport",
  "Musik", "Filme & Serien", "Natur & Wetter", "Werkzeug", "Kleidung", "Fahrzeuge",
  "Wohnen & Möbel", "Fantasy & Märchen", "Technik", "Schule & Büro", "Feiern & Feste",
  "Meer & Schiffe", "Weltraum", "Garten & Pflanzen", "Spielzeug", "Körper",
  "Geschichte", "Alltag"
];

// Stufe 1 = weit auseinander (leicht zu durchschauen)
// Stufe 4 = fast deckungsgleich (kaum zu durchschauen)
const STUFEN = {
  1: {
    name: "weit auseinander",
    regel: "Die beiden Wörter gehören zur selben Oberkategorie, meinen aber offensichtlich verschiedene Dinge. Ein einziges Hinweiswort sollte reichen, um den Unterschied zu bemerken.",
    beispiele: "Hund / Elefant, Gitarre / Trommel, Regen / Sonne"
  },
  2: {
    name: "eng verwandt",
    regel: "Die beiden Wörter sind eng verwandt und werden oft zusammen genannt, sind aber klar unterscheidbar.",
    beispiele: "Kaffee / Tee, Löwe / Tiger, Geige / Cello"
  },
  3: {
    name: "sehr nah",
    regel: "Die beiden Wörter bezeichnen zwei Varianten derselben Sache. Viele Hinweiswörter passen auf beide.",
    beispiele: "Espresso / Cappuccino, Krokodil / Alligator, Sofa / Couchsessel"
  },
  4: {
    name: "kaum zu trennen",
    regel: "Die beiden Wörter sind so nah beieinander, dass fast jedes Hinweiswort auf beide passt. Trotzdem sind es zwei verschiedene Dinge, keine Synonyme.",
    beispiele: "Cappuccino / Latte Macchiato, Aubergine / Zucchini, Nebel / Dunst"
  }
};

const norm = s => String(s || "").toLowerCase().trim();

async function askForPair(key, thema, avoid, stufe) {
  const s = STUFEN[stufe] || STUFEN[2];

  const sperre = avoid.length
    ? `\n\nDiese Wörter sind verbraucht und dürfen NICHT vorkommen — auch keine Varianten davon:\n${avoid.join(", ")}`
    : "";

  const prompt = `Denk dir zwei deutsche Substantive zum Thema "${thema}" aus.

Abstand der beiden Wörter: ${s.name}.
${s.regel}
Orientierung: ${s.beispiele}

Weitere Regeln:
- Alltagssprache, keine Fachbegriffe, keine Eigennamen, keine zusammengesetzten Monsterwörter.
- Nicht dasselbe Wort, keine reinen Synonyme.
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

  const body = req.body || {};

  // Wörter, die diese beiden Spieler zuletzt schon hatten.
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map(String).filter(Boolean).slice(-160);
  const blocked = new Set(avoid.map(norm));

  // Kategorie und Stufe aus dem erweiterten Duell; sonst Zufall bzw. Normal.
  const stufe = [1, 2, 3, 4].includes(Number(body.difficulty)) ? Number(body.difficulty) : 2;
  const wunsch = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

  try {
    let pair = null;
    let letzterVersuch = null;

    // Bis zu drei Anläufe: kollidiert das Paar mit der Sperrliste, neu würfeln.
    for (let i = 0; i < 3; i++) {
      const thema = wunsch || THEMEN[Math.floor(Math.random() * THEMEN.length)];
      const p = await askForPair(key, thema, avoid, stufe);
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
    return res.status(200).json({
      wordA: pair.a,
      wordB: same ? pair.a : pair.b,
      same,
      pair: { a: pair.a, b: pair.b, source: "api" },   // fürs Archiv: immer beide Wörter
      category: wunsch,
      difficulty: stufe
    });
  } catch (e) {
    if (e.status) return res.status(502).json({ error: e.message, detail: e.detail });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
const norm = s => String(s || "").toLowerCase().trim();

async function askForPair(key, thema, avoid, stufe) {
  const s = STUFEN[stufe] || STUFEN[2];

  const sperre = avoid.length
    ? `\n\nDiese Wörter sind verbraucht und dürfen NICHT vorkommen — auch keine Varianten davon:\n${avoid.join(", ")}`
    : "";

  const prompt = `Denk dir zwei deutsche Substantive zum Thema "${thema}" aus.

Abstand der beiden Wörter: ${s.name}.
${s.regel}
Orientierung: ${s.beispiele}

Weitere Regeln:
- Alltagssprache, keine Fachbegriffe, keine Eigennamen, keine zusammengesetzten Monsterwörter.
- Nicht dasselbe Wort, keine reinen Synonyme.
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

  const body = req.body || {};

  // Wörter, die diese beiden Spieler zuletzt schon hatten.
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map(String).filter(Boolean).slice(-80);
  const blocked = new Set(avoid.map(norm));

  // Kategorie und Stufe aus dem erweiterten Duell; sonst Zufall bzw. Normal.
  const stufe = [1, 2, 3, 4].includes(Number(body.difficulty)) ? Number(body.difficulty) : 2;
  const wunsch = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

  try {
    let pair = null;
    let letzterVersuch = null;

    // Bis zu drei Anläufe: kollidiert das Paar mit der Sperrliste, neu würfeln.
    for (let i = 0; i < 3; i++) {
      const thema = wunsch || THEMEN[Math.floor(Math.random() * THEMEN.length)];
      const p = await askForPair(key, thema, avoid, stufe);
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
    return res.status(200).json({
      wordA: pair.a,
      wordB: same ? pair.a : pair.b,
      same,
      category: wunsch,
      difficulty: stufe
    });
  } catch (e) {
    if (e.status) return res.status(502).json({ error: e.message, detail: e.detail });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
