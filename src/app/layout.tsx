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

const siteUrl =
	process.env.NEXT_PUBLIC_SITE_URL ??
	(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

const title = "Vapor OS — turn images into smoke"
const description =
	"Upload any image and vaporize it into drifting colored smoke, or burn it away. A real-time WebGL playground"

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title,
	description,
	openGraph: {
		type: "website",
		siteName: "Vapor OS",
		title,
		description,
		url: "/",
		images: [
			{
				url: "/og-image.png",
				width: 1200,
				height: 630,
				alt: "Vapor OS",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
		images: ["/og-image.png"],
	},
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
