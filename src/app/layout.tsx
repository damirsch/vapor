import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import "./globals.scss"

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
})

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
})

export const metadata: Metadata = {
	title: "Vapor OS — dissolve images into light",
	description:
		"Upload an image and vaporize it into drifting colored smoke, or switch to cigarette mode to burn it away like paper. A real-time WebGL playground",
}

export const viewport: Viewport = {
	themeColor: "#0a0a0b",
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	userScalable: false,
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang='en' className={`${geistSans.variable} ${geistMono.variable}`}>
			<body>{children}</body>
		</html>
	)
}
