import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pick'em League",
  description: "Pick em league app built with Next.js and Supabase",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-50"
      >
        {children}
        <footer className="mx-auto max-w-lg px-4 py-6 text-center text-xs text-gray-500 dark:text-zinc-500">
          <p>
            &copy; {new Date().getFullYear()} Pick&apos;em League. All rights
            reserved. &middot; Site by JH Design
          </p>
          <p className="mt-1">
            Not affiliated with the NFL or any NFL team. Team names and logos
            are property of their respective owners.
          </p>
        </footer>
      </body>
    </html>
  );
}
