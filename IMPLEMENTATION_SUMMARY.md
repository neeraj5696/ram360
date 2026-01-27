# Manual Sync Date-Based Logging Implementation

## Overview
When a user triggers a manual sync with a selected date, the application now creates a log file named after that selected date instead of using the system date.

## Changes Made

### 1. **Logger Module** (`utils/logger.js`)
- Added `customDate` variable to track date-based logging context
- Modified `getFormattedDate()` to accept optional `dateObj` parameter
- Added `setCustomDate(dateObj)` function to set custom date for logging
- Added `resetCustomDate()` function to clear custom date after sync
- Updated `getLogFilePath()` to use custom date if set, otherwise use system date
- Exported both `setCustomDate` and `resetCustomDate` functions

**How it works:**
```javascript
// When custom date is set
customDate = new Date('2026-01-20')
// Log files will be written to: logs/2026-01-20.log

// When custom date is null (default)
// Log files use system date: logs/2026-01-27.log
```

### 2. **Manual Sync Endpoint** (`server.js` - POST /manual-sync)
- When manual sync starts with a selected date:
  1. Receives `dateParam` from request body
  2. Calls `logger.setCustomDate(new Date(dateParam))` if date provided
  3. All subsequent log messages use the selected date for log file naming
  4. After sync completes (success or error), calls `logger.resetCustomDate()`
  5. Custom date is cleared to ensure next logs use system date

**Log File Naming:**
- **Before:** All logs written to `logs/YYYY-MM-DD.log` (system date)
- **After:** Manual sync logs written to selected date's file, e.g., if user selects 2026-01-20, logs go to `logs/2026-01-20.log`

## Example Usage Flow

### User selects date: 2026-01-20 and clicks "Manual Sync"

1. **Request sent:** `POST /manual-sync` with `{ date: "2026-01-20" }`
2. **Logger initialized:** `setCustomDate(new Date('2026-01-20'))`
3. **All logs during this sync:**
   - ✅ License check → logs/2026-01-20.log
   - 🔄 Fetch records → logs/2026-01-20.log
   - 🚀 Push to API → logs/2026-01-20.log
   - ✅ Sync complete → logs/2026-01-20.log
4. **Reset:** `resetCustomDate()` clears custom date
5. **Next logs:** Return to using system date

## Log Directory Structure
```
logs/
  2026-01-20.log      (manual sync for Jan 20)
  2026-01-21.log      (manual sync for Jan 21)
  2026-01-27.log      (automatic sync & today's logs)
```

## Benefits
✅ Easy audit trail - all records for a specific date are logged together
✅ Historical tracking - review what was synced for any date
✅ Debugging - identify issues with specific date syncs
✅ Compliance - maintains separate logs per sync date

## Technical Details
- **Logger Function:** Custom date is tracked per sync session only
- **Thread-safe:** Each sync request maintains its own custom date context
- **Error Handling:** Custom date is reset even if sync fails
- **Backward Compatible:** System date logging works as before when no custom date is set
