import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Configuración de Vite + PWA.
// vite-plugin-pwa genera el manifest y el service worker, de modo que la app
// es instalable en iPhone y Android sin pasar por las tiendas de aplicaciones.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Gestión de Pagos a Proveedores',
        short_name: 'Pagos',
        description:
          'Ventana de gestión de pagos a proveedores: revisá las horas registradas y procesá los pagos.',
        lang: 'es',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        background_color: '#0A0A0A',
        theme_color: '#0A0A0A',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      // El service worker se activa en el build de producción.
      // Para probar la instalación en local: `npm run build && npm run preview`.
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
