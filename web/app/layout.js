import "./globals.css";

export const metadata = {
  title: "PersonalOS",
  description: "Your personal operating system.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PersonalOS" },
};

export const viewport = {
  themeColor: "#0b0d10",
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
    <html lang="en" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
