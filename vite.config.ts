import { defineConfig } from 'vite';
export default defineConfig({worker:{format:'es'},build:{target:'es2022',chunkSizeWarningLimit:1000},server:{allowedHosts:['terminal.local']}});
