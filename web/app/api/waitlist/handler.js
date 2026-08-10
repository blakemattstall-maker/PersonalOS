import supabase from "../../../lib/supabase.js";
import { enforceLimit } from "../../../lib/ratelimit.js";


// A stranger on the welcome tour leaves their email. No session — this is the
// one write path meant to be reached by someone with no account — so the whole
// defence is here: a per-IP rate limit so it can't be a spam funnel, strict
// email validation, and a length cap. It stores nothing but the address.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // A real signup is one request; anything hammering this is a script.
  if (!enforceLimit(req, res, { name: "waitlist", limit: 10 })) return;

  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!email || email.length > 200 || !EMAIL.test(email)) {
    return res.status(400).json({ success: false, error: "Enter a valid email address." });
  }

  const { error } = await supabase
    .from("waitlist")
    .insert([{ email, source: "welcome" }]);

  if (error) {

    // Already on the list. Report success rather than an error — both so the
    // form feels right and so the endpoint never reveals which emails exist.
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      return res.status(200).json({ success: true, message: "You're already on the list — thanks." });
    }

    // Table not created yet (PGRST205), or any other write failure: degrade to
    // a calm "try again" and log loudly, rather than 500-ing a marketing page.
    console.error("WAITLIST insert FAILED:", error.message);
    return res.status(200).json({ success: false, error: "Couldn't save that just now — try again in a moment." });

  }

  return res.status(200).json({ success: true, message: "You're on the list. We'll be in touch." });

}
