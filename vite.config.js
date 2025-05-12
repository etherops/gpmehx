import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: '/gpmehx/', // Base URL for GitHub Pages
  build: {
    outDir: 'dist', // Output directory for the build
    emptyOutDir: true, // Empty the output directory before building
  }
})
