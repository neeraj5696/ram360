const fs = require('fs');
const path = require('path');

const isPackaged = process.pkg !== undefined;
const basePath = isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const logsDir = path.join(basePath, 'logs');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

let customDate = null;

const C = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  cyan:  '\x1b[36m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
};

const ts = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
};

const dateStr = (d = null) => {
  const n = d || new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
};

const writeToFile = (level, message) => {
  try {
    const file = path.join(logsDir, `${customDate ? dateStr(customDate) : dateStr()}.log`);
    fs.appendFileSync(file, `[${ts()}] ${level.padEnd(7)} ${message}\n`, 'utf8');
  } catch {}
};

const log = (icon, color, level, message, fn = console.log) => {
  fn(`${C.dim}${ts()}${C.reset} ${color}${icon} ${message}${C.reset}`);
  writeToFile(level, message);
};

const logger = {
  info:       (m) => log('ℹ', C.cyan,    'INFO',    m),
  success:    (m) => log('✔', C.green,   'OK',      m),
  warning:    (m) => log('⚠', C.yellow,  'WARN',    m),
  error:      (m) => log('✖', C.red,     'ERROR',   m, console.error),
  checkpoint: (m) => log('›', C.blue,    'STEP',    m),
  rocket:     (m) => log('🚀', C.magenta, 'START',   m),
  calendar:   (m) => log('📅', C.cyan,    'SCHED',   m),
  setCustomDate:  (d) => { customDate = d; },
  resetCustomDate:()  => { customDate = null; },
};

module.exports = logger;
