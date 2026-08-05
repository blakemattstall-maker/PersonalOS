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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
