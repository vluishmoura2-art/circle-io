// ecosystem.config.js
// Fica na raiz de server/, ao lado do package.json.
// Configuração do PM2 — garante que o server.js volta a rodar depois do
// process.exit() programado a cada 24h.
//
// Como usar (depois de já ter feito 'npm install' na pasta server/):
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 logs ball-io-server
//   pm2 save && pm2 startup

module.exports = {
    apps: [
        {
            name: 'ball-io-server',
            script: './src/server.js',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 100000,   // 100 segundos fora do ar, como pedido
            max_restarts: 1000,
            env: {
                NODE_ENV: 'production',
                PORT: 3000
            }
        }
    ]
};