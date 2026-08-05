import webpush from "web-push";
import supabase from "./supabase.js";


// Web Push, not a paid service.
//
// Pushcut was the earlier plan at ~$2-4/mo; researching it properly showed that
// to be the most expensive of four options. iOS has supported Web Push for
// home-screen web apps since 16.4, and the dashboard is already installed to
// the Home Screen — so this is native notifications with no vendor, no new app
// and no monthly cost, which is what keeps the whole system under $10/mo.
//
// The catch worth remembering: iOS only delivers to a PWA that was added via
// Share -> Add to Home Screen. Notifications requested from a normal Safari tab
// silently never arrive.

let configured = false;


function configure() {

  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:noreply@example.com",
    publicKey,
    privateKey
  );

  configured = true;

  return true;

}


export async function saveSubscription(subscription, userAgent = null) {

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("Malformed push subscription.");
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent
    }, { onConflict: "endpoint" });

  if (error) throw new Error(error.message);

  return { success: true };

}


// Returns how many devices actually received it. Subscriptions expire when the
// user reinstalls or revokes permission; Apple and Google signal that with 404
// or 410, and a dead endpoint that is never cleaned up means every future send
// wastes a request and logs a failure.
export async function sendPush({ title, body, url = "/", tag = null }) {

  if (!configure()) {
    return { sent: 0, skipped: "push not configured" };
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (error) throw new Error(error.message);

  if (!subs || subs.length === 0) {
    return { sent: 0, skipped: "no devices subscribed" };
  }

  const payload = JSON.stringify({ title, body, url, tag });

  let sent = 0;
  const expired = [];

  await Promise.all(subs.map(async (s) => {

    try {

      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );

      sent += 1;

    } catch (error) {

      if (error.statusCode === 404 || error.statusCode === 410) {
        expired.push(s.id);
      } else {
        console.error("PUSH FAILED:", error.statusCode, error.message);
      }

    }

  }));


  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }


  if (sent > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .not("id", "in", `(${expired.join(",") || "'00000000-0000-0000-0000-000000000000'"})`);
  }


  return { sent, expired: expired.length };

}


export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}
