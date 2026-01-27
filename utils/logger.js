const fs = require('fs');
const path = require('path');

// Determine if running from compiled exe or dev
const isPackaged = process.pkg !== undefined;
const basePath = isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');

// Create logs directory if it doesn't exist
const logsDir = path.join(basePath, 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (error) {
  // If we can't create the logs directory, use a temp location
  console.error('Cannot create logs directory:', error.message);
}

// Track custom date for manual sync logging
let customDate = null;

// Get formatted date (YYYY-MM-DD)
const getFormattedDate = (dateObj = null) => {
  const now = dateObj || new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get formatted timestamp (HH:MM:SS)
const getFormattedTime = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

// Set custom date for manual sync logging
const setCustomDate = (dateObj) => {
  customDate = dateObj;
};

// Reset custom date after sync completes
const resetCustomDate = () => {
  customDate = null;
};

// Get log file path based on current date or custom date
const getLogFilePath = () => {
  const dateStr = customDate ? getFormattedDate(customDate) : getFormattedDate();
  return path.join(logsDir, `${dateStr}.log`);
};

// Write log to file
const writeToFile = (message) => {
  try {
    const logFilePath = getLogFilePath();
    const timestamp = getFormattedTime();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
  } catch (error) {
    console.error('Error writing to log file:', error.message);
  }
};

// Logger object with different log levels
const logger = {
  info: (message) => {
    const msg = `ℹ️  ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  success: (message) => {
    const msg = `✅ ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  warning: (message) => {
    const msg = `⚠️  ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  error: (message) => {
    const msg = `❌ ${message}`;
    console.error(msg);
    writeToFile(msg);
  },
  
  checkpoint: (message) => {
    const msg = `🔄 ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  rocket: (message) => {
    const msg = `🚀 ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  calendar: (message) => {
    const msg = `📅 ${message}`;
    console.log(msg);
    writeToFile(msg);
  },
  
  setCustomDate: setCustomDate,
  resetCustomDate: resetCustomDate
};

module.exports = logger;
