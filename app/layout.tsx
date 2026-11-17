import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "AI Stock Radar",
  description:
    "Früherkennung ungewöhnlicher Entwicklungen bei liquiden Large Caps – mit echten Marktdaten.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="dark">
      <body className="bg-black">{children}</body>
    </html>
  );
}
