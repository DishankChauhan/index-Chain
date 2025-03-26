const { Pool } = require('pg');

async function insertTestNFTEvent() {
  // Create a connection to the database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://dishankchauhan:indexer123@localhost:5432/blockchain_indexer'
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    try {
      console.log('Inserting test NFT event...');
      
      // Insert a test NFT sale event matching the actual table structure
      const testEvent = {
        signature: 'TestSignature123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        mint_address: 'Mint1111111111111111111111111111111111111111',
        event_type: 'NFT_SALE',
        price: 5, // 5 SOL
        buyer: 'Buyer111111111111111111111111111111111111111',
        seller: 'Seller11111111111111111111111111111111111111',
        timestamp: new Date(),
        raw_data: {
          type: 'NFT_SALE',
          source: 'MAGIC_EDEN',
          amount: 5000000000,
          buyer: 'Buyer111111111111111111111111111111111111111',
          seller: 'Seller11111111111111111111111111111111111111',
          nft: {
            mint: 'Mint1111111111111111111111111111111111111111',
            name: 'Test NFT #123',
            collection: {
              name: 'Test Collection'
            }
          }
        }
      };
      
      const result = await client.query(`
        INSERT INTO nft_events (
          signature, mint_address, event_type, price, buyer, seller, timestamp, raw_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (signature) DO NOTHING
        RETURNING id
      `, [
        testEvent.signature,
        testEvent.mint_address,
        testEvent.event_type,
        testEvent.price,
        testEvent.buyer,
        testEvent.seller,
        testEvent.timestamp,
        testEvent.raw_data
      ]);
      
      if (result.rows.length > 0) {
        console.log(`Successfully inserted test NFT event with ID: ${result.rows[0].id}`);
      } else {
        console.log('Event already exists (signature conflict)');
      }
      
      // Check how many records are in the table
      const countResult = await client.query('SELECT COUNT(*) FROM nft_events');
      console.log(`Total records in nft_events table: ${countResult.rows[0].count}`);
      
    } catch (err) {
      console.error('Error in database operations:', err);
    } finally {
      console.log('Releasing client...');
      client.release();
    }
  } catch (err) {
    console.error('Error connecting to database:', err);
  } finally {
    console.log('Closing pool...');
    await pool.end();
  }
}

insertTestNFTEvent(); 