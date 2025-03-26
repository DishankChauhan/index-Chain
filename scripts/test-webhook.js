const https = require('https');
const http = require('http');

// Sample NFT sale event payload based on Helius webhook format
const testNftSaleEvent = {
  webhookId: 'test-webhook-id', // The actual webhookId from your database
  events: [
    {
      signature: 'TestSignature123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      timestamp: Date.now(),
      type: 'NFT_SALE',
      source: 'MAGIC_EDEN',
      slot: 123456789,
      description: 'Test NFT was sold on Magic Eden',
      amount: 5000000000, // 5 SOL in lamports
      fee: 10000000, // 0.01 SOL in lamports
      feePayer: 'FeePayer111111111111111111111111111111111111',
      saleType: 'INSTANT_SALE',
      buyer: 'Buyer111111111111111111111111111111111111111',
      seller: 'Seller11111111111111111111111111111111111111',
      staker: null,
      tokenTransfers: [
        {
          fromUserAccount: 'Seller11111111111111111111111111111111111111',
          toUserAccount: 'Buyer111111111111111111111111111111111111111',
          fromTokenAccount: 'TokenAcc11111111111111111111111111111111111',
          toTokenAccount: 'TokenAcc22222222222222222222222222222222222',
          tokenAmount: 1,
          decimals: 0,
          tokenStandard: 'NonFungible',
          mint: 'Mint1111111111111111111111111111111111111111'
        }
      ],
      nativeTransfers: [
        {
          fromUserAccount: 'Buyer111111111111111111111111111111111111111',
          toUserAccount: 'Seller11111111111111111111111111111111111111',
          amount: 5000000000
        }
      ],
      accountData: [
        {
          account: 'Mint1111111111111111111111111111111111111111',
          name: 'token',
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          lamports: 1461600,
          data: {
            parsed: {
              info: {
                decimals: 0,
                freezeAuthority: null,
                isInitialized: true,
                mintAuthority: null,
                supply: '1'
              },
              type: 'mint'
            },
            program: 'spl-token'
          },
          executable: false,
          rentEpoch: 0
        }
      ],
      nfts: [
        {
          mint: 'Mint1111111111111111111111111111111111111111',
          tokenStandard: 'NonFungible',
          name: 'Test NFT #123',
          symbol: 'TEST',
          collection: {
            verified: true,
            key: 'Collection111111111111111111111111111111111',
            name: 'Test Collection',
            symbol: 'TEST'
          },
          imageUrl: 'https://example.com/image.png',
          attributes: [
            { trait_type: 'Background', value: 'Blue' },
            { trait_type: 'Eyes', value: 'Green' }
          ]
        }
      ],
      events: [
        {
          type: 'NFT_SALE',
          source: 'MAGIC_EDEN',
          amount: 5000000000,
          buyer: 'Buyer111111111111111111111111111111111111111',
          seller: 'Seller11111111111111111111111111111111111111',
          nft: {
            mint: 'Mint1111111111111111111111111111111111111111',
            name: 'Test NFT #123'
          }
        }
      ]
    }
  ]
};

function sendTestWebhook() {
  try {
    // Get the webhook info from your database
    const webhookUrl = 'http://localhost:3000/api/webhook/helius';
    const webhookSecret = 'test-secret'; // The actual secret from your database
    
    console.log(`Sending test webhook event to: ${webhookUrl}`);

    // Parse the URL to determine whether to use http or https
    const isHttps = webhookUrl.startsWith('https://');
    const url = new URL(webhookUrl);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${webhookSecret}`
      }
    };

    const requestModule = isHttps ? https : http;
    
    const req = requestModule.request(options, (res) => {
      console.log(`Status: ${res.statusCode}`);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Response: ${data}`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Webhook test successful! Check your nft_events table for the inserted data.');
        } else {
          console.error('Webhook test failed. Check your server logs for errors.');
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Error sending test webhook:', error);
    });
    
    // Write the data to the request body
    req.write(JSON.stringify(testNftSaleEvent));
    req.end();
  } catch (error) {
    console.error('Error sending test webhook:', error);
  }
}

sendTestWebhook(); 