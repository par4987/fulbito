import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fútbol Pro 3D — Juego de fútbol en el navegador",
  description: "Juego de fútbol 3D estilo PES: estadio nocturno, 11 vs 11 con IA, cámaras de TV, física de balón y modo historia de partidos.",
  keywords: ["fútbol", "juego", "3D", "Three.js", "soccer", "PES", "Next.js"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Fútbol Pro 3D",
    description: "Juego de fútbol 3D profesional en tu navegador",
    siteName: "Fútbol Pro 3D",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
