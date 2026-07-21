import "./globals.css";

export const metadata = {
  title: "Walmart vs Sellerboard Reconciliation",
  description: "Live reconciliation dashboard for Kyle's Walmart account",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
