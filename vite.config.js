import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // or your framework plugin

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0', // Bind to all interfaces
        port: 5173,
        strictPort: true,
        allowedHosts: [
            'loitg-ms-7d17.tail87f9af.ts.net',
            '.ts.net', // Wildcard to allow any Tailscale MagicDNS host
        ],
        hmr: {
            host: 'loitg-ms-7d17.tail87f9af.ts.net',
            clientPort: 443, // Tailscale Serve uses HTTPS port 443
        },
    },
})