# `vite build --mode app`: the mobile app bundle (apps/mobile). See DECISIONS.md, "Mobile app".
VITE_APP=1
VITE_SERVER_URL=https://apex-ghost-server.ilmas.workers.dev
VITE_WEB_URL=https://apex-ghost-liard.vercel.app
# cars, maps and engine sounds come from the website (CORS: Vercel sends Access-Control-Allow-Origin: *)
VITE_ASSET_BASE=https://apex-ghost-liard.vercel.app/
