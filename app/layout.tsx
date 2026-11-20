import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Infinitive Cloud Assistant",
  description: "Your guide to cloud hosting, migration, and managed cloud solutions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
