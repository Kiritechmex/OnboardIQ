const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured() {
  return Boolean(String(process.env.RESEND_API_KEY || "").trim());
}

export async function sendEmail({ to, subject, html, text }) {
  const recipient = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipient.length) return { sent: false, mode: "skipped", reason: "No recipient" };

  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = process.env.RESEND_FROM || "OnboardX <onboarding@resend.dev>";

  if (!key) {
    console.log("[OnboardX email: development mode]", { to: recipient, subject, text: text || "" });
    return { sent: false, mode: "development" };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ from, to: recipient, subject, html, text }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Email provider returned ${response.status}`);
  }
  return { sent: true, mode: "resend", id: payload?.id || null };
}
