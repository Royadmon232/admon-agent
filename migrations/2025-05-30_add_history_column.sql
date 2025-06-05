-- Add history column to convo_memory table if it doesn't exist
ALTER TABLE convo_memory
ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;

-- Verify the column exists and has correct type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'convo_memory' 
        AND column_name = 'history'
        AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION 'History column not properly added to convo_memory table';
    END IF;
END $$; 