// api/launches.ics.js
const LL2_UPCOMING =
  "https://ll.thespacedevs.com/2.0.0/launch/upcoming/?limit=100&mode=list&location__ids=11";

function esc(s = "") {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function toICSDate(d) {
  // d is JS Date in UTC
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function foldLine(line) {
  // RFC5545 folding at 75 octets-ish; this is “good enough” for typical ASCII lines
  const limit = 75;
  let out = "";
  while (line.length > limit) {
    out += line.slice(0, limit) + "\r\n" + " ";
    line = line.slice(limit);
  }
  return out + line;
}

export default async function handler(req, res) {
  try {
    const r = await fetch(LL2_UPCOMING, {
      headers: { "User-Agent": "smm-launch-calendar/1.0" }
    });
    if (!r.ok) throw new Error(`LL2 fetch failed: ${r.status}`);
    const data = await r.json();

    const now = new Date();
    const oneYear = new Date();
    oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1);

    // Build VEVENTs
    const events = (data.results || [])
      .map((L) => {
        const net = L.net ? new Date(L.net) : null; // "net" is UTC timestamp
        if (!net || net < now || net > oneYear) return null;

        const title = L.name || "Rocket launch";
        const status = L.status?.name ? `Status: ${L.status.name}` : "";
        const pad = L.pad?.name ? `Pad: ${L.pad.name}` : "";
        const location = L.pad?.location?.name || "Vandenberg SFB, CA, USA";

        const uid = `${L.id}@smm-launches`;
        const dtstart = toICSDate(net);

        // 2-hour block
        const dtend = toICSDate(new Date(net.getTime() + 2 * 60 * 60 * 1000));

        const descParts = [
          "Expected visible from the Santa Monica Mountains (weather/trajectory permitting).",
          status,
          pad,
          L.url ? `More: ${L.url}` : ""
        ].filter(Boolean);

        return [
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${toICSDate(new Date())}`,
          `SUMMARY:${esc(title)}`,
          `DTSTART:${dtstart}`,
          `DTEND:${dtend}`,
          `LOCATION:${esc(location)}`,
          `DESCRIPTION:${esc(descParts.join("\\n"))}`,
          // 1-hour reminder (note: Google may ignore per-event alarms on subscribed calendars)
          "BEGIN:VALARM",
          "TRIGGER:-PT60M",
          "ACTION:DISPLAY",
          "DESCRIPTION:Launch reminder (1 hour)",
          "END:VALARM",
          "END:VEVENT"
        ].join("\r\n");
      })
      .filter(Boolean);

    const ics =
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//smm-launches//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Santa Monica Mountains — Visible Rocket Launches",
        "X-WR-TIMEZONE:America/Los_Angeles",
        "X-WR-CALDESC:Auto-updating feed of Vandenberg launches (next 12 months). Data: Launch Library 2 (The Space Devs).",
        ...events.flatMap((e) => e.split("\r\n").map(foldLine)),
        "END:VCALENDAR",
        ""
      ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=900"); // 15 min
    res.status(200).send(ics);
  } catch (err) {
    res.status(500).send(`Calendar error: ${err.message}`);
  }
}
