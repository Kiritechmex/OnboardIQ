import crypto from "node:crypto";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function auth(req, res, next) {
  try {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    if (token) {
      const session = await req.db.collection("sessions").findOne({ tokenHash: hashToken(token) });
      if (!session || new Date(session.expiresAt) <= new Date()) {
        return res.status(401).json({ error: "Session expired. Please log in again." });
      }
      const user = await req.db.collection("users").findOne({ id: session.userId });
      if (!user) return res.status(401).json({ error: "Invalid session" });
      req.user = user;
      return next();
    }

    // Backwards-compatible development fallback for older local demo clients.
    const email = req.header("x-user-email");
    if (process.env.NODE_ENV !== "production" && email) {
      const user = await req.db.collection("users").findOne({ email: email.trim().toLowerCase() });
      if (!user) return res.status(401).json({ error: "Invalid user" });
      req.user = user;
      return next();
    }

    return res.status(401).json({ error: "Login required" });
  } catch (error) {
    next(error);
  }
}

export function allow(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Insufficient permission" });
}

export function roles(...roles) {
  return allow(...roles);
}

export { hashToken };
