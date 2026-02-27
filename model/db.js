const sql = require("mssql");
const path = require('path');
require('dotenv').config();


// Validate required environment variables
const requiredEnvVars = ['DB_SERVER', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Current environment variables:', process.env);
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

const connectDB = async () => {
  try {
    // console.log('Attempting to connect to database with config:', {
    //   server: config.server,
    //   database: config.database,
    //   port: config.port,
    //   user: config.user
    // });
    
    await sql.connect(config);
    console.log("✅ Database connected successfully!");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
};

// Function to generate table name based on month and year

const getTableName = (year, month) => {
  // Format month as 2 digits (01-12)
  const monthStr = String(month).padStart(2, '0');
  console.log(`Generated table name for ${year}-${month}: T_LG${year}${monthStr}`);
  return `T_LG${year}${monthStr}`;
};

// Function to fetch data from dynamic table based on month/year

const fetchDataByMonth = async (year, month, columnName = '*') => {
  try {
    const tableName = getTableName(year, month);
    console.log(`Table is ready, start...: ${tableName}`);

    const request = new sql.Request();
    const query = `SELECT ${columnName} FROM [${tableName}]`;

    const result = await request.query(query);
    console.log(`✅ Data fetched successfully from ${tableName}! Rows: ${result.recordset.length}`);
    return result.recordset;
  } catch (error) {
    console.error(`❌ Error fetching data from table:`, error.message);
    throw error;
  }
};

// Function to fetch data for current month
const fetchCurrentMonthData = async (columnName = '*') => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // getMonth() returns 0-11
  
  return fetchDataByMonth(year, month, columnName);
};

// Function to fetch data for multiple months (e.g., current and next month)
const fetchMultipleMonths = async (months, columnName = '*') => {
  try {
    const results = {};
    const now = new Date();
    const currentYear = now.getFullYear();

    for (const monthOffset of months) {
      let year = currentYear;
      let month = now.getMonth() + 1 + monthOffset;

      // Handle year rollover
      if (month > 12) {
        year += Math.floor((month - 1) / 12);
        month = ((month - 1) % 12) + 1;
      }

      const tableName = getTableName(year, month);
      const data = await fetchDataByMonth(year, month, columnName);
      results[tableName] = data;
    }

    return results;
  } catch (error) {
    console.error('❌ Error fetching multiple months data:', error.message);
    throw error;
  }
};

// Function to check if table exists
// const tableExists = async (tableName) => {
//   try {
//     const request = new sql.Request();
//     const query = `
//       SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
//       WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = '${tableName}'
//     `;
//     const result = await request.query(query);
//     return result.recordset.length > 0;
//   } catch (error) {
//     console.error(`❌ Error checking table existence:`, error.message);
//     throw error;
//   }
// };

const tableExists = async (tableName) => {
  try {
    const request = new sql.Request();
    request.input('tableName', sql.VarChar, tableName);

    const result = await request.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME = @tableName
    `);

    return result.recordset.length > 0;

  } catch (error) {
    console.error('❌ Error checking table existence:', error.message);
    throw error; // rethrow so caller knows
  }
};



// Function to create table with same structure as source table
const createTableIfNotExists = async (destTableName, sourceTableName) => {
  try {
    const exists = await tableExists(destTableName);
    
    if (exists) {
      console.log(`✅ Table [${destTableName}] already exists`);
      return true;
    }

    console.log(`Creating table [${destTableName}] based on [${sourceTableName}]...`);
    
    const request = new sql.Request();
    const createQuery = `
      SELECT * INTO [${destTableName}] 
      FROM [${sourceTableName}] 
      WHERE 1 = 0
    `;
    
    await request.query(createQuery);
    console.log(`✅ Table [${destTableName}] created successfully!`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating table:`, error.message);
    throw error;
  }
};

// Function to insert data into destination table
const insertDataIntoTable = async (destTableName, data) => {
  try {
    if (!data || data.length === 0) {
      console.log('⚠️ No data to insert');
      return { inserted: 0 };
    }

    const request = new sql.Request();
    
    // Get column names from first row
    const columns = Object.keys(data[0]);
    const columnList = columns.map(col => `[${col}]`).join(', ');
    
    let insertedCount = 0;

    // Insert each row
    for (const row of data) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) {
          return 'NULL';
        } else if (typeof val === 'string') {
          return `'${val.replace(/'/g, "''")}'`;
        } else if (typeof val === 'boolean') {
          return val ? 1 : 0;
        } else {
          return val;
        }
      }).join(', ');

      const insertQuery = `INSERT INTO [${destTableName}] (${columnList}) VALUES (${values})`;
      await request.query(insertQuery);
      insertedCount++;
    }

    console.log(`✅ Successfully inserted ${insertedCount} rows into [${destTableName}]`);
    return { inserted: insertedCount };
  } catch (error) {
    console.error(`❌ Error inserting data:`, error.message);
    throw error;
  }
};

// Function to fetch and write data (complete workflow)
const fetchAndWriteCurrentMonthData = async (destTableName) => {
  try {
    // Get current month data
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const sourceTableName = getTableName(year, month);

    console.log(`\n📋 Starting fetch and write process...`);
    console.log(`Source: [${sourceTableName}] | Destination: [${destTableName}]\n`);

    // Fetch data from source
    const data = await fetchDataByMonth(year, month);

    // Create destination table if not exists
    await createTableIfNotExists(destTableName, sourceTableName);

    // Insert data into destination
    const result = await insertDataIntoTable(destTableName, data);

    return {
      success: true,
      sourceTable: sourceTableName,
      destTable: destTableName,
      totalFetched: data.length,
      totalInserted: result.inserted
    };
  } catch (error) {
    console.error('❌ Error in fetch and write process:', error.message);
    throw error;
  }
};

// Function to start automatic fetch and write scheduler (every 5 minutes)
const startAutoFetchScheduler = (intervalMinutes = 5) => {
  const intervalMs = intervalMinutes * 60 * 1000;
  
  console.log(`⏰ Starting auto-fetch scheduler: Every ${intervalMinutes} minutes`);
  
  // Run immediately on start
  const runFetch = async () => {
    try {
      const timestamp = new Date().toLocaleString();
      console.log(`\n📅 [${timestamp}] Running scheduled fetch...`);
      const result = await fetchAndWriteCurrentMonthData('filteredattendance');
      console.log(`✅ Scheduled fetch completed: ${result.totalInserted} rows inserted\n`);
    } catch (error) {
      console.error(`❌ Scheduled fetch failed: ${error.message}\n`);
    }
  };

  // Run on interval
  setInterval(runFetch, intervalMs);
  
  // Also run immediately
  runFetch();
};

module.exports = { 
  connectDB, 
  sql, 
  getTableName, 
  fetchDataByMonth, 
  fetchCurrentMonthData, 
  fetchMultipleMonths,
  tableExists,
  createTableIfNotExists,
  insertDataIntoTable,
  fetchAndWriteCurrentMonthData,
  startAutoFetchScheduler
};