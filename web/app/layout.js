import { Bricolage_Grotesque, Inter, DM_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import TabBar from "./TabBar.js";
import GraphButton from "./GraphButton.js";
import { DEMO_SESSION } from "../lib/demo.js";

// Three roles, not three decorations. Bricolage carries headings and the
// greeting — it has enough character to be recognisable at a glance and is
// tight enough to set two-line headlines on a phone. Inter reads the long
// stuff: a morning brief is several hundred words of prose. DM Mono is for
// readings — counts, times, dates, dollar figures — because this is an
// operating system and its numbers should look measured rather than written.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap"
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap"
});


export const metadata = {
  title: "PersonalOS",
  description: "Your personal operating system.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PersonalOS" },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efeee9" },
    { media: "(prefers-color-scheme: dark)", color: "#20272b" }
  ],
  // The tab bar sits against the home indicator, so the page has to own the
  // area behind it rather than letting the browser letterbox it.
  viewportFit: "cover"
};


// Runs before the first paint. React can't do this job: by the time a component
// mounts the page has already been painted in whatever colour the OS preferred,
// so an explicitly chosen light theme would flash dark on every single load.
const THEME_SCRIPT = `
try {
  var p = JSON.parse(localStorage.getItem("pos_prefs") || "{}");
  if (p.theme === "dark" || p.theme === "light") {
    document.documentElement.setAttribute("data-theme", p.theme);
  }
} catch (e) {}
`;


// Takes down the #pos-boot splash below. Every route here is force-dynamic —
// there is no page in this app that resolves instantly — so before this
// existed, opening it meant a blank paint (whatever the OS/browser shows
// before the stylesheet is even parsed) followed by the skeleton snapping in
// the moment data streamed. This closes that gap with something that is
// already painted in the initial HTML, no JavaScript required to appear.
//
// MIN exists so a connection fast enough to resolve before the DOM finishes
// parsing doesn't get a one-frame flicker — the splash holds for at least
// this long, however quick the page actually was. The 2500ms line is the
// failsafe: if DOMContentLoaded is somehow never seen, this is what stops the
// splash from covering the app forever instead of just looking briefly slow.
//
// It adds a class and stops. It must NEVER remove the element.
//
// The first version called el.remove(), and that shipped a crash. #pos-boot is
// rendered by React as part of this layout, so React owns that DOM node and
// holds a fiber pointing at it. Deleting it from underneath React means the
// next reconciliation of the layout — which happens on any router.refresh(),
// and so after almost every server action in the app — tries to operate on a
// node that is no longer in the tree and throws. With no error.js anywhere in
// this app that surfaces as Next's built-in "This page couldn't load", which
// is exactly what it looked like: navigation and most buttons failing, and a
// full reload always fixing it because that rebuilds the node from HTML.
//
// A class is safe where removal is not: React only patches className when the
// value it rendered changes between renders, and this one is a constant, so a
// class added from outside survives every re-render. It is the same technique
// THEME_SCRIPT above already uses on <html data-theme>.
const BOOT_SCRIPT = `
(function () {
  var MIN = 260, start = Date.now(), done = false;
  function hide() {
    if (done) return;
    done = true;
    var remain = MIN - (Date.now() - start);
    setTimeout(function () {
      var el = document.getElementById("pos-boot");
      if (el) el.classList.add("pos-boot-hide");
    }, remain > 0 ? remain : 0);
  }
  if (document.readyState !== "loading") hide();
  else document.addEventListener("DOMContentLoaded", hide);
  setTimeout(hide, 2500);
})();
`;


export default async function RootLayout({ children }) {

  // The "nothing here is real" bar has to fire for BOTH fake-data audiences:
  // the local design preview (POS_FIXTURES, never set in prod) and the public
  // demo session, which serves the same fixtures on production to a stranger
  // who clicked the link. Without the second case the demo shows invented
  // spending and people with nothing saying they're invented — the honesty the
  // bar exists for was missing on the one surface a recruiter actually sees.
  let isDemo = false;
  try {
    const store = await cookies();
    isDemo = store.get("pos_session")?.value === DEMO_SESSION;
  } catch { /* not in a request scope — neither audience */ }

  const showFixtureBar = process.env.POS_FIXTURES === "1" || isDemo;

  return (
    <html
      lang="en"
      className={`h-full ${bricolage.variable} ${inter.variable} ${dmMono.variable}`}
      // THEME_SCRIPT below sets data-theme before React hydrates, deliberately —
      // that is the whole reason it is a blocking script. React then finds an
      // attribute the server never rendered and logs a hydration mismatch on
      // every page load, forever, for something working exactly as designed.
      //
      // It is left alone either way ("This won't be patched up"), so the warning
      // changes nothing except what else you can see: a console with a permanent
      // error in it is a console nobody reads, and the real mismatches this app
      // has actually shipped (see traps #12b and #12d) look identical to it.
      // Suppression here covers this element's attributes only, which is the
      // narrowest scope that covers the script.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* In <head> rather than beside the element it acts on. React warns
            that scripts rendered inside a component body are never executed on
            client render, and a <script> sitting in <body> is one more node for
            React to reconcile on every navigation for no benefit. Here it is
            parsed once, and it waits for DOMContentLoaded anyway, so it does
            not care that #pos-boot does not exist yet when it runs. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        {/* Entrance animations start from opacity 0 and are undone by
            app/motion.js. With scripting off nothing would ever undo them, so
            the whole app would render as a blank page — this is the one
            override that cannot live in a media query. */}
        <noscript>
          {/* Same reasoning as the reveal override above: with scripting off,
              nothing will ever run BOOT_SCRIPT, so the splash has to get out
              of the way on its own or it becomes a permanent black screen —
              the exact thing it exists to prevent. */}
          <style>{`.pos-reveal,.pos-scene-hidden{opacity:1!important;transform:none!important}#pos-boot{display:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {/* No wordmark, no name — deliberately. This fires on every cold open
            of every route, including /welcome, which has its own full-screen
            opening sequence right after; a second thing introducing itself
            here would compete with it rather than just being "warming up". */}
        <div id="pos-boot" aria-hidden="true">
          <span className="pos-dot" />
          <span className="pos-dot" />
          <span className="pos-dot" />
        </div>

        {/* Fixture mode makes the dashboard look completely real. Say so, so
            nobody reads invented spending figures as their own. Fires for the
            local preview AND the public demo session. */}
        {showFixtureBar && (
          <div className="bg-ember px-4 py-1 text-center text-[0.7rem] font-medium text-white">
            Demo — sample data, nothing here is real
          </div>
        )}
        {children}
        <GraphButton />
        <TabBar />
      </body>
    </html>
  );
}
