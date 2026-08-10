// Service worker for Web Push.
//
// iOS only delivers push to a web app that was installed via Share -> Add to
// Home Screen. Notifications requested from an ordinary Safari tab are accepted
// and then silently never arrive, which is the single most confusing failure
// mode here — hence the check in the subscribe UI rather than relying on the
// permission prompt alone.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});


self.addEventListener("push", (event) => {

  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Almanac", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Almanac";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // A stable tag means a second digest replaces the first rather than
      // stacking — the interruption budget is one message, not one per day
      // piling up unread.
      tag: data.tag || "personalos",
      renotify: true,
      data: { url: data.url || "/" }
    })
  );

});


self.addEventListener("notificationclick", (event) => {

  event.notification.close();

  const target = event.notification.data?.url || "/";

  // Capture confirmations link straight at the thing they created — a Google
  // Calendar event, a Gmail draft, an exported Doc — so a target is now often
  // on another origin. WindowClient.navigate() rejects cross-origin URLs by
  // spec, so reusing an open window only works for our own pages; anything
  // else has to go through openWindow or the tap silently does nothing.
  let sameOrigin = true;

  try {
    sameOrigin = new URL(target, self.location.origin).origin === self.location.origin;
  } catch {
    sameOrigin = true;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {

      if (sameOrigin) {

        // Focus the app if it's already open rather than opening a second copy.
        for (const client of windows) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }

      }

      return self.clients.openWindow(target);

    })
  );

});
