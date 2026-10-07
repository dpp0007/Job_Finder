// PM2 process file for a VPS: keeps Scout running, restarts it after a crash or a reboot.
//   npm ci && npm run build && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Settings come from the .env file in this folder (chmod 600 .env).
module.exports = {
  apps: [{
    name: 'scout',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000 -H 127.0.0.1',     // listen on localhost only: Nginx is the public entrance
    instances: 1,                            // one process: the rate limiter and the alert timer live in memory
    exec_mode: 'fork',
    max_memory_restart: '700M',
    env: { NODE_ENV: 'production' },
  }],
};
