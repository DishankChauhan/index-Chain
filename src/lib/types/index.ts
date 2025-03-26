export interface DatabaseConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  metadata?: Record<string, any>;
}
