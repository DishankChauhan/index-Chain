import winston, { format } from 'winston';

interface LogContext {
  component: string;
  action?: string;
  [key: string]: any;
}

interface LogMetadata {
  level: string;
  message: string;
  timestamp: string;
  metadata: Record<string, any>;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.metadata(),
    format.json()
  ),
  defaultMeta: { service: 'blockchain-indexer' },
  transports: [
    // Write all logs with importance level of 'error' or less to 'error.log'
    new winston.transports.File({ 
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with importance level of 'info' or less to 'combined.log'
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ],
});

// If we're not in production, log to the console with colors
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple(),
      format.printf((info) => {
        const metadata = info.metadata || {};
        return `${info.timestamp || new Date().toISOString()} ${info.level}: ${info.message} ${Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : ''}`;
      })
    ),
  }));
}

export function logInfo(message: string, context: LogContext): void {
  logger.info(message, { metadata: context });
}

export function logError(message: string, error: Error, context: LogContext): void {
  logger.error(message, {
    metadata: {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
  });
}

export function logWarn(message: string, context: LogContext): void {
  logger.warn(message, { metadata: context });
}

export function logDebug(message: string, context: LogContext): void {
  logger.debug(message, { metadata: context });
}

// Export the logger instance for more complex logging needs
export { logger }; 