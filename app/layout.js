import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

// CohereText / Unica77 are proprietary: Space Grotesk (display) and Inter (UI) are the documented fallbacks.
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata = {
  title: 'Scout — live job finder',
  description: 'Live job and internship finder powered by TinyFish Search, Fetch and Agent.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
