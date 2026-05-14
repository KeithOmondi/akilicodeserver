import app from './app';
import env from './config/env';
import pool from './config/db';
import cron from 'node-cron';
import { sendPaymentReminders } from './utils/sendPaymentReminders';
import { CodeExecutionSocket } from './service/CodeExecutionSocket';

/**
 * Safety Net: Handle Uncaught Exceptions
 */
process.on('uncaughtException', (err: Error) => {
  console.error('UNCAUGHT EXCEPTION! 💥');
  console.error(`${err.name}: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

let codeExecutionSocket: CodeExecutionSocket | null = null;

const startCronJobs = () => {
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('⏰ Running payment reminder job...');
      try {
        await sendPaymentReminders();
      } catch (error) {
        console.error('❌ Payment reminder job failed:', error);
      }
    },
    { timezone: 'Africa/Nairobi' }
  );
  console.log('⏰ Cron jobs scheduled');
};

const startServer = async () => {
  let server: any = null;
  
  try {
    // 1. Test Database Connection
    const client = await pool.connect();
    console.log('🐘 Database connection verified');
    client.release();

    // 2. Start HTTP Server FIRST
    server = app.listen(env.PORT, () => {
      console.log(`🚀 Server locked and loaded on port ${env.PORT}`);
      console.log(`🛡️  Mode: ${env.NODE_ENV}`);
    });

    // 3. Initialize WebSocket AFTER server is created
    try {
      codeExecutionSocket = new CodeExecutionSocket(server);
      console.log('🔌 WebSocket server initialized for interactive code execution');
    } catch (wsError) {
      console.error('⚠️ WebSocket initialization failed:', wsError);
      console.log('💡 Interactive code execution will not be available');
    }

    // 4. Handle Unhandled Rejections
    process.on('unhandledRejection', (err: Error) => {
      console.error('UNHANDLED REJECTION! 💥');
      console.error(`${err.name}: ${err.message}`);
      console.error(err.stack);
      server?.close(() => process.exit(1));
    });

    // 5. Graceful Shutdown
    process.on('SIGTERM', async () => {
      console.log('👋 SIGTERM received. Shutting down gracefully...');
      if (codeExecutionSocket) {
        await codeExecutionSocket.cleanup();
      }
      server?.close(() => {
        console.log('💀 Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('👋 SIGINT received. Shutting down gracefully...');
      if (codeExecutionSocket) {
        await codeExecutionSocket.cleanup();
      }
      server?.close(() => {
        console.log('💀 Process terminated');
        process.exit(0);
      });
    });

    return server;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    if (server) {
      server.close(() => process.exit(1));
    } else {
      process.exit(1);
    }
  }
};

// Start the application
startServer();
startCronJobs();