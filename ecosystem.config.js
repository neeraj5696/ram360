module.exports = {
  apps: [{
    name:'Ram360',
    script:'Ram360.exe',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: '5002'
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    restart_delay: 4000,
    log_type: 'json',
    rotate_interval: '0 0 1 * *',
    max_size: '10M',
    retain: 3,
    compress: true
  }]
};
