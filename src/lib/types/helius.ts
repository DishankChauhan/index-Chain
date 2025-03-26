export interface HeliusTransaction {
  accountData: never[];
  tokenTransfers: never[];
  nativeTransfers: never[];
  signature: string;
  type: 'NFT_BID' | 'NFT_SALE' | 'TOKEN_TRANSFER';
  timestamp: number;
  events: HeliusEvent[];
  raw_data?: any;
}

export interface HeliusWebhookData {
  seller: string;
  buyer: string;
  amount: any;
  nft: any;
  events: HeliusEvent[];
  sourceAddress: string;
  status: string;
  timestamp: number;
  signature: string;
  type: 'NFT_BID' | 'NFT_SALE' | 'TOKEN_TRANSFER';
  raw_data?: any;
  fee?: number;
  slot?: number;
  nativeTransfers?: any[];
  tokenTransfers?: any[];
  accountData?: any[];
}

export interface HeliusWebhookRequest {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced';
  authHeader: string;
}

export interface HeliusWebhookResponse {
  webhookId: string;
}

export interface HeliusErrorResponse {
  error?: string;
  message?: string;
}

export interface HeliusWebhook {
  webhookId: string;
  accountAddresses: string[];
  transactionTypes: string[];
  webhookURL: string;
  webhookType: string;
  createdAt?: string;
}

export interface HeliusEvent {
  data: { bidder: string; amount: number; marketplace: string; status: string; expiresAt?: number | undefined; };
  id: string;
  type: string;
  amount: number;
  timestamp: number;
  sourceAddress: string;
  destinationAddress: string;
  mint: string;
  marketplace?: string;
  status?: string;
  expiresAt?: number;
}

export interface HeliusAsset {
  id: string;
  interface: string;
  content: {
    metadata: {
      name: string;
      symbol: string;
      description: string;
      attributes: Array<{
        trait_type: string;
        value: string;
      }>;
    };
    files: Array<{
      uri: string;
      type: string;
    }>;
    links: Array<{
      name: string;
      url: string;
    }>;
  };
  authorities: Array<{
    address: string;
    scopes: string[];
  }>;
  compression: {
    compressed: boolean;
    dataHash: string;
    creatorHash: string;
    assetHash: string;
    tree: string;
    leafId: number;
  };
  grouping: Array<{
    groupKey: string;
    groupValue: string;
  }>;
  royalty: {
    royaltyModel: string;
    target: string;
    percent: number;
    basisPoints: number;
    primarySaleHappened: boolean;
    locked: boolean;
  };
  creators: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  ownership: {
    owner: string;
    delegate: string;
    frozen: boolean;
    delegated: boolean;
    ownership_model: string;
  };
  supply: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number;
  };
  mutable: boolean;
  burnt: boolean;
  activeBids?: Array<{
    bidder: string;
    amount: number;
    currency: string;
    time: number;
    expiryTime?: number;
    signature: string;
  }>;
  lastSalePrice?: number;
  lastSaleTime?: number;
  lastSaleSignature?: string;
  listingPrice?: number;
  listingTime?: number;
  listingSignature?: string;
}

export interface HeliusDASResponse {
  total: number;
  limit: number;
  page: number;
  items: HeliusAsset[];
} 