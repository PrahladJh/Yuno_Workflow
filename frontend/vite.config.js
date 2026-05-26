import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api':      { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:3001', ws: true },
    },
  },

  build: {
    // Silence the warning — we handle splitting manually below
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks: {
          // React core — loaded first, cached long-term
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // MUI — largest single dependency
          'vendor-mui': [
            '@mui/material',
            '@mui/icons-material',
            '@emotion/react',
            '@emotion/styled',
          ],

          // Workflow canvas — only needed on /workflows pages
          'vendor-xyflow': ['@xyflow/react'],

          // Charts — only needed on /monitoring and /dashboard
          'vendor-recharts': ['recharts'],

          // Utilities — small but shared everywhere
          'vendor-utils': ['axios', 'socket.io-client', 'react-hot-toast', 'lucide-react'],
        },
      },
    },
  },
});
