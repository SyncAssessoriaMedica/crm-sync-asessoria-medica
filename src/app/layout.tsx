import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sync CRM | Central de Inteligência Comercial",
  description:
    "CRM proprietário da Sync Marketing para assessorias de marketing médico.",
  icons: {
    icon: [{ url: "/sync-favicon.png", type: "image/png", sizes: "192x192" }],
    shortcut: "/sync-favicon.png",
    apple: "/sync-favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
