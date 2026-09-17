import "@queuedash/ui/dist/styles.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Same reset as the standalone HTML the server adapters serve. */}
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
