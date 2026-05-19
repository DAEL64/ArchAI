import type { Metadata } from 'next'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'ArchitectAI — Blueprint Analysis',
  description: 'Upload architectural blueprints. Extract rooms, dimensions, and materials instantly. Generate 3D models and chat with your design.',
  keywords: ['architecture', 'blueprint analysis', 'AI', 'floor plan', '3D model'],
  openGraph: {
    title: 'ArchitectAI',
    description: 'AI-powered blueprint analysis and 3D model generation',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={geistMono.variable}>
      <head>
        {/* Bebas Neue for hero display text */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-[#0a0d0f] text-white">
        {children}
      </body>
    </html>
  )
}