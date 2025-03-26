# Blockchain Indexing Platform

A powerful blockchain indexing platform built on Helius webhooks that enables developers to easily integrate and index Solana blockchain data into their PostgreSQL database.

## Features

- User authentication and database management
- Customizable data indexing options
- Real-time blockchain data indexing using Helius webhooks
- Support for multiple indexing categories:
  - NFT bids and prices
  - Token borrowing availability
  - Token prices across platforms

## Tech Stack

- Next.js with TypeScript
- PostgreSQL with Prisma ORM
- Redis for caching and job queues
- Helius SDK for blockchain integration
- Docker for development environment

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- Helius API key

## Getting Started

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd blockchain-indexer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start the development environment:
   ```bash
   docker-compose up -d
   ```

5. Run database migrations:
   ```bash
   npx prisma migrate dev
   ```

6. Start the development server:
   ```bash
   npm run dev
   ```

7. Visit http://localhost:3000 to access the application

## Development

- `npm run dev`: Start development server
- `npm run build`: Build production version
- `npm run start`: Start production server
- `npm run test`: Run tests
- `npm run lint`: Run linting

## Deployment

### GitHub

Before pushing to GitHub:

1. Ensure your `.gitignore` file includes `.env` and other sensitive files
2. Check that no API keys or credentials are hardcoded in the source code
3. Push your code to GitHub:

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### Vercel Deployment

1. Create an account on [Vercel](https://vercel.com/) if you don't have one
2. Install the Vercel CLI:

```bash
npm install -g vercel
```

3. Login to Vercel:

```bash
vercel login
```

4. Deploy to Vercel:

```bash
vercel
```

5. Configure environment variables in the Vercel dashboard:
   - Go to your project in the Vercel dashboard
   - Navigate to "Settings" > "Environment Variables"
   - Add all the variables from your `.env.example` file with appropriate values

6. Set up a PostgreSQL database:
   - Create a PostgreSQL database using a service like [Supabase](https://supabase.com/) or [Neon](https://neon.tech/)
   - Update the `DATABASE_URL` environment variable with your production database connection string
   - Run migrations on your production database:
     ```bash
     npx prisma migrate deploy
     ```

7. Set up Redis (optional):
   - For production, consider using a managed Redis service like [Upstash](https://upstash.com/) or [Redis Labs](https://redis.com/)
   - Update the Redis environment variables accordingly

8. For continuous deployment:
   - Connect your GitHub repository to Vercel
   - Configure build settings in the Vercel dashboard
   - Each push to your main branch will trigger a new deployment

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT 