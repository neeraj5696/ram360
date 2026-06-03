require('dotenv').config({ debug: false });
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const { connectDB, getPool, sql, getTableName, tableExists } = require('./model/db');
const fs = require('fs');
const logger = require('./utils/logger');
const { isLicenseValid, getLicenseStatus } = require('./license');


const app = express();
const PORT = process.env.PORT || 5000;
const isPackaged = process.pkg !== undefined;
const basePath = isPackaged ? path.dirname(process.execPath) : __dirname;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


let isSyncing = false;

// Sync state management
const stateFile = path.join(basePath, './sync_state.json');

const loadAllSyncState = () => {

  try {
    if (fs.existsSync(stateFile)) {

      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      return data;
    } else {
      logger.warning('No sync state file found, starting fresh');
      return { tables: {} };
    }
  } catch (error) {
    logger.error(' Error loading sync state: ' + error.message);
    return { tables: {} };
  }
};

// Load sync state for specific table
const loadSyncState = (tableName) => {

  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const tableData = data.tables?.[tableName];

      if (tableData) {

        return tableData.lastId || '';
      } else {
        logger.warning(`No sync state for ${tableName}, starting from empty string`);
        return '';
      }
    } else {
      logger.warning('No sync state file found');
      return '';
    }
  } catch (error) {
    logger.error('Error loading sync state: ' + error.message);
    return '';
  }
};

// Save sync state for specific table
const saveSyncState = (tableName, id) => {

  try {
    let stateData = { tables: {} };

    if (fs.existsSync(stateFile)) {
      stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    if (!stateData.tables) {
      stateData.tables = {};
    }
    stateData.tables[tableName] = {
      lastId: id,
      lastSync: new Date().toISOString()
    };

    fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));

  } catch (error) {

    logger.error('[CHECKPOINT-SAVE-ERROR] Error saving sync state: ' + error.message);
  }
};


const fetchValidPunches = async (tableName, lastSyncId) => {

  try {
    const request = (await getPool()).request();
    const eventTypeInStr = process.env.EVENT_TYPE_IN || '4865,4867';

    const cleanedStr = eventTypeInStr.replace(/[\[\]]/g, '');
    const eventTypes = cleanedStr.split(',').map(e => parseInt(e.trim())).filter(e => !isNaN(e));


    if (eventTypes.length === 0) {
      logger.error('[CHECKPOINT-8B] No valid event types found in ENV');
      return [];
    }

    const batchSize = parseInt(process.env.BATCH_SIZE) || 70;
    const query = `
      SELECT TOP ${batchSize} 
        EVTLGUID as UniqueID,
        SRVDT as server_time,
        DEVDT as device_time, 
        USRID as user_id,
        EVT as event_type,
        DEVUID as device_id
      FROM [${tableName}]
      WHERE EVTLGUID > @lastId
        AND USRID IS NOT NULL
        AND EVT IN (${eventTypes.join(',')})
        ORDER BY EVTLGUID ASC
    `;

    request.input('lastId', sql.VarChar, lastSyncId.toString());
    const result = await request.query(query);
    const records = result.recordset;


    return records;
  } catch (error) {
    logger.error('Data Not found in Database' + error.message);
    return [];
  }
};

const pushToAPI = async (dataArray) => {

  if (!dataArray || dataArray.length === 0) {
    return { success: true, successCount: 0, failedCount: 0, failed: [] };
  }

  const apiUrl = process.env.EXTERNAL_API_URL || 'API URL NO LOADED... CHECK ENV';
  const apiToken = process.env.EXTERNAL_API_TOKEN || '';

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  let successCount = 0;
  let failedCount = 0;
  const failedRecords = [];

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isInternalServerError = (error) => {
    const httpStatus = error.response?.status;
    const body = error.response?.data || {};
    const bodyMessage = (body.message || '').toLowerCase();
    const bodyStatusCode = String(body.statusCode || '');
    const bodyStatus = (body.status || '').toLowerCase();
    const errorMessage = (error.message || '').toLowerCase();

    // Match HTTP 5xx
    if (httpStatus && httpStatus >= 500) return true;
    // Match exact API response: { message: "internal server error.", status: "failed", statusCode: "500" }
    if (bodyStatusCode === '500') return true;
    if (bodyStatus === 'failed' && bodyMessage.includes('internal server error')) return true;
    // Fallback: message contains internal server error
    if (errorMessage.includes('internal server error')) return true;

    return false;
  };

  for (let i = 0; i < dataArray.length; i++) {
    const record = dataArray[i];
    let pushed = false;
    let lastError = null;
    let retriedAtLeastOnce = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(apiUrl, record, {
          headers: {
            'Token': apiToken,
            'Content-Type': 'application/json',
            'CompanyCode': 'RAMP360'
          },
          timeout: 30000
        });

        const httpStatus = response.status;
        const resMessage = response.data?.message || 'OK';

        // Recovered after retry
        if (retriedAtLeastOnce) {
          logger.success(`[API-RETRY-SUCCESS] EmployeeID: ${record.EmployeeID}, UniqueID: ${record.UniqueID} — recovered on attempt ${attempt} | Status: ${httpStatus} | Message: ${resMessage}`);
        } else {
          // Normal first-attempt success
          logger.success(`[API-SUCCESS] EmployeeID: ${record.EmployeeID}, UniqueID: ${record.UniqueID} | Status: ${httpStatus} | Message: ${resMessage}`);
        }

        successCount++;
        pushed = true;
        break;

      } catch (error) {
        lastError = error.response?.data?.message || error.message || 'Unknown error';
        const status = error.response?.status || 'N/A';

        if (!isInternalServerError(error)) {
          // Normal error (4xx etc.) — log with status and message
          logger.error(`[API-ERROR] EmployeeID: ${record.EmployeeID}, UniqueID: ${record.UniqueID} | Status: ${status} | Message: ${lastError}`);
          break;
        }

        // Internal server error — retry
        retriedAtLeastOnce = true;
        if (attempt < MAX_RETRIES) {
          logger.warning(`[API-RETRY] EmployeeID: ${record.EmployeeID}, UniqueID: ${record.UniqueID} — attempt ${attempt}/${MAX_RETRIES} | Status: ${status} | Message: ${lastError}, retrying in ${RETRY_DELAY_MS}ms...`);
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    if (!pushed) {
      failedCount++;
      // Only log EmployeeID and UniqueID if it was an internal server error that exhausted all retries
      if (retriedAtLeastOnce) {
        logger.error(`[API-FAILED] EmployeeID: ${record.EmployeeID}, UniqueID: ${record.UniqueID}`);
      }
      failedRecords.push({ index: i, record: record, error: lastError });
    }
  }

  return {
    success: failedCount === 0,
    successCount: successCount,
    failedCount: failedCount,
    failed: failedRecords
  };
};

// Main sync job
const syncAttendance = async () => {
  // logger.checkpoint('[CHECKPOINT-1] Starting syncAttendance module');

  if (isSyncing) {
    logger.warning('[SYNC-SKIP] Previous sync still running, skipping this cycle.');
    return;
  }

  isSyncing = true;
  try {

    if (!isLicenseValid()) {
      logger.error('[CHECKPOINT-LICENSE-INVALID] ❌ SYNC BLOCKED: License is not valid');
      const status = getLicenseStatus();
      logger.error(`[CHECKPOINT-LICENSE-STATUS] ${status.message}`);
      logger.error('[CHECKPOINT-LICENSE-EXIT] Exiting process due to invalid license...');
      process.exit(1);
    }
    logger.success('[CHECKPOINT-LICENSE-OK] ✓ License is valid, proceeding with sync');


    const now = new Date();
    const tableName = getTableName(now.getFullYear(), now.getMonth() + 1);
    logger.success(` table: ${tableName}`);

    // Load sync state for this specific table
    const lastSyncId = loadSyncState(tableName);
    // logger.success(`[CHECKPOINT-4] Current lastSyncId for ${tableName}: ${lastSyncId}`);

    // logger.checkpoint('[CHECKPOINT-5] Checking if table exists');
    const exists = await tableExists(tableName);

    if (!exists) {
      logger.error(`[CHECKPOINT-6] Table ${tableName} not found`);
      return;
    }


    const records = await fetchValidPunches(tableName, lastSyncId);

    if (records.length === 0) {
      logger.success(' No new records to process');
      return;
    }

    // Update sync state with last EVTLGUID for this table
    const maxId = records[records.length - 1].UniqueID;
    // logger.checkpoint(`[CHECKPOINT-12] Saving sync state with maxId: ${maxId}`);
    saveSyncState(tableName, maxId);



    const deviceInIds = (process.env.DEVICE_IN || '').split(',').map(id => id.trim());
    const deviceOutIds = (process.env.DEVICE_OUT || '').split(',').map(id => id.trim());

    const transformedData = records.map(record => {
      const deviceId = String(record.device_id);
      const ioFlag = deviceInIds.includes(deviceId) ? "I" : (deviceOutIds.includes(deviceId) ? "O" : "n/a");

      // Convert Unix timestamp (seconds) to formatted date string
      const timestamp = record.device_time;
      const date = new Date(timestamp * 1000);
      const formattedDateTime =
        date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0') + ' ' +
        String(date.getHours()).padStart(2, '0') + ':' +
        String(date.getMinutes()).padStart(2, '0');

      return {
        EmployeeID: String(record.user_id || 'n/a'),
        AttendanceDateTime: formattedDateTime,
        ioFlag: ioFlag,
        UniqueID: parseInt(tableName.replace('T_LG', '').slice(-4) + String(record.UniqueID)),
        IsDuplicate: "N"
      };
    });


    const pushResult = await pushToAPI(transformedData);

    if (pushResult.success) {
      logger.success(`Sucess Result ${pushResult.successCount} `);
    } else {
      logger.warning(`Failed Result: ${pushResult.failedCount}`);

    }

  } catch (error) {
    logger.error('[CHECKPOINT-ERROR] Sync error in module: ' + error.message);
    logger.error('[CHECKPOINT-ERROR] Stack: ' + error.stack);
  } finally {
    isSyncing = false;
  }
};

// Initialize and start
const start = async () => {
  try {
    // Root route - Manual Sync UI
    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Attendance Sync System</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              padding: 20px;
            }
            
            .container {
              max-width: 900px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
            }
            
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
            }
            
            .header h1 {
              font-size: 28px;
              margin-bottom: 5px;
            }
            
            .header p {
              opacity: 0.9;
              font-size: 14px;
            }
            
            .content {
              padding: 30px;
            }
            
            .form-group {
              margin-bottom: 25px;
            }
            
            .form-group label {
              display: block;
              margin-bottom: 8px;
              font-weight: 600;
              color: #333;
              font-size: 14px;
            }
            
            .form-group input[type="date"] {
              width: 100%;
              padding: 12px;
              border: 2px solid #e0e0e0;
              border-radius: 6px;
              font-size: 14px;
              transition: border-color 0.3s;
            }
            
            .form-group input[type="date"]:focus {
              outline: none;
              border-color: #667eea;
              box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }
            
            .button-group {
              display: flex;
              gap: 10px;
              margin-bottom: 30px;
            }
            
            button {
              flex: 1;
              padding: 12px 24px;
              border: none;
              border-radius: 6px;
              font-size: 15px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s;
            }
            
            .btn-sync {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            
            .btn-sync:hover:not(:disabled) {
              transform: translateY(-2px);
              box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
            }
            
            .btn-sync:disabled {
              opacity: 0.7;
              cursor: not-allowed;
            }
            
            .btn-reset {
              background: #f0f0f0;
              color: #333;
            }
            
            .btn-reset:hover {
              background: #e0e0e0;
            }
            
            .status-card {
              margin-top: 30px;
              padding: 20px;
              background: #f8f9fa;
              border-radius: 8px;
              border-left: 4px solid #667eea;
              display: none;
            }
            
            .status-card.show {
              display: block;
            }
            
            .status-card.success {
              border-left-color: #28a745;
              background: #f0f8f4;
            }
            
            .status-card.error {
              border-left-color: #dc3545;
              background: #fdf5f6;
            }
            
            .status-card.warning {
              border-left-color: #ffc107;
              background: #fffbf0;
            }
            
            .status-title {
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 15px;
              color: #333;
            }
            
            .status-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-bottom: 15px;
            }
            
            .status-item {
              background: white;
              padding: 15px;
              border-radius: 6px;
              text-align: center;
            }
            
            .status-value {
              font-size: 28px;
              font-weight: 700;
              color: #667eea;
              margin-bottom: 5px;
            }
            
            .status-label {
              font-size: 12px;
              color: #666;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            
            .status-card.success .status-value {
              color: #28a745;
            }
            
            .status-card.error .status-value {
              color: #dc3545;
            }
            
            .timestamp {
              font-size: 12px;
              color: #999;
              margin-top: 10px;
            }
            
            .loading {
              display: none;
              text-align: center;
              padding: 20px;
            }
            
            .loading.active {
              display: block;
            }
            
            .spinner {
              border: 4px solid #f3f3f3;
              border-top: 4px solid #667eea;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 0 auto 10px;
            }
            
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            
            .error-message {
              color: #dc3545;
              font-size: 14px;
              margin-top: 10px;
              padding: 10px;
              background: #ffe5e5;
              border-radius: 4px;
              display: none;
            }
            
            .error-message.show {
              display: block;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Attendance Sync System</h1>
              <p>Manual Data Synchronization Dashboard</p>
            </div>
            
            <div class="content">
              <form id="syncForm">
                <div class="form-group">
                  <label for="syncDate">Select Date to Sync:</label>
                  <input 
                    type="date" 
                    id="syncDate" 
                    name="syncDate"
                    required
                  />
                  <small style="color: #999; margin-top: 5px; display: block;">
                    Leave empty to sync from last checkpoint
                  </small>
                </div>
                
                <div class="button-group">
                  <button type="button" class="btn-sync" onclick="triggerSync()">
                    🔄 Start Sync Now
                  </button>
                  <button type="reset" class="btn-reset" onclick="resetForm()">
                    ↻ Reset
                  </button>
                </div>
              </form>
              
              <div class="loading" id="loading">
                <div class="spinner"></div>
                <p>Syncing data... Please wait</p>
              </div>
              
              <div class="error-message" id="errorMessage"></div>
              
              <div class="status-card" id="statusCard">
                <div class="status-title" id="statusTitle">Sync Completed ✓</div>
                
                <div class="status-grid">
                  <div class="status-item">
                    <div class="status-value" id="successCount">0</div>
                    <div class="status-label">Successful</div>
                  </div>
                  <div class="status-item">
                    <div class="status-value" id="failedCount">0</div>
                    <div class="status-label">Failed</div>
                  </div>
                  <div class="status-item">
                    <div class="status-value" id="totalCount">0</div>
                    <div class="status-label">Total Records</div>
                  </div>
                </div>
                
                <div class="timestamp" id="timestamp"></div>
              </div>
            </div>
          </div>

          <script>
            // Set default date to today
            document.getElementById('syncDate').valueAsDate = new Date();
            
            function triggerSync() {
              const dateInput = document.getElementById('syncDate').value;
              const btn = event.target;
              
              btn.disabled = true;
              document.getElementById('loading').classList.add('active');
              document.getElementById('statusCard').classList.remove('show');
              document.getElementById('errorMessage').classList.remove('show');
              
              fetch('/manual-sync', { 
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ date: dateInput })
              })
              .then(response => response.json())
              .then(data => {
                document.getElementById('loading').classList.remove('active');
                
                if (data.error) {
                  showError(data.error);
                } else {
                  showSuccess(data);
                }
              })
              .catch(error => {
                document.getElementById('loading').classList.remove('active');
                showError('Network error: ' + error.message);
              })
              .finally(() => {
                btn.disabled = false;
              });
            }
            
            function showSuccess(data) {
              const card = document.getElementById('statusCard');
              const total = data.successCount + data.failedCount;
              
              document.getElementById('successCount').textContent = data.successCount;
              document.getElementById('failedCount').textContent = data.failedCount;
              document.getElementById('totalCount').textContent = total;
              document.getElementById('timestamp').textContent = 'Synced at: ' + new Date().toLocaleString();
              
              card.classList.remove('error', 'warning');
              card.classList.add('show', data.failedCount === 0 ? 'success' : 'warning');
              
              document.getElementById('statusTitle').textContent = 
                data.failedCount === 0 
                  ? '✓ All records synced successfully!' 
                  : '⚠ Sync completed with some failures';
            }
            
            function showError(errorMsg) {
              const errorDiv = document.getElementById('errorMessage');
              errorDiv.textContent = '❌ Error: ' + errorMsg;
              errorDiv.classList.add('show');
            }
            
            function resetForm() {
              document.getElementById('syncForm').reset();
              document.getElementById('syncDate').valueAsDate = new Date();
              document.getElementById('statusCard').classList.remove('show');
              document.getElementById('errorMessage').classList.remove('show');
              document.getElementById('loading').classList.remove('active');
            }
          </script>
        </body>
        </html>
      `);
    });

    // Health endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK', message: 'Server is running' });
    });

    // Status endpoint
    app.get('/status', (req, res) => {
      const syncStates = loadAllSyncState();
      res.status(200).json({
        status: 'running',
        tables: Object.keys(syncStates.tables || {})
      });
    });

    // Manual sync endpoint
    app.post('/manual-sync', async (req, res) => {
      try {
        if (isSyncing) {
          return res.status(429).json({
            success: false,
            successCount: 0,
            failedCount: 0,
            error: 'Sync already in progress. Please wait for it to complete.'
          });
        }

        isSyncing = true;
        // Check license validity first
        // logger.checkpoint('[MANUAL-SYNC-LICENSE] Checking license validity');
        if (!isLicenseValid()) {
          logger.error('[MANUAL-SYNC-LICENSE-INVALID] ❌ SYNC BLOCKED: License is not valid');
          const status = getLicenseStatus();
          logger.error('[MANUAL-SYNC-LICENSE-EXIT] Exiting process due to invalid license...');
          process.exit(1);
        }
        // logger.success('[MANUAL-SYNC-LICENSE-OK] ✓ License is valid');

        const dateParam = req.body?.date;

        // Set custom date for logging if provided
        if (dateParam) {
          logger.setCustomDate(new Date(dateParam));
        }

        // logger.checkpoint('[MANUAL-SYNC] Manual sync triggered by user' + (dateParam ? ' for date: ' + dateParam : ''));

        // Parse selected date and generate table name from it
        let selectedDate = new Date();
        if (dateParam) {
          selectedDate = new Date(dateParam);
        }

        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth() + 1;
        const tableName = getTableName(year, month);
        // logger.checkpoint(`[MANUAL-SYNC] Generated table name: ${tableName} from date: ${selectedDate.toDateString()}`);

        const lastSyncId = loadSyncState(tableName);
        const exists = await tableExists(tableName);

        if (!exists) {
          return res.status(404).json({
            success: false,
            successCount: 0,
            failedCount: 0,
            error: `Table ${tableName} not found for date ${selectedDate.toDateString()}`
          });
        }

        // Calculate date range for the selected date (start of day to end of day)
        const dateStart = new Date(year, selectedDate.getMonth(), selectedDate.getDate());
        const dateEnd = new Date(year, selectedDate.getMonth(), selectedDate.getDate() + 1);
        const unixStart = Math.floor(dateStart.getTime() / 1000);
        const unixEnd = Math.floor(dateEnd.getTime() / 1000);

        // logger.checkpoint(`[MANUAL-SYNC] Date range: ${dateStart.toISOString()} to ${dateEnd.toISOString()}`);
        // logger.checkpoint(`[MANUAL-SYNC] Unix timestamp range: ${unixStart} to ${unixEnd}`);

        // Fetch records from selected date
        const request = (await getPool()).request();
        const eventTypeInStr = process.env.EVENT_TYPE_IN || '4865,4867';
        const cleanedStr = eventTypeInStr.replace(/[\[\]]/g, '');
        const eventTypes = cleanedStr.split(',').map(e => parseInt(e.trim())).filter(e => !isNaN(e));

        const query = `
          SELECT TOP 50 
            EVTLGUID as UniqueID,
            SRVDT as server_time,
            DEVDT as device_time, 
            USRID as user_id,
            EVT as event_type,
            DEVUID as device_id
          FROM [${tableName}]
          WHERE EVTLGUID > @lastId
            AND USRID IS NOT NULL
            AND EVT IN (${eventTypes.join(',')})
            AND DEVDT >= @dateStart
            AND DEVDT < @dateEnd
            ORDER BY EVTLGUID ASC
        `;

        request.input('lastId', sql.VarChar, lastSyncId.toString());
        request.input('dateStart', sql.BigInt, unixStart);
        request.input('dateEnd', sql.BigInt, unixEnd);

        // logger.checkpoint(`[MANUAL-SYNC] Executing query with date filter...`);
        const result = await request.query(query);
        const records = result.recordset;

        // logger.success(`[MANUAL-SYNC] Found ${records.length} records for date ${selectedDate.toDateString()}`);

        if (records.length === 0) {
          return res.json({
            success: true,
            successCount: 0,
            failedCount: 0,
            message: `No records found for date ${selectedDate.toDateString()}`
          });
        }

        // Update sync state
        const maxId = records[records.length - 1].UniqueID;
        saveSyncState(tableName, maxId);

        // Transform data
        const deviceInIds = (process.env.DEVICE_IN || '').split(',').map(id => id.trim());
        const deviceOutIds = (process.env.DEVICE_OUT || '').split(',').map(id => id.trim());
        const transformedData = records.map(record => {
          const deviceId = String(record.device_id);
          const ioFlag = deviceInIds.includes(deviceId) ? "I" : (deviceOutIds.includes(deviceId) ? "O" : "O");
          const timestamp = record.device_time;
          const date = new Date(timestamp * 1000);
          const formattedDateTime =
            date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0') + ' ' +
            String(date.getHours()).padStart(2, '0') + ':' +
            String(date.getMinutes()).padStart(2, '0');

          return {
            EmployeeID: String(record.user_id || 'n/a'),
            AttendanceDateTime: formattedDateTime,
            ioFlag: ioFlag,
            UniqueID: parseInt(tableName.replace('T_LG', '') + String(record.UniqueID)),
            IsDuplicate: "N"
          };
        });

        // Push to API
        // logger.checkpoint(`[MANUAL-SYNC] Pushing ${transformedData.length} records to API from table ${tableName}`);
        const pushResult = await pushToAPI(transformedData);

        // logger.success(`[MANUAL-SYNC-COMPLETE] Manual sync completed successfully`);
        logger.resetCustomDate();
        isSyncing = false;
        res.json(pushResult);
      } catch (error) {
        logger.error('[MANUAL-SYNC-ERROR] ' + error.message);
        logger.resetCustomDate();
        isSyncing = false;
        res.status(500).json({
          success: false,
          successCount: 0,
          failedCount: 0,
          error: error.message
        });
      }
    });

    // License info endpoint
    app.get('/license-status', (req, res) => {
      const status = getLicenseStatus();
      res.status(200).json(status);
    });

    app.listen(PORT, () => {
      logger.rocket('Server started on port ' + 'http://localhost:' + PORT);
    });

    // Initialize license system
    logger.checkpoint('[APP-STARTUP] License system initialized - Expiry: 2026-03-31');

    if (!isLicenseValid()) {
      logger.error('[APP-STARTUP] ❌ LICENSE INVALID - Application cannot start');
      const licenseStatus = getLicenseStatus();
      logger.error(`[APP-STARTUP] License Status: ${licenseStatus.status}`);
      logger.error(`[APP-STARTUP] Expiry Date: ${licenseStatus.expiryDate}`);
      logger.error('[APP-STARTUP] Exiting process...');
      process.exit(1);
    }

    logger.success('[APP-STARTUP] ✓ License is valid - Application starting');

    await connectDB();
    const syncStates = loadAllSyncState();
    // logger.success('Loaded sync states for tables: ' + Object.keys(syncStates.tables || {}));

    const cronSchedule = process.env.CRON_SCHEDULE || '*/5 * * * *';
    // logger.rocket('Attendance Sync System Started');
    // logger.calendar(`Running on schedule: ${cronSchedule}`);

    cron.schedule(cronSchedule, syncAttendance);

    // Run initial sync
    // logger.info('initial sync')
    await syncAttendance();

  } catch (error) {
    logger.warning('Database connection failed - will retry on schedule');

    const cronSchedule = process.env.CRON_SCHEDULE || '*/5 * * * *';
    // logger.rocket('Attendance Sync System Started (DB retry mode)');
    // logger.calendar(`Running on schedule: ${cronSchedule}`);
    cron.schedule(cronSchedule, syncAttendance);
  }
};

start();
