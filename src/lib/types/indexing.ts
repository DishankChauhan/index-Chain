import { DatabaseConnection } from '@prisma/client';

export interface IndexingConfig {
  type: string;
  categories: string[];
  filters?: {
    accountAddresses?: string[];
    startSlot?: number;
    endSlot?: number;
    transactionTypes?: string[];
  };
  webhook?: {
    enabled: boolean;
    url?: string;
    secret?: string;
  };
  historical?: {
    enabled: boolean;
    filters?: {
      accountAddresses?: string[];
      startSlot?: number;
      endSlot?: number;
      transactionTypes?: string[];
    };
  };
  metadata?: {
    tablesCreated?: boolean;
    webhookSetup?: boolean;
    lastProcessedSlot?: number;
    lastProcessedTimestamp?: string;
  };
}

export interface IndexingJob {
  id: string;
  userId: string;
  dbConnectionId: string;
  type: string;
  config: IndexingConfig;
  status: string;
  progress: number;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  databaseConnection: DatabaseConnection;
}

export interface IndexingStatus {
  status: string;
  progress: number;
  lastRunAt?: Date;
  webhooks: Array<{
    id: string;
    url: string;
    status: string;
  }>;
  lastProcessedData?: Date;
} 