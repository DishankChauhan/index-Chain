import { Pool, PoolClient } from 'pg';
import { AppError } from '@/lib/utils/errorHandling';
import { DatabaseConnection, DatabaseCredentials } from '@/types';
import prisma from '@/lib/db';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { SecretsManager } from '@/lib/utils/secrets';
import crypto from 'crypto';
import { DatabaseConnectionInput } from '../types';

export class DatabaseService {
  private static instance: DatabaseService;
  private pools: Map<string, Pool>;
  private secretsManager: SecretsManager;
  private encryptionKey: Buffer;
  private iv: Buffer;
  private poolConfig: { max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number; allowExitOnIdle: boolean };
  prisma: any;
  userId: any;

  private constructor() {
    this.pools = new Map();
    this.secretsManager = SecretsManager.getInstance();
    this.encryptionKey = crypto.randomBytes(32);
    this.iv = crypto.randomBytes(16);
    
    // Add default pool configuration
    this.poolConfig = {
      max: process.env.NODE_ENV === 'production' ? 20 : 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      allowExitOnIdle: true
    };
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public async initializeTables(dbConnection: DatabaseCredentials, categories: { [key: string]: boolean }): Promise<void> {
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      try {
        logInfo('Attempting to initialize tables', {
          component: 'DatabaseService',
          action: 'initializeTables',
          attempt: retryCount + 1,
          categories: JSON.stringify(categories)
        });

        const pool = await this.getPoolForApi(dbConnection);
        const client = await pool.connect();

        try {
          await client.query('BEGIN');

          // Create indexer state table first
          await client.query(`
            CREATE TABLE IF NOT EXISTS indexer_state (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `);

          // Create tables for enabled categories
          if (categories.transactions) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(100) UNIQUE NOT NULL,
                slot BIGINT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                success BOOLEAN NOT NULL,
                fee BIGINT NOT NULL,
                program_ids TEXT[],
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
              CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
              CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
            `);
          }

          if (categories.nftEvents) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS nft_events (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(100) UNIQUE NOT NULL,
                mint_address TEXT NOT NULL,
                event_type TEXT NOT NULL,
                price NUMERIC,
                buyer TEXT,
                seller TEXT,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_nft_events_signature ON nft_events(signature);
              CREATE INDEX IF NOT EXISTS idx_nft_events_mint ON nft_events(mint_address);
              CREATE INDEX IF NOT EXISTS idx_nft_events_timestamp ON nft_events(timestamp);
            `);
          }

          if (categories.tokenTransfers) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS token_transfers (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(100) NOT NULL,
                token_address TEXT NOT NULL,
                from_address TEXT NOT NULL,
                to_address TEXT NOT NULL,
                amount NUMERIC NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(signature, token_address)
              );
              CREATE INDEX IF NOT EXISTS idx_token_transfers_signature ON token_transfers(signature);
              CREATE INDEX IF NOT EXISTS idx_token_transfers_token ON token_transfers(token_address);
              CREATE INDEX IF NOT EXISTS idx_token_transfers_timestamp ON token_transfers(timestamp);
            `);
          }

          if (categories.programInteractions) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS program_interactions (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(100) NOT NULL,
                program_id TEXT NOT NULL,
                instruction_data JSONB NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(signature, program_id)
              );
              CREATE INDEX IF NOT EXISTS idx_program_interactions_signature ON program_interactions(signature);
              CREATE INDEX IF NOT EXISTS idx_program_interactions_program ON program_interactions(program_id);
              CREATE INDEX IF NOT EXISTS idx_program_interactions_timestamp ON program_interactions(timestamp);
            `);
          }

