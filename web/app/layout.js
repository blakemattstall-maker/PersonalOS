import "./globals.css";

export const metadata = {
  title: "PersonalOS",
  description: "Your personal operating system.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
