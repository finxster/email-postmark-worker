export interface Env {
  // Secret — set via `wrangler secret put POSTMARK_TOKEN`
  POSTMARK_TOKEN: string;
  // Vars — set in wrangler.toml or the dashboard
  FROM_EMAIL: string;
  TO_EMAIL: string;
  ALLOWED_ORIGINS: string; // comma-separated list, e.g. "https://finx.dev,https://www.finx.dev"
  MESSAGE_STREAM?: string; // default "outbound"
  SUBJECT_PREFIX?: string; // optional, e.g. "[finx.dev] "
}

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  // honeypot — must stay empty
  website?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEN = 5000;

function allowedOrigin(origin: string | null, env: Env): string | null {
  const list = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origin && list.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigin(origin, env);
    const cors = corsHeaders(allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, cors);
    }

    // Reject cross-origin requests from origins we don't trust.
    if (origin && !allowed) {
      return json({ ok: false, error: "Origin not allowed" }, 403, cors);
    }

    let data: ContactPayload;
    try {
      data = (await request.json()) as ContactPayload;
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400, cors);
    }

    // Honeypot: real users never fill this. Pretend success for bots.
    if (str(data.website)) {
      return json({ ok: true }, 200, cors);
    }

    const name = str(data.name);
    const email = str(data.email);
    const subject = str(data.subject);
    const message = str(data.message);

    if (!name || !email || !message) {
      return json({ ok: false, error: "Missing required fields" }, 422, cors);
    }
    if (!EMAIL_RE.test(email)) {
      return json({ ok: false, error: "Invalid email" }, 422, cors);
    }
    if (name.length > 200 || email.length > 200 || subject.length > 300 || message.length > MAX_LEN) {
      return json({ ok: false, error: "Field too long" }, 422, cors);
    }

    const prefix = env.SUBJECT_PREFIX ?? "";
    const finalSubject = `${prefix}${subject || `New message from ${name}`}`;

    const textBody =
      `Name: ${name}\n` +
      `Email: ${email}\n` +
      `Subject: ${subject || "(none)"}\n\n` +
      `${message}\n`;

    const htmlBody =
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
      `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
      `<p><strong>Subject:</strong> ${escapeHtml(subject || "(none)")}</p>` +
      `<hr><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`;

    const pmResp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_TOKEN,
      },
      body: JSON.stringify({
        From: env.FROM_EMAIL,
        To: env.TO_EMAIL,
        ReplyTo: email,
        Subject: finalSubject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: env.MESSAGE_STREAM || "outbound",
      }),
    });

    if (!pmResp.ok) {
      const detail = await pmResp.text().catch(() => "");
      console.error("Postmark error", pmResp.status, detail);
      // TEMPORARY DEBUG: surface Postmark's error to diagnose. Revert after.
      return json({ ok: false, error: "Failed to send", debug: detail, status: pmResp.status }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};
