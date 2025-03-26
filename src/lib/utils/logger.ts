import winston from 'winston';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');

interface LogMetadata {
  component?: string;
  action?: string;
  userId?: string;
  message?: string;
  error?: Error;
  [key: string]: any;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log') 
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

const AppLogger = {
  info: (message: string, metadata?: LogMetadata) => {
    logger.info(message, metadata);
  },
  error: (message: string, error: Error | null, metadata?: LogMetadata) => {
    logger.error(message, { ...metadata, error });
  },
  warn: (message: string, metadata?: LogMetadata) => {
    logger.warn(message, metadata);
  },
  debug: (message: string, metadata?: LogMetadata) => {
    logger.debug(message, metadata);
  }
};

export default AppLogger;

export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  private formatMessage(level: string, message: string, meta?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const metaString = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] [${this.component}] ${message}${metaString}`;
  }

  info(message: string, meta?: Record<string, any>): void {
    console.log(this.formatMessage('INFO', message, meta));
  }

  error(message: string, meta?: Record<string, any>): void {
    console.error(this.formatMessage('ERROR', message, meta));
  }

  warn(message: string, meta?: Record<string, any>): void {
    console.warn(this.formatMessage('WARN', message, meta));
  }

  debug(message: string, meta?: Record<string, any>): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('DEBUG', message, meta));
    }
  }
} 