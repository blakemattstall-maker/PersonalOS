import { Bricolage_Grotesque, Inter, DM_Mono } from "next/font/google";
import "./globals.css";
import TabBar from "./TabBar.js";

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


export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`h-full ${bricolage.variable} ${inter.variable} ${dmMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {/* Fixture mode makes the dashboard look completely real. Say so, so
            nobody reads invented spending figures as their own. */}
        {process.env.POS_FIXTURES === "1" && (
          <div className="bg-ember px-4 py-1 text-center text-[0.7rem] font-medium text-white">
            Fixture data — nothing here is real
          </div>
        )}
        {children}
        <TabBar />
      </body>
    </html>
  );
}