          if (categories.lendingProtocols) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS lending_protocols (
                id SERIAL PRIMARY KEY,
                program_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_lending_protocols_program ON lending_protocols(program_id);

              -- Insert known lending protocols
              INSERT INTO lending_protocols (program_id, name)
              VALUES 
                ('Port7uDYB3wk6GJAw4KT1WpTeMtSu9bTcChBHkX2LfR', 'Port Finance'),
                ('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend'),
                ('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi'),
                ('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY', 'Jet Protocol')
              ON CONFLICT (program_id) DO NOTHING;

              CREATE TABLE IF NOT EXISTS lending_pools (
                id SERIAL PRIMARY KEY,
                protocol_id INTEGER REFERENCES lending_protocols(id),
                pool_address TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(protocol_id, pool_address)
              );
              CREATE INDEX IF NOT EXISTS idx_lending_pools_protocol ON lending_pools(protocol_id);
              CREATE INDEX IF NOT EXISTS idx_lending_pools_address ON lending_pools(pool_address);

              CREATE TABLE IF NOT EXISTS lending_tokens (
                id SERIAL PRIMARY KEY,
                pool_id INTEGER REFERENCES lending_pools(id),
                mint_address TEXT NOT NULL,
                token_symbol TEXT NOT NULL,
                token_name TEXT NOT NULL,
                decimals INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pool_id, mint_address)
              );
              CREATE INDEX IF NOT EXISTS idx_lending_tokens_pool ON lending_tokens(pool_id);
              CREATE INDEX IF NOT EXISTS idx_lending_tokens_mint ON lending_tokens(mint_address);

