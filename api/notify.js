// api/notify.js — verschickt Push-Nachrichten über Firebase Cloud Messaging.
// Braucht die Environment-Variable FIREBASE_SERVICE_ACCOUNT (kompletter
// JSON-Inhalt des Dienstkonto-Schlüssels aus der Firebase Console).

import admin from "firebase-admin";

function initAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
    const creds = JSON.parse(raw);
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(creds) });
  }
  return admin;
}

// Die Texte entstehen hier, damit der Client sie nicht fälschen kann.
function baueNachricht(kind, from, extra = {}) {
  switch (kind) {
    case "challenge":
      return { title: "Herausforderung", body: `${from} fordert dich heraus.`, tag: "challenge" };
    case "accepted":
      return { title: "Es geht los", body: `${from} hat angenommen.`, tag: "game" };
    case "hint":
      return {
        title: `${from} ist dran gewesen`,
        body: extra.word ? `Hinweis: „${extra.word}" — jetzt bist du dran.` : "Du bist dran.",
        tag: "game"
      };
    case "finished":
      return { title: "Runde beendet", body: `${from} hat getippt. Schau dir das Ergebnis an.`, tag: "game" };
    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST." });

  const { idToken, to, kind, word } = req.body || {};
  if (!idToken || !to || !kind) return res.status(400).json({ error: "idToken, to und kind nötig." });

  try {
    const a = initAdmin();

    // Absender beweisen — sonst könnte jeder beliebige Meldungen verschicken.
    const decoded = await a.auth().verifyIdToken(idToken);
    const senderUid = decoded.uid;
    if (senderUid === to) return res.status(200).json({ skipped: "an sich selbst" });

    const db = a.firestore();
    const [senderSnap, zielSnap] = await Promise.all([
      db.collection("users").doc(senderUid).get(),
      db.collection("users").doc(to).get()
    ]);
    if (!zielSnap.exists) return res.status(404).json({ error: "Empfänger unbekannt." });

    const tokens = zielSnap.data().pushTokens || [];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: "keine Geräte registriert" });

    const from = senderSnap.exists ? (senderSnap.data().username || "Jemand") : "Jemand";
    const msg = baueNachricht(kind, from, { word });
    if (!msg) return res.status(400).json({ error: "Unbekannte Art." });

    // Reine Datennachricht: der Service Worker entscheidet, ob er sie zeigt.
    const result = await a.messaging().sendEachForMulticast({
      tokens,
      data: { title: msg.title, body: msg.body, tag: msg.tag, url: "/" },
      webpush: { headers: { Urgency: "high", TTL: "900" } },
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } }
    });

    // Abgelaufene Geräte-Token wieder aufräumen.
    const tot = [];
    result.responses.forEach((r, i) => {
      const code = r.error?.code || "";
      if (!r.success && (code.includes("registration-token-not-registered") || code.includes("invalid-argument"))) {
        tot.push(tokens[i]);
      }
    });
    if (tot.length) {
      await db.collection("users").doc(to).update({
        pushTokens: admin.firestore.FieldValue.arrayRemove(...tot)
      });
    }

    return res.status(200).json({ sent: result.successCount, removed: tot.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
