import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'react-hot-toast';

// Validation schema
const configSchema = z.object({
  dbConnectionId: z.string().min(1, "Please select a database connection"),
  categories: z.object({
    transactions: z.boolean(),
    nftEvents: z.boolean(),
    tokenTransfers: z.boolean(),
    accountActivity: z.boolean(),
    programInteractions: z.boolean(),
    defiTransactions: z.boolean(),
    governance: z.boolean(),
    nftBids: z.boolean(),
    nftPrices: z.boolean(),
    tokenPrices: z.boolean(),
    tokenBorrowing: z.boolean(),
  }),
  filters: z.object({
    programIds: z.string(),
    accounts: z.string(),
    startSlot: z.string().optional(),
    includeMints: z.boolean(),
    includeMetadata: z.boolean(),
  }),
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().refine(
      (val) => {
        if (!val) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Please enter a valid URL" }
    ),
    secret: z.string().min(32, "Secret must be at least 32 characters long").optional(),
  }).refine(
    (data) => {
      if (data.enabled) {
        return !!data.url && !!data.secret;
      }
      return true;
    },
    {
      message: "URL and secret are required when webhook is enabled",
      path: ["url"]
    }
  ),
});

type FormValues = z.infer<typeof configSchema>;

type IndexingConfig = {
  dbConnectionId: string;
  categories: FormValues['categories'];
  filters: {
    programIds: string[];
    accounts: string[];
    startSlot?: number;
    includeMints: boolean;
    includeMetadata: boolean;
  };
  webhook: FormValues['webhook'];
};

interface DatabaseConnection {
  id: string;
  host: string;
  port: number;
  database: string;
  username: string;
  status: string;
}

interface Props {
  onSubmit: (config: IndexingConfig) => Promise<void>;
  isLoading?: boolean;
}

export default function IndexingConfigForm({ onSubmit, isLoading }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  
  useEffect(() => {
    // Fetch database connections
    const fetchConnections = async () => {
      try {
        const response = await fetch('/api/connections');
        if (!response.ok) {
          throw new Error('Failed to fetch connections');
        }
        const data = await response.json();
        setConnections(data.data || []);
      } catch (error) {
        console.error('Error fetching connections:', error);
        toast.error('Failed to load database connections');
      }
    };
    
    fetchConnections();
  }, []);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      categories: {
        transactions: false,
        nftEvents: false,
        tokenTransfers: false,
        accountActivity: false,
        programInteractions: false,
        defiTransactions: false,
        governance: false,
        nftBids: false,
        nftPrices: false,
        tokenPrices: false,
        tokenBorrowing: false,
      },
      filters: {
        programIds: '',
        accounts: '',
        startSlot: '',
        includeMints: false,
        includeMetadata: false,
      },
      webhook: {
        enabled: false,
        url: '',
        secret: '',
      },
    },
  });

  const watchWebhookEnabled = watch('webhook.enabled');

  const processFormData = (data: FormValues): IndexingConfig => {
    return {
      dbConnectionId: data.dbConnectionId,
      categories: data.categories,
      filters: {
        programIds: data.filters.programIds.split(',').map(id => id.trim()).filter(Boolean),
        accounts: data.filters.accounts.split(',').map(addr => addr.trim()).filter(Boolean),
        startSlot: data.filters.startSlot ? parseInt(data.filters.startSlot) : undefined,
        includeMints: data.filters.includeMints,
        includeMetadata: data.filters.includeMetadata,
      },
      webhook: data.webhook,
    };
  };

  const onFormSubmit = async (data: FormValues) => {
    try {
      await onSubmit(processFormData(data));
    } catch (error) {
      console.error('Error submitting form:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-8">
      <div>
        <h2 className="text-lg font-medium mb-4 text-white">Database Connection</h2>
        <div>
          <label htmlFor="dbConnectionId" className="block text-sm font-medium text-white">
            Select a database connection
          </label>
          <div className="mt-1">
            <select
              {...register('dbConnectionId')}
              className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm text-gray-900 ${
                errors.dbConnectionId ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
              }`}
            >
              <option value="">Select a connection</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.database}@{conn.host}:{conn.port} ({conn.status})
                </option>
              ))}
            </select>
            {errors.dbConnectionId && (
              <p className="mt-2 text-sm text-red-600">{errors.dbConnectionId.message}</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 text-white">Categories</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.transactions')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Transactions</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.nftEvents')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">NFT Events</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.tokenTransfers')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Token Transfers</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.accountActivity')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Account Activity</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.programInteractions')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Program Interactions</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.defiTransactions')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">DeFi Transactions</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.governance')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Governance</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.nftBids')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">NFT Bids</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.nftPrices')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">NFT Prices</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.tokenPrices')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Token Prices</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" {...register('categories.tokenBorrowing')} className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" />
              <span className="text-white">Token Borrowing</span>
            </label>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 text-white">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="programIds" className="block text-sm font-medium text-white">
              Program IDs
            </label>
            <input
              type="text"
              {...register('filters.programIds')}
              placeholder="Comma-separated program IDs"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-gray-900"
            />
          </div>
          <div>
            <label htmlFor="accounts" className="block text-sm font-medium text-white">
              Account Addresses
            </label>
            <input
              type="text"
              {...register('filters.accounts')}
              placeholder="Comma-separated account addresses"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-gray-900"
            />
          </div>
          <div>
            <label htmlFor="startSlot" className="block text-sm font-medium text-white">
              Start Slot (Optional)
            </label>
            <input
              type="number"
              {...register('filters.startSlot')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-gray-900"
            />
          </div>
          <div className="space-y-4">
            <div>
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  {...register('filters.includeMints')}
                  className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="text-white">Include Mints</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  {...register('filters.includeMetadata')}
                  className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="text-white">Include Metadata</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 text-white">Webhook Configuration</h2>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                {...register('webhook.enabled')}
                className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <span className="text-white">Enable Webhook</span>
            </label>
          </div>
          
          {watchWebhookEnabled && (
            <div className="space-y-4 ml-8 mt-2">
              <div>
                <label htmlFor="webhookUrl" className="block text-sm font-medium text-white">
                  Webhook URL
                </label>
                <input
                  type="url"
                  {...register('webhook.url')}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm text-gray-900 ${
                    errors.webhook?.url ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
                  }`}
                  placeholder="http://localhost:3001/api/webhook/helius"
                />
                <p className="mt-1 text-xs text-gray-300">
                  This is the URL that will receive webhook events. For local testing, use localhost.
                  In production, this will automatically be updated to your deployed URL.
                </p>
                {errors.webhook?.url && (
                  <p className="mt-2 text-sm text-red-600">{errors.webhook?.url.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="webhookSecret" className="block text-sm font-medium text-white">
                  Webhook Secret
                </label>
                <input
                  type="password"
                  {...register('webhook.secret')}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm text-gray-900 ${
                    errors.webhook?.secret ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
                  }`}
                  placeholder="Your webhook secret (min 32 characters)"
                />
                <p className="mt-1 text-xs text-gray-300">
                  Create a secure secret key (at least 32 characters). This secures your webhook against unauthorized access.
                  Example: blockchain_indexer_secure_webhook_secret_12345
                </p>
                {errors.webhook?.secret && (
                  <p className="mt-2 text-sm text-red-600">{errors.webhook?.secret.message}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={isLoading}
          className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
            isLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {isLoading ? 'Creating Job...' : 'Create Job'}
        </button>
      </div>
    </form>
  );
} 