              CREATE TABLE IF NOT EXISTS lending_rates (
                id SERIAL PRIMARY KEY,
                token_id INTEGER REFERENCES lending_tokens(id),
                borrow_rate NUMERIC NOT NULL,
                supply_rate NUMERIC NOT NULL,
                total_supply NUMERIC NOT NULL,
                available_liquidity NUMERIC NOT NULL,
                borrowed_amount NUMERIC NOT NULL,
                utilization_rate NUMERIC NOT NULL,
                collateral_factor NUMERIC NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_lending_rates_token ON lending_rates(token_id);
              CREATE INDEX IF NOT EXISTS idx_lending_rates_timestamp ON lending_rates(timestamp);

              -- Create a view for available tokens to borrow
              CREATE OR REPLACE VIEW available_lending_tokens AS
              WITH latest_rates AS (
                SELECT DISTINCT ON (token_id)
                  token_id,
                  borrow_rate,
                  supply_rate,
                  total_supply,
                  available_liquidity,
                  borrowed_amount,
                  utilization_rate,
                  collateral_factor,
                  timestamp
                FROM lending_rates
                WHERE timestamp >= NOW() - INTERVAL '1 hour'
                ORDER BY token_id, timestamp DESC
              )
              SELECT 
                lp.name as protocol_name,
                lpo.name as pool_name,
                lt.token_symbol,
                lt.token_name,
                lt.mint_address,
                lt.decimals,
                lr.borrow_rate,
                lr.supply_rate,
                lr.total_supply,
                lr.available_liquidity,
                lr.borrowed_amount,
                lr.utilization_rate,
                lr.collateral_factor,
                lr.timestamp as last_updated
              FROM latest_rates lr
              JOIN lending_tokens lt ON lt.id = lr.token_id
              JOIN lending_pools lpo ON lpo.id = lt.pool_id
              JOIN lending_protocols lp ON lp.id = lpo.protocol_id
              WHERE lr.available_liquidity > 0
              ORDER BY lr.borrow_rate ASC;
            `);
          }

          if (categories.tokenPlatforms) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS token_platforms (
                id SERIAL PRIMARY KEY,
                program_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                type TEXT NOT NULL, -- 'dex' or 'aggregator'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_token_platforms_program ON token_platforms(program_id);

              -- Insert known DEXs and aggregators
              INSERT INTO token_platforms (program_id, name, type)
              VALUES 
                ('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium', 'dex'),
                ('9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', 'Orca', 'dex'),
                ('JUP6i4ozu5ydDCnLiMogSckDPpbtr7BJ4FtzYWkb5Rk', 'Jupiter', 'aggregator'),
                ('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', 'Serum', 'dex')
              ON CONFLICT (program_id) DO NOTHING;

              CREATE TABLE IF NOT EXISTS token_pairs (
                id SERIAL PRIMARY KEY,
                platform_id INTEGER REFERENCES token_platforms(id),
                base_mint TEXT NOT NULL,
                quote_mint TEXT NOT NULL,
                pool_address TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(platform_id, pool_address)
              );
              CREATE INDEX IF NOT EXISTS idx_token_pairs_platform ON token_pairs(platform_id);
              CREATE INDEX IF NOT EXISTS idx_token_pairs_base_mint ON token_pairs(base_mint);
              CREATE INDEX IF NOT EXISTS idx_token_pairs_quote_mint ON token_pairs(quote_mint);
              CREATE INDEX IF NOT EXISTS idx_token_pairs_pool ON token_pairs(pool_address);

              CREATE TABLE IF NOT EXISTS token_prices (
                id SERIAL PRIMARY KEY,
                pair_id INTEGER REFERENCES token_pairs(id),
                price NUMERIC NOT NULL,
                volume_24h NUMERIC NOT NULL,
                liquidity NUMERIC NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_token_prices_pair ON token_prices(pair_id);
              CREATE INDEX IF NOT EXISTS idx_token_prices_timestamp ON token_prices(timestamp);

              -- Create a view for current token prices
              CREATE OR REPLACE VIEW current_token_prices AS
              WITH latest_prices AS (
                SELECT DISTINCT ON (pair_id)
                  pair_id,
                  price,
                  volume_24h,
                  liquidity,
                  timestamp
                FROM token_prices
                WHERE timestamp >= NOW() - INTERVAL '1 hour'
                ORDER BY pair_id, timestamp DESC
              )
              SELECT 
                tp.base_mint,
                tp.quote_mint,
                tpl.name as platform_name,
                tpl.type as platform_type,
                tp.pool_address,
                lp.price,
                lp.volume_24h,
                lp.liquidity,
                lp.timestamp as last_updated
              FROM latest_prices lp
              JOIN token_pairs tp ON tp.id = lp.pair_id
              JOIN token_platforms tpl ON tpl.id = tp.platform_id
              WHERE lp.liquidity > 0
              ORDER BY lp.volume_24h DESC;

              -- Create a view for token price aggregation
              CREATE OR REPLACE VIEW aggregated_token_prices AS
              WITH latest_prices AS (
                SELECT DISTINCT ON (pair_id)
                  pair_id,
                  price,
                  volume_24h,
                  liquidity,
                  timestamp
                FROM token_prices
                WHERE timestamp >= NOW() - INTERVAL '1 hour'
                ORDER BY pair_id, timestamp DESC
              )
              SELECT 
                tp.base_mint,
                tp.quote_mint,
                COUNT(*) as platform_count,
                MIN(lp.price) as min_price,
                MAX(lp.price) as max_price,
                AVG(lp.price) as avg_price,
                SUM(lp.volume_24h) as total_volume_24h,
                SUM(lp.liquidity) as total_liquidity,
                json_agg(
                  json_build_object(
                    'platform', tpl.name,
                    'type', tpl.type,
                    'pool', tp.pool_address,
                    'price', lp.price,
                    'volume', lp.volume_24h,
                    'liquidity', lp.liquidity,
                    'timestamp', lp.timestamp
                  )
                  ORDER BY lp.volume_24h DESC
                ) as platforms
              FROM latest_prices lp
              JOIN token_pairs tp ON tp.id = lp.pair_id
              JOIN token_platforms tpl ON tpl.id = tp.platform_id
              WHERE lp.liquidity > 0
              GROUP BY tp.base_mint, tp.quote_mint;
            `);
          }

          // Create NFT bids table
          if (categories.nftBids) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS nft_bids (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(100) NOT NULL,
                mint_address TEXT NOT NULL,
                bidder_address TEXT NOT NULL,
                bid_amount NUMERIC NOT NULL,
                marketplace TEXT NOT NULL,
                status TEXT NOT NULL,
                expires_at TIMESTAMP,
                timestamp TIMESTAMP NOT NULL,
                raw_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_nft_bids_signature ON nft_bids(signature);
              CREATE INDEX IF NOT EXISTS idx_nft_bids_mint ON nft_bids(mint_address);
            `);
          }

          // Create NFT prices table
          if (categories.nftPrices) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS nft_prices (
                id SERIAL PRIMARY KEY,
                nft_address TEXT NOT NULL,
                collection_address TEXT NOT NULL,
                price_sol NUMERIC NOT NULL,
                price_usd NUMERIC,
                marketplace TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_nft_prices_address ON nft_prices(nft_address);
            `);
          }

          // Create token prices table
          if (categories.tokenPrices) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS token_prices (
                id SERIAL PRIMARY KEY,
                token_mint TEXT NOT NULL,
                token_name TEXT NOT NULL,
                price_usd NUMERIC NOT NULL,
                volume_24h NUMERIC,
                platform TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_token_prices_token ON token_prices(token_mint);
            `);
          }

          // Create token borrowing table
          if (categories.tokenBorrowing) {
            await client.query(`
              CREATE TABLE IF NOT EXISTS lending_rates (
                id SERIAL PRIMARY KEY,
                token_mint TEXT NOT NULL,
                token_name TEXT NOT NULL,
                supply_apy NUMERIC NOT NULL,
                borrow_apy NUMERIC NOT NULL,
                platform TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              CREATE INDEX IF NOT EXISTS idx_lending_rates_token ON lending_rates(token_mint);
            `);
          }

          await client.query('COMMIT');
          
          logInfo('Tables initialized successfully', {
            component: 'DatabaseService',
            action: 'initializeTables',
            attempt: retryCount + 1
          });
          
          return;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        lastError = error as Error;
        retryCount++;
        
        logError('Failed to initialize tables', error as Error, {
          component: 'DatabaseService',
          action: 'initializeTables',
          attempt: retryCount,
          maxRetries
        });

        if (retryCount === maxRetries) {
          throw new AppError(
            `Failed to initialize tables after ${maxRetries} attempts: ${lastError.message}`
          );
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
      }
    }
  }

  public async listConnections(userId: string) {
    try {
      const connections = await prisma.databaseConnection.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          host: true,
          port: true,
          database: true,
          username: true,
          status: true,
          lastConnectedAt: true,
          createdAt: true
        }
      });
      return connections;
    } catch (error) {
      throw new AppError('Failed to list database connections');
    }
  }

  private async createPool(credentials: DatabaseConnectionInput): Promise<Pool> {
    const pool = new Pool({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      ssl: process.env.NODE_ENV === 'production',
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test the connection
    try {
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      return pool;
    } catch (error) {
      await pool.end();
      throw new AppError('Failed to connect to database');
    }
  }

  public async testConnection(credentials: DatabaseConnectionInput): Promise<boolean> {
    try {
      const pool = await this.createPool(credentials);
      await pool.end();
      return true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Database connection test failed'
      );
    }
  }

  public async encryptPassword(password: string): Promise<string> {
    try {
      const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, this.iv);
      let encrypted = cipher.update(password, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch (error) {
      throw new AppError('Failed to encrypt password');
    }
  }

  public async saveConnection(connectionDetails: DatabaseConnectionInput): Promise<DatabaseConnection> {
    try {
      // Test the connection before proceeding
      await this.testConnection(connectionDetails);

      // Encrypt the password
      const encryptedPassword = this.encryptPassword(connectionDetails.password);

      // Save the connection using a transaction
      const conn = await this.prisma.$transaction(async (tx: { databaseConnection: { create: (arg0: { data: { host: string; port: number; database: string; username: string; password: Promise<string>; metadata: Record<string, any>; userId: any; status: string; }; select: { id: boolean; host: boolean; port: boolean; database: boolean; username: boolean; status: boolean; metadata: boolean; createdAt: boolean; updatedAt: boolean; }; }) => any; }; }) => {
        const connection = await tx.databaseConnection.create({
          data: {
            host: connectionDetails.host,
            port: connectionDetails.port,
            database: connectionDetails.database,
            username: connectionDetails.username,
            password: encryptedPassword,
            metadata: connectionDetails.metadata || {},
            userId: this.userId,
            status: 'ACTIVE'
          },
          select: {
            id: true,
            host: true,
            port: true,
            database: true,
            username: true,
            status: true,
            metadata: true,
            createdAt: true,
            updatedAt: true
          }
        });

        return connection;
      });

      return conn;
    } catch (error) {
      throw new AppError('Failed to save database connection', 500);
    }
  }

  public async getConnection(connectionId: string, userId: string): Promise<Pool> {
    try {
      const connection = await prisma.databaseConnection.findFirst({
        where: { id: connectionId, userId },
      });

      if (!connection) {
        throw new AppError('Database connection not found');
      }

      // Check if we already have a pool
      let pool = this.pools.get(connectionId);
      if (!pool) {
        // For test environment, use the stored password directly
        const password = process.env.NODE_ENV === 'development' ? 
          connection.password : 
          await this.decryptPassword(connection.password);

        pool = await this.createPool({
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          password: password,
        });
        this.pools.set(connectionId, pool);
      }

      return pool;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to get database connection');
    }
  }

  public async updateConnectionStatus(
    connectionId: string,
    userId: string,
    status: string
  ): Promise<void> {
    try {
      await prisma.databaseConnection.update({
        where: { 
          id: connectionId,
          userId: userId 
        },
        data: {
          status,
          lastConnectedAt: status === 'active' ? new Date() : undefined,
        },
      });
    } catch (error) {
      throw new AppError(
        'Failed to update connection status'
      );
    }
  }
  public async cleanup(): Promise<void> {
    for (const pool of Array.from(this.pools.values())) {
      await pool.end();
    }
    this.pools.clear();
  }

  public async getPoolForApi(credentials: DatabaseCredentials): Promise<Pool> {
    try {
      const pool = await this.createPool(credentials);
      return pool;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to create database pool'
      );
    }
  }

  private async decryptPassword(key: string): Promise<string> {
    return await this.secretsManager.getSecret(key);
  }

  public async validateConnection(credentials: DatabaseCredentials): Promise<{ valid: boolean; error?: string; details?: { [key: string]: any } }> {
    try {
      // Step 1: Basic validation
      if (!this.validateCredentialsFormat(credentials)) {
        return { 
          valid: false, 
          error: 'Invalid credentials format',
          details: {
            host: !credentials.host ? 'Host is required' : null,
            port: !credentials.port || credentials.port <= 0 || credentials.port > 65535 ? 'Invalid port number' : null,
            database: !credentials.database ? 'Database name is required' : null,
            username: !credentials.username ? 'Username is required' : null,
            password: !credentials.password ? 'Password is required' : null
          }
        };
      }

      // Step 2: Create pool with timeout
      const pool = new Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.username,
        password: credentials.password,
        ...this.poolConfig,
        connectionTimeoutMillis: 5000 // 5 second timeout
      });

      // Step 3: Test basic connectivity
      const client = await pool.connect();
      try {
        // Check if we can execute queries
        await client.query('SELECT NOW()');
        
        // Check if we have necessary permissions
        const permissionsCheck = await this.checkDatabasePermissions(client);
        if (!permissionsCheck.valid) {
          return {
            valid: false,
            error: 'Insufficient database permissions',
            details: permissionsCheck.details
          };
        }

        // Check database version
        const versionCheck = await this.checkDatabaseVersion(client);
        if (!versionCheck.valid) {
          return {
            valid: false,
            error: 'Unsupported database version',
            details: versionCheck.details
          };
        }

        // Check available space
        const spaceCheck = await this.checkDatabaseSpace(client);
        if (!spaceCheck.valid) {
          return {
            valid: false,
            error: 'Insufficient database space',
            details: spaceCheck.details
          };
        }

        return { 
          valid: true,
          details: {
            version: versionCheck.details?.version,
            availableSpace: spaceCheck.details?.availableSpace,
            permissions: permissionsCheck.details?.permissions
          }
        };
      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      logError('Database connection validation failed', error as Error, {
        component: 'DatabaseService',
        action: 'validateConnection',
        host: credentials.host,
        port: credentials.port,
        database: credentials.database
      });

      let errorMessage = 'Failed to connect to database';
      if (error instanceof Error) {
        if (error.message.includes('connect ETIMEDOUT')) {
          errorMessage = 'Connection timed out. Please check if the database is accessible.';
        } else if (error.message.includes('password authentication failed')) {
          errorMessage = 'Invalid username or password.';
        } else if (error.message.includes('database does not exist')) {
          errorMessage = 'Database does not exist.';
        } else if (error.message.includes('role does not exist')) {
          errorMessage = 'User does not exist.';
        }
      }

      return { 
        valid: false, 
        error: errorMessage,
        details: {
          originalError: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  private validateCredentialsFormat(credentials: DatabaseCredentials): boolean {
    return !!(
      credentials.host &&
      credentials.port &&
      credentials.port > 0 &&
      credentials.port <= 65535 &&
      credentials.database &&
      credentials.username &&
      credentials.password
    );
  }

  private async checkDatabasePermissions(client: PoolClient): Promise<{ valid: boolean; details?: { permissions: string[] } }> {
    try {
      // Check for necessary permissions
      const requiredPermissions = [
        'CREATE TABLE',
        'INSERT',
        'SELECT',
        'UPDATE',
        'DELETE'
      ];
      
      const permissionsQuery = `
        SELECT privilege_type 
        FROM information_schema.role_table_grants 
        WHERE grantee = current_user;
      `;
      
      const result = await client.query(permissionsQuery);
      const grantedPermissions = result.rows.map(row => row.privilege_type);
      
      const missingPermissions = requiredPermissions.filter(
        perm => !grantedPermissions.includes(perm)
      );

      return {
        valid: missingPermissions.length === 0,
        details: {
          permissions: grantedPermissions
        }
      };
    } catch (error) {
      logError('Failed to check database permissions', error as Error);
      return { valid: true }; // Assume valid if we can't check
    }
  }

  private async checkDatabaseVersion(client: PoolClient): Promise<{ valid: boolean; details?: { version: string } }> {
    try {
      const result = await client.query('SHOW server_version;');
      const version = result.rows[0].server_version;
      const versionNum = parseFloat(version);
      
      return {
        valid: versionNum >= 10.0, // Require PostgreSQL 10 or higher
        details: {
          version
        }
      };
    } catch (error) {
      logError('Failed to check database version', error as Error);
      return { valid: true }; // Assume valid if we can't check
    }
  }

  private async checkDatabaseSpace(client: PoolClient): Promise<{ valid: boolean; details?: { availableSpace: string } }> {
    try {
      const query = `
        SELECT pg_size_pretty(pg_database_size(current_database())) as size,
               pg_size_pretty(pg_tablespace_size(current_database())) as available;
      `;
      
      const result = await client.query(query);
      const availableSpace = result.rows[0].available;
      
      // Convert to bytes for comparison (assuming format like '100 MB')
      const spaceMatch = availableSpace.match(/(\d+)\s*(\w+)/);
      if (spaceMatch) {
        const [, amount, unit] = spaceMatch;
        const multiplier = unit.toLowerCase() === 'gb' ? 1024 * 1024 * 1024 :
                         unit.toLowerCase() === 'mb' ? 1024 * 1024 :
                         unit.toLowerCase() === 'kb' ? 1024 : 1;
        
        const availableBytes = parseInt(amount) * multiplier;
        const minRequired = 100 * 1024 * 1024; // 100MB minimum
        
        return {
          valid: availableBytes >= minRequired,
          details: {
            availableSpace
          }
        };
      }
      
      return { valid: true }; // Assume valid if we can't parse
    } catch (error) {
      logError('Failed to check database space', error as Error);
      return { valid: true }; // Assume valid if we can't check
    }
  }
} 