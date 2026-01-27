const logger = require('./utils/logger');

const EXPIRY_DATE = '2026-03-31';

// Check if license is valid (expiry - current > 0)
const isLicenseValid = () => {
  try {
    const currentDate = new Date();
    const expiryDate = new Date(EXPIRY_DATE);
    
    const isValid = expiryDate > currentDate;
    
    const status = isValid ? '✓ VALID' : '❌ EXPIRED';
    logger.checkpoint(`[LICENSE-CHECK] Current: ${currentDate.toDateString()} | Expiry: ${expiryDate.toDateString()} | Status: ${status}`);
    
    return isValid;
  } catch (error) {
    logger.error('[LICENSE-CHECK-ERROR] ' + error.message);
    return false;
  }
};

// Get license status details
const getLicenseStatus = () => {
  try {
    const currentDate = new Date();
    const expiryDate = new Date(EXPIRY_DATE);
    
    const isValid = expiryDate > currentDate;
    const daysRemaining = Math.ceil((expiryDate - currentDate) / (1000 * 60 * 60 * 24));
    
    return {
      valid: isValid,
      expiryDate: EXPIRY_DATE,
      currentDate: currentDate.toISOString(),
      daysRemaining: daysRemaining,
      status: isValid ? 'ACTIVE' : 'EXPIRED'
    };
  } catch (error) {
    logger.error('[LICENSE-STATUS-ERROR] ' + error.message);
    return { valid: false, status: 'ERROR' };
  }
};

module.exports = {
  isLicenseValid,
  getLicenseStatus
};
