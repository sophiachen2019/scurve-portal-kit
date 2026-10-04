import { defineConfig } from 'vite'

/*
 * Standards section 4.1: no deployed hostname in frontend source. The base URL
 * resolves from VITE_API_BASE, then a runtime override on window, then
 * same-origin. In development the proxy below keeps the portal same-origin so
 * the third branch is the one that runs.
 *
 * Point a dev build at a different API with VITE_API_BASE instead of editing
 * this file.
 */
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
      '/auth': { target: API_TARGET, changeOrigin: true }
    }
  }
})
