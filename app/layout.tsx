import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
export const metadata: Metadata = {
  title: 'Sablen Toolbox',
  description: 'Saml Shopify og Dinero i én bogføringsplatform.',
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png', sizes: '48x48' }],
    apple: [{ url: '/favicon.png', type: 'image/png', sizes: '180x180' }],
  },
  openGraph: { title: 'Sablen Toolbox', description: 'Shopify og Dinero — samlet ét sted', images: [{ url: '/og.png', width: 1536, height: 1024 }] },
  twitter: { card: 'summary_large_image', title: 'Sablen Toolbox', description: 'Shopify og Dinero — samlet ét sted', images: ['/og.png'] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="da"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>; }
