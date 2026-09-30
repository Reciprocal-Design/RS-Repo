import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Protein Hero",
  description: "Interactive protein surface hero",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
