# WhatsApp Home Insurance Bot

A WhatsApp bot for home insurance queries, built with Node.js and OpenAI.

## Local Development

### Prerequisites
- Node.js 18+
- OpenAI API key

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the project root with your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   ⚠️ Never commit the `.env` file to version control!

### Generating Embeddings
To update the knowledge base embeddings:
1. Ensure your `.env` file is set up with a valid OpenAI API key
2. Run:
   ```bash
   npm run embed
   ```
3. Commit only the updated `insurance_knowledge.json` file

### Running Locally
```bash
npm start
```

### Database Setup and Seeding
To set up and seed the database with embeddings, you'll need to configure the `DATABASE_URL`. If you're deploying to Render, this will typically be an internal service URL. Once the `DATABASE_URL` is set in your environment (e.g., in your `.env` file for local development or as an environment variable in your deployment service), run the following command to populate the database with question-answer embeddings:
```bash
npm run seed:embeddings
```

## Deployment
The bot is configured for deployment on Render. See `render.yaml` for details.
