// eslint-env node
const fs = require('fs')
const path = require('path')

const instancesDir = path.join(__dirname, 'instances')
const instanceNames = fs.existsSync(instancesDir)
  ? fs
      .readdirSync(instancesDir)
      .filter((f) => f.endsWith('.env'))
      .map((f) => path.basename(f, '.env'))
  : []

const app = (name, env) => ({
  name,
  script: './src/index.js',
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: '500M',
  env: { NODE_ENV: 'production', ...env },
  error_file: `./logs/${name}-error.log`,
  out_file: `./logs/${name}-out.log`,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
  kill_timeout: 5000
})

module.exports = {
  apps: [
    {
      ...app('telegram-replicator', {}),
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log'
    },
    ...instanceNames.map((name) =>
      app(`telegram-replicator-${name}`, {
        DOTENV_CONFIG_PATH: `instances/${name}.env`,
        SESSION_FILE: `instances/${name}.session`
      })
    )
  ]
}
