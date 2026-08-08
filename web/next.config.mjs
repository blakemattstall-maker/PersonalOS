/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },

  experimental: {
    // How long the browser may reuse a page it has already loaded before asking
    // the server to rebuild it (Next's Client Cache).
    //
    // `dynamic` defaults to 0, meaning no reuse at all. Every route in this app
    // is force-dynamic, so tapping Money → Today → Money paid the full server
    // render three times — and TabBar.js already documents that hop as costing
    // 700ms–1.5s. The second Money render was answering a question it had
    // answered one tap earlier.
    //
    // 30s is safe rather than merely tolerable, because the risk here is not
    // "the user changes something and sees the old value". Every mutating server
    // action in app/actions.js calls revalidatePath, which clears this cache —
    // so clearing a nudge, saving a setting or deleting a project all still show
    // the truth immediately. What a stale window can delay is only a change that
    // arrived from *outside* this browser: a capture spoken into the iOS
    // Shortcut, a cron writing the morning brief, Overland posting a GPS point.
    // Those are worth up to 30 seconds; a reload shows them at once.
    //
    // `static` is left at its 5-minute default. The only static route is
    // /welcome, which reads nothing and is prerendered anyway.
    staleTimes: {
      dynamic: 30
    }
  }
};

export default nextConfig;
