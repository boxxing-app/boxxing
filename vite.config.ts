import { defineConfig } from 'vite';
// GitHub Pages serves the site under /<repo>/; the workflow sets BASE_PATH. Every runtime URL uses import.meta.env.BASE_URL.
export default defineConfig({base:(globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env.BASE_PATH||'/',worker:{format:'es'},build:{target:'es2022',chunkSizeWarningLimit:1000},server:{allowedHosts:['terminal.local']}});
