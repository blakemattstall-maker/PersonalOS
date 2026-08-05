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
    data = { title: "PersonalOS", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "PersonalOS";

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

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {

      // Focus the app if it's already open rather than opening a second copy.
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }

      return self.clients.openWindow(target);

    })
  );

});